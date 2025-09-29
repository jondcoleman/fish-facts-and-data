#!/usr/bin/env node
import "dotenv/config";
import * as path from "path";
import {
  discoverNewEpisodes,
  markEpisodeProcessed,
} from "./discover.js";
import { downloadAndPrepareAudio } from "./download.js";
import { transcribeAudio } from "./transcribe.js";
import { extractFactsFromVtt } from "./extract-facts.js";
import {
  saveEpisodeMetadata,
  getEpisodeDir,
  logInfo,
  logSuccess,
  logError,
  logSection,
  logProgress,
} from "./utils/index.js";

/**
 * Episode processing statistics
 */
interface ProcessingStats {
  total: number;
  successful: number;
  failed: number;
  skipped: number;
  startTime: number;
}

/**
 * Process a single episode through the entire pipeline
 */
async function processEpisode(
  episode: {
    id: string;
    title: string;
    audioUrl: string;
    dirName: string;
    publishDate: string;
  },
  stats: ProcessingStats,
  index: number,
  modelName: string = "base"
): Promise<boolean> {
  logSection(`Episode ${index + 1}/${stats.total}`);
  logInfo(`Title: ${episode.title}`);
  logInfo(`Directory: ${episode.dirName}`);

  const episodeDir = getEpisodeDir(episode.dirName);

  try {
    // Step 1: Download audio
    logProgress(1, 4, "Downloading audio...");
    const audioExtension = path.extname(episode.audioUrl).split("?")[0] || ".mp3";
    // Use title portion of dirName for consistency with migrated files
    const titlePortion = episode.dirName.split("_").slice(1).join("_");
    const audioFilename = `${titlePortion}${audioExtension}`;

    const audioResult = await downloadAndPrepareAudio(
      episode.audioUrl,
      audioFilename
    );

    if (!audioResult) {
      throw new Error("Failed to download audio");
    }

    // Step 2: Transcribe audio
    logProgress(2, 4, "Transcribing audio...");
    const transcriptionResult = await transcribeAudio(
      audioResult.wavPath,
      episode.dirName,
      { modelName: modelName as any }
    );

    if (!transcriptionResult) {
      throw new Error("Failed to transcribe audio");
    }

    if (transcriptionResult.transcriptExists) {
      logInfo("Using existing transcript");
    }

    // Step 3: Facts will be extracted in batch after all episodes are processed
    logProgress(3, 4, "Transcript ready for batch fact extraction");

    // Step 4: Save episode metadata
    logProgress(4, 4, "Saving episode metadata...");
    await saveEpisodeMetadata(episode, {
      processedAt: new Date().toISOString(),
    });

    // Note: Episodes are marked as processed after batch fact extraction completes

    logSuccess(`Successfully processed: ${episode.title}`);
    return true;
  } catch (error) {
    logError(`Failed to process episode: ${episode.title}`, error);
    return false;
  }
}

/**
 * Main processing function
 */
async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit")
    ? parseInt(args[args.indexOf("--limit") + 1] || "0")
    : undefined;
  const modelName = args.includes("--model")
    ? args[args.indexOf("--model") + 1]
    : "base";

  const stats: ProcessingStats = {
    total: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    startTime: Date.now(),
  };

  try {
    // Discover new episodes
    logSection("Pipeline Starting");
    const newEpisodes = await discoverNewEpisodes();

    if (newEpisodes.length === 0) {
      logInfo("No new episodes to process");
      return;
    }

    const episodesToProcess = limit
      ? newEpisodes.slice(0, limit)
      : newEpisodes;

    stats.total = episodesToProcess.length;

    logInfo(
      `Processing ${episodesToProcess.length} episode(s)${limit ? ` (limited from ${newEpisodes.length})` : ""}`
    );

    // Process each episode
    const vttPaths: string[] = [];
    const outputDirs: string[] = [];
    const processedEpisodeIds: string[] = [];

    for (let i = 0; i < episodesToProcess.length; i++) {
      const episode = episodesToProcess[i];
      const success = await processEpisode(episode, stats, i, modelName);

      if (success) {
        stats.successful++;

        // Collect VTT paths for batch fact extraction
        const episodeDir = getEpisodeDir(episode.dirName);
        const vttPath = path.join(episodeDir, "transcript.vtt");

        vttPaths.push(vttPath);
        outputDirs.push(episodeDir);
        processedEpisodeIds.push(episode.id);
      } else {
        stats.failed++;
      }
    }

    // Batch fact extraction for all processed episodes
    if (vttPaths.length > 0) {
      logSection("Batch Fact Extraction");
      const extractionResults = await extractFactsFromVtt(
        vttPaths,
        outputDirs,
        false
      );

      logSuccess(
        `Fact extraction complete: ${extractionResults.ok} successful, ${extractionResults.fail} failed, ${extractionResults.skipped} skipped`
      );

      // Mark episodes as processed after fact extraction completes
      logInfo("Marking episodes as processed...");
      for (const episodeId of processedEpisodeIds) {
        await markEpisodeProcessed(episodeId);
      }
      logSuccess(`Marked ${processedEpisodeIds.length} episodes as processed`);
    }

    // Final statistics
    const totalTime = (Date.now() - stats.startTime) / 1000 / 60; // minutes
    logSection("Processing Complete");
    logInfo(`Total episodes: ${stats.total}`);
    logInfo(`Successful: ${stats.successful}`);
    logInfo(`Failed: ${stats.failed}`);
    logInfo(`Total time: ${totalTime.toFixed(1)} minutes`);

    if (stats.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    logError("Pipeline failed", error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}