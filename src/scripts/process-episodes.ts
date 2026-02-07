#!/usr/bin/env node
import "dotenv/config";
import * as fs from "fs/promises";
import * as path from "path";
import {
  discoverNewEpisodes,
} from "./discover.js";
import { loadEpisodeIgnoreList } from "./utils/episode-ignore.js";
import { downloadAndPrepareAudio } from "./download.js";
import { transcribeAudio } from "./transcribe.js";
import { extractFactsFromVtt } from "./extract-facts.js";
import {
  saveEpisodeMetadata,
  getEpisodeDir,
  fileExists,
  writeJson,
  logInfo,
  logSuccess,
  logError,
  logSection,
  logProgress,
  logWarning,
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

    // Apply ignore list (episodes that consistently fail, e.g. Whisper bugs on certain audio)
    const ignoreSet = await loadEpisodeIgnoreList();
    if (ignoreSet.size > 0) {
      logInfo(`Loaded ${ignoreSet.size} episode(s) from episodes-ignore.txt`);
    }
    const afterIgnore = newEpisodes.filter((ep) => {
      if (ignoreSet.has(ep.dirName)) {
        logInfo(`Skipping ignored episode: ${ep.dirName} (${ep.title})`);
        stats.skipped++;
        return false;
      }
      return true;
    });

    const episodesToProcess = limit
      ? afterIgnore.slice(0, limit)
      : afterIgnore;

    stats.total = episodesToProcess.length;

    logInfo(
      `Processing ${episodesToProcess.length} episode(s)${limit ? ` (limited from ${newEpisodes.length})` : ""}`
    );

    // Process each episode
    const vttPaths: string[] = [];
    const outputDirs: string[] = [];
    const episodeIdsForExtraction: string[] = [];

    for (let i = 0; i < episodesToProcess.length; i++) {
      const episode = episodesToProcess[i];
      const success = await processEpisode(episode, stats, i, modelName);

      if (success) {
        stats.successful++;

        // Collect VTT paths for batch fact extraction
        // getEpisodeDir already returns absolute path
        const episodeDir = getEpisodeDir(episode.dirName);
        const vttPath = path.join(episodeDir, "transcript.vtt");
        const factsPath = path.join(episodeDir, "facts.json");
        const metadataPath = path.join(episodeDir, "metadata.json");

        // Only include episodes that don't already have facts.json
        const factsExist = await fileExists(factsPath);
        if (!factsExist) {
          // Check if this is a standard episode by reading metadata
          const metadata = JSON.parse(
            await fs.readFile(metadataPath, "utf-8")
          );

          // Check if it's a standard episode:
          // 1. Has itunes.episode number AND episodeType is not "bonus"
          // 2. OR has episodeType "full" (even without episode number)
          // 3. OR title starts with a number (e.g., "601. No Such Thing...")
          const hasEpisodeNumber = metadata.itunes?.episode && metadata.itunes?.episodeType !== "bonus";
          const isFullEpisode = metadata.itunes?.episodeType === "full";
          const titleHasNumber = /^\d+[.:]/.test(metadata.title);
          const titleHasCompilationOrBonus = /compilation|^bonus/i.test(metadata.title);
          const isStandard = (hasEpisodeNumber || isFullEpisode || titleHasNumber) && !titleHasCompilationOrBonus;

          if (isStandard) {
            // Standard episode - extract facts via LLM
            vttPaths.push(vttPath);
            outputDirs.push(episodeDir);
            episodeIdsForExtraction.push(episode.id);
          } else {
            // Non-standard episode - create empty facts file
            const episodeType = metadata.itunes?.episodeType === "bonus"
              ? (metadata.title?.toLowerCase().includes("compilation") ? "compilation" : "bonus")
              : "other";

            await writeJson(factsPath, {
              episode_type: episodeType,
              episode_summary: "",
              facts: [],
            });
            logInfo(`Created empty facts for ${episodeType} episode: ${episode.dirName}`);
          }
        }
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

      // Check how many episodes successfully got facts
      let successCount = 0;
      for (let i = 0; i < episodeIdsForExtraction.length; i++) {
        const factsPath = path.join(outputDirs[i], "facts.json");
        if (await fileExists(factsPath)) {
          successCount++;
        }
      }

      if (successCount < episodeIdsForExtraction.length) {
        logWarning(`${episodeIdsForExtraction.length - successCount} episodes failed fact extraction`);
      }
    }

    // Final statistics
    const totalTime = (Date.now() - stats.startTime) / 1000 / 60; // minutes
    logSection("Processing Complete");
    logInfo(`Total episodes: ${stats.total}`);
    logInfo(`Successful: ${stats.successful}`);
    logInfo(`Failed: ${stats.failed}`);
    if (stats.skipped > 0) logInfo(`Skipped (ignored): ${stats.skipped}`);
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