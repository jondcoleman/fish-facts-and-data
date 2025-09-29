#!/usr/bin/env node
import "dotenv/config";
import * as path from "path";
import {
  discoverNewEpisodes,
  markEpisodeProcessed,
} from "./discover.js";
import {
  ensureDir,
  writeJson,
  logInfo,
  logSuccess,
  logError,
  logSection,
  logProgress,
} from "./utils/index.js";

const EPISODES_DIR = "src/data/episodes";

/**
 * Bootstrap episodes by creating directories and saving RSS metadata
 * Does NOT download audio or transcribe - just sets up the structure
 */
async function bootstrapEpisodes() {
  logSection("Episode Bootstrap");
  logInfo("Creating episode directories and saving RSS metadata...");

  try {
    // Discover new episodes from RSS
    const newEpisodes = await discoverNewEpisodes();

    if (newEpisodes.length === 0) {
      logInfo("No new episodes to bootstrap");
      return;
    }

    logInfo(`Found ${newEpisodes.length} episodes to bootstrap`);

    let successful = 0;
    let failed = 0;

    // Create directory and save metadata for each episode
    for (let i = 0; i < newEpisodes.length; i++) {
      const episode = newEpisodes[i];
      logProgress(i + 1, newEpisodes.length, episode.title);

      try {
        // Create episode directory
        const episodeDir = path.join(EPISODES_DIR, episode.dirName);
        await ensureDir(episodeDir);

        // Save metadata from RSS
        const metadataPath = path.join(episodeDir, "metadata.json");
        await writeJson(metadataPath, {
          id: episode.id,
          title: episode.title,
          publishDate: episode.publishDate,
          audioUrl: episode.audioUrl,
          link: episode.link,
          description: episode.description,
          guid: episode.guid,
          dirName: episode.dirName,
          bootstrappedAt: new Date().toISOString(),
        });

        // Mark as processed so discovery doesn't pick it up again
        await markEpisodeProcessed(episode.id);

        logSuccess(`Bootstrapped: ${episode.dirName}`);
        successful++;
      } catch (error) {
        logError(`Failed to bootstrap ${episode.title}`, error);
        failed++;
      }
    }

    logSection("Bootstrap Complete");
    logInfo(`Total episodes: ${newEpisodes.length}`);
    logInfo(`Successful: ${successful}`);
    logInfo(`Failed: ${failed}`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    logError("Bootstrap failed", error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrapEpisodes();
}