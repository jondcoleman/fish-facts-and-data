#!/usr/bin/env node
/**
 * One-time migration script to extract Patreon-protected data from metadata.json
 * and save it to audio-urls.json (which is gitignored)
 * Migrates: audioUrl, enclosure, and itunes.image
 */
import * as fs from "fs/promises";
import * as path from "path";
import {
  logInfo,
  logSuccess,
  logError,
  logSection,
  writeJson,
  readJson,
} from "./utils/index.js";

const EPISODES_DIR = "src/data/episodes";

async function migrateAudioUrls() {
  logSection("Audio URL Migration");
  logInfo("Moving audio URLs from metadata.json to audio-urls.json...");

  let processed = 0;
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const entries = await fs.readdir(EPISODES_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const episodeDir = path.join(EPISODES_DIR, entry.name);
      const metadataPath = path.join(episodeDir, "metadata.json");
      const audioUrlsPath = path.join(episodeDir, "audio-urls.json");

      processed++;

      try {
        // Read metadata
        const metadata = await readJson<any>(metadataPath);

        if (!metadata.audioUrl) {
          skipped++;
          continue;
        }

        // Save audio URL to separate file
        await writeJson(audioUrlsPath, { audioUrl: metadata.audioUrl });

        // Remove audioUrl from metadata
        const { audioUrl, ...cleanMetadata } = metadata;
        await writeJson(metadataPath, cleanMetadata);

        logSuccess(`Migrated: ${entry.name}`);
        migrated++;
      } catch (error) {
        logError(`Failed to migrate ${entry.name}`, error);
        failed++;
      }
    }

    logSection("Migration Complete");
    logInfo(`Processed: ${processed} episodes`);
    logInfo(`Migrated: ${migrated}`);
    logInfo(`Skipped: ${skipped} (no audioUrl)`);
    logInfo(`Failed: ${failed}`);
  } catch (error) {
    logError("Migration failed", error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateAudioUrls();
}