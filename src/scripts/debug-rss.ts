#!/usr/bin/env node
import "dotenv/config";
import Parser from "rss-parser";

/**
 * Debug script to see what fields are available in the RSS feed
 */
async function debugRss() {
  const RSS_FEED_URL = process.env.PODCAST_RSS_FEED_URL;

  if (!RSS_FEED_URL) {
    throw new Error("PODCAST_RSS_FEED_URL not set in environment");
  }

  console.log("Fetching RSS feed...\n");
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

  const feed = await parser.parseURL(RSS_FEED_URL);

  console.log("Feed-level fields:");
  console.log(JSON.stringify(feed, null, 2).substring(0, 500));
  console.log("\n\n=== FIRST EPISODE ===\n");
  console.log(JSON.stringify(feed.items[0], null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  debugRss();
}