#!/usr/bin/env node
/**
 * Extract facts from existing transcripts without re-downloading or re-transcribing
 * Usage: tsx src/scripts/extract-facts-only.ts [--force] [--limit N]
 */
import "dotenv/config";
import * as fs from "fs/promises";
import * as path from "path";
import { extractFactsFromVtt } from "./extract-facts.js";
import {
  getEpisodeDir,
  fileExists,
  logInfo,
  logSuccess,
  logError,
  logSection,
} from "./utils/index.js";

interface EpisodeInfo {
  dirName: string;
  vttPath: string;
  factsPath: string;
}

async function findEpisodesWithTranscripts(
  force: boolean = false
): Promise<EpisodeInfo[]> {
  const EPISODES_DIR = path.join(process.cwd(), "src/data/episodes");
  const episodes: EpisodeInfo[] = [];

  try {
    const entries = await fs.readdir(EPISODES_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const episodeDir = getEpisodeDir(entry.name);
        const vttPath = path.join(episodeDir, "transcript.vtt");
        const factsPath = path.join(episodeDir, "facts.json");

        // Check if transcript exists
        if (await fileExists(vttPath)) {
          // Include if force=true OR facts.json doesn't exist
          if (force || !(await fileExists(factsPath))) {
            episodes.push({
              dirName: entry.name,
              vttPath,
              factsPath,
            });
          }
        }
      }
    }
  } catch (error) {
    logError("Error scanning episodes directory", error);
    throw error;
  }

  return episodes;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const limit = args.includes("--limit")
    ? parseInt(args[args.indexOf("--limit") + 1] || "0")
    : undefined;

  logSection("Fact Extraction (Transcripts Only)");

  if (force) {
    logInfo("Force mode: Will re-extract facts even if they already exist");
  }

  // Find episodes with transcripts
  logInfo("Scanning for episodes with transcripts...");
  const allEpisodes = await findEpisodesWithTranscripts(force);

  if (allEpisodes.length === 0) {
    logInfo("No episodes found that need fact extraction");
    return;
  }

  const episodesToProcess = limit
    ? allEpisodes.slice(0, limit)
    : allEpisodes;

  logInfo(
    `Found ${episodesToProcess.length} episode(s) to process${limit ? ` (limited from ${allEpisodes.length})` : ""}`
  );

  // Extract VTT paths and output directories
  const vttPaths = episodesToProcess.map((ep) => ep.vttPath);
  const outputDirs = episodesToProcess.map((ep) =>
    path.dirname(ep.vttPath)
  );

  // Run batch fact extraction
  const result = await extractFactsFromVtt(vttPaths, outputDirs, force);

  // Summary
  logSection("Extraction Complete");
  logSuccess(
    `Successfully extracted: ${result.ok} episodes`
  );
  if (result.fail > 0) {
    logError(`Failed: ${result.fail} episodes`, null);
  }
  if (result.skipped > 0) {
    logInfo(`Skipped: ${result.skipped} episodes`);
  }

  if (result.fail > 0) {
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logError("Script failed", error);
    process.exit(1);
  });
}