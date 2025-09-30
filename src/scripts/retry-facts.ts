#!/usr/bin/env node
/**
 * Retry fact extraction for specific episodes
 * Usage: tsx src/scripts/retry-facts.ts <episode-id-or-number> [<episode-id-or-number> ...]
 * Example: tsx src/scripts/retry-facts.ts 575 576 124785842
 */
import "dotenv/config";
import * as fs from "fs/promises";
import * as path from "path";
import { extractFactsFromVtt } from "./extract-facts.js";
import {
  getEpisodeDir,
  fileExists,
  readJson,
  logInfo,
  logSuccess,
  logError,
  logSection,
  logWarning,
} from "./utils/index.js";

interface Metadata {
  id: string;
  title: string;
  dirName: string;
  itunes?: {
    episode?: string;
    episodeType?: string;
  };
}

async function findEpisodeByIdOrNumber(
  search: string
): Promise<{ dirName: string; id: string } | null> {
  const EPISODES_DIR = path.join(process.cwd(), "src/data/episodes");
  const entries = await fs.readdir(EPISODES_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const metadataPath = path.join(EPISODES_DIR, entry.name, "metadata.json");
      if (await fileExists(metadataPath)) {
        const metadata = await readJson<Metadata>(metadataPath);

        // Match by ID
        if (metadata.id === search) {
          return { dirName: entry.name, id: metadata.id };
        }

        // Match by episode number
        if (metadata.itunes?.episode === search) {
          return { dirName: entry.name, id: metadata.id };
        }

        // Match by number in title (e.g., "575" matches "575. No Such Thing...")
        if (metadata.title.match(new RegExp(`^${search}\\.`))) {
          return { dirName: entry.name, id: metadata.id };
        }
      }
    }
  }

  return null;
}

async function retryFactExtraction(episodeIdentifier: string): Promise<boolean> {
  logInfo(`Looking for episode: ${episodeIdentifier}`);

  const episode = await findEpisodeByIdOrNumber(episodeIdentifier);
  if (!episode) {
    logError(`Episode not found: ${episodeIdentifier}`, null);
    return false;
  }

  const episodeDir = getEpisodeDir(episode.dirName);
  const metadataPath = path.join(episodeDir, "metadata.json");
  const vttPath = path.join(episodeDir, "transcript.vtt");
  const factsPath = path.join(episodeDir, "facts.json");

  // Check if transcript exists
  if (!(await fileExists(vttPath))) {
    logError(`No transcript found for episode: ${episode.dirName}`, null);
    return false;
  }

  // Read metadata to check if it's a standard episode
  const metadata = await readJson<Metadata>(metadataPath);

  // Check if it's a standard episode:
  // 1. Has itunes.episode number AND episodeType is not "bonus"
  // 2. OR has episodeType "full" (even without episode number)
  // 3. OR title starts with a number (e.g., "601. No Such Thing...")
  const hasEpisodeNumber = metadata.itunes?.episode && metadata.itunes?.episodeType !== "bonus";
  const isFullEpisode = metadata.itunes?.episodeType === "full";
  const titleHasNumber = /^\d+[.:]/.test(metadata.title);
  const titleHasCompilationOrBonus = /compilation|^bonus/i.test(metadata.title);
  const isStandard = (hasEpisodeNumber || isFullEpisode || titleHasNumber) && !titleHasCompilationOrBonus;

  if (!isStandard) {
    logWarning(`Episode ${episode.dirName} is not a standard episode, skipping`);
    return false;
  }

  // Delete existing facts.json if it exists
  if (await fileExists(factsPath)) {
    await fs.unlink(factsPath);
    logInfo(`Deleted existing facts.json for: ${episode.dirName}`);
  }

  logInfo(`Extracting facts for: ${metadata.title}`);

  // Extract facts
  const result = await extractFactsFromVtt([vttPath], [episodeDir], true);

  if (result.ok === 1) {
    logSuccess(`Successfully extracted facts for: ${episode.dirName}`);
    return true;
  } else {
    logError(`Failed to extract facts for: ${episode.dirName}`, null);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: tsx src/scripts/retry-facts.ts <episode-id-or-number> [...]");
    console.error("Example: tsx src/scripts/retry-facts.ts 575 576 124785842");
    process.exit(1);
  }

  logSection("Retry Fact Extraction");

  let successful = 0;
  let failed = 0;

  for (const arg of args) {
    const success = await retryFactExtraction(arg);
    if (success) {
      successful++;
    } else {
      failed++;
    }
  }

  logSection("Complete");
  logInfo(`Successful: ${successful}`);
  if (failed > 0) {
    logError(`Failed: ${failed}`, null);
  }

  if (failed > 0) {
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