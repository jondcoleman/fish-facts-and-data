#!/usr/bin/env node
import "dotenv/config";
import {
  discoverNewEpisodes,
  markEpisodeProcessed,
  getProcessedEpisodes,
} from "./discover.js";
import {
  saveEpisodeMetadata,
  getEpisodeDir,
  fileExists,
  logInfo,
  logError,
  logSection,
  logProgress,
  logWarning,
} from "./utils/index.js";
import * as path from "path";

/**
 * Bootstrap episodes by creating directories and saving RSS metadata
 * Does NOT download audio or transcribe - just sets up the structure
 */
async function bootstrapEpisodes() {
  const args = process.argv.slice(2);
  const force = args.includes("--force") || args.includes("-f");

  logSection("Episode Bootstrap");
  logInfo("Creating episode directories and saving RSS metadata...");
  if (force) {
    logWarning("Force mode enabled - will overwrite existing metadata");
  }

  try {
    // Get all episodes from RSS (not just new ones if force mode)
    let episodesToProcess;

    if (force) {
      // In force mode, get ALL episodes from RSS feed
      const Parser = (await import("rss-parser")).default;

      // Configure parser to capture iTunes-specific fields
      const parser = new Parser({
        customFields: {
          item: [
            ['itunes:image', 'itunesImage'],
            ['itunes:duration', 'itunesDuration'],
            ['itunes:explicit', 'itunesExplicit'],
            ['itunes:episode', 'itunesEpisode'],
            ['itunes:season', 'itunesSeason'],
            ['itunes:episodeType', 'itunesEpisodeType'],
          ]
        }
      });

      const RSS_FEED_URL = process.env.PODCAST_RSS_FEED_URL;

      if (!RSS_FEED_URL) {
        throw new Error("PODCAST_RSS_FEED_URL not set in environment");
      }

      logInfo("Fetching all episodes from RSS feed...");
      const feed = await parser.parseURL(RSS_FEED_URL);

      // Import createEpisodeMetadata logic
      episodesToProcess = feed.items
        .map((item: any) => {
          const title = item.title;
          const audioUrl = item.enclosure?.url;
          const pubDate = item.pubDate;

          if (!title || !audioUrl || !pubDate) {
            return null;
          }

          const publishDate = new Date(pubDate);
          const dirName = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
          const dateStr = publishDate.toISOString().split("T")[0];
          const fullDirName = `${dateStr}_${dirName}`;
          const id = item.guid || item.link || title;

          return {
            id,
            title,
            publishDate: publishDate.toISOString(),
            audioUrl,
            link: item.link,
            description: item.contentSnippet || item.content,
            guid: item.guid,
            dirName: fullDirName,
          };
        })
        .filter(Boolean);

      logInfo(`Found ${episodesToProcess.length} total episodes in feed`);
    } else {
      // Normal mode - only new episodes
      episodesToProcess = await discoverNewEpisodes();

      if (episodesToProcess.length === 0) {
        logInfo("No new episodes to bootstrap");
        return;
      }

      logInfo(`Found ${episodesToProcess.length} new episodes to bootstrap`);
    }

    let successful = 0;
    let failed = 0;
    let skipped = 0;

    // Create directory and save metadata for each episode
    for (let i = 0; i < episodesToProcess.length; i++) {
      const episode = episodesToProcess[i];
      logProgress(i + 1, episodesToProcess.length, episode.title);

      try {
        const episodeDir = getEpisodeDir(episode.dirName);
        const metadataPath = path.join(episodeDir, "metadata.json");

        // Check if metadata already exists (skip unless force mode)
        if (!force && (await fileExists(metadataPath))) {
          logInfo(`Skipping ${episode.dirName} (metadata exists)`);
          skipped++;
          continue;
        }

        // Save metadata using shared utility
        await saveEpisodeMetadata(episode, {
          bootstrappedAt: new Date().toISOString(),
        });

        // Mark as processed so discovery doesn't pick it up again
        await markEpisodeProcessed(episode.id);

        if (force && (await fileExists(metadataPath))) {
          logInfo(`Overwrote: ${episode.dirName}`);
        }

        successful++;
      } catch (error) {
        logError(`Failed to bootstrap ${episode.title}`, error);
        failed++;
      }
    }

    logSection("Bootstrap Complete");
    logInfo(`Total episodes: ${episodesToProcess.length}`);
    logInfo(`Successful: ${successful}`);
    if (skipped > 0) {
      logInfo(`Skipped: ${skipped} (use --force to overwrite)`);
    }
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