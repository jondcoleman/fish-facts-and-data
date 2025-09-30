import "dotenv/config";
import Parser, { type Item } from "rss-parser";
import * as path from "path";
import * as fs from "fs/promises";
import { fileURLToPath } from "url";
import {
  readJson,
  createEpisodeDirName,
  fileExists,
  logInfo,
  logSuccess,
  logError,
  logSection,
} from "./utils/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Episode metadata to be saved
 */
interface EpisodeMetadata {
  id: string;
  title: string;
  publishDate: string;
  audioUrl: string;
  link?: string;
  description?: string;
  guid?: string;
  dirName: string;
}

const RSS_FEED_URL = process.env.PODCAST_RSS_FEED_URL;
const EPISODES_DIR = path.join(__dirname, "../data/episodes");

/**
 * Parse RSS feed and return all items
 */
async function parseFeed(): Promise<Item[]> {
  if (!RSS_FEED_URL) {
    throw new Error("PODCAST_RSS_FEED_URL not set in environment");
  }

  logInfo("Parsing RSS feed...");
  const parser = new Parser();
  const feed = await parser.parseURL(RSS_FEED_URL);
  logSuccess(`Found ${feed.items.length} episodes in feed`);

  return feed.items;
}

/**
 * Create episode ID from feed item (using guid or title)
 */
function createEpisodeId(item: Item): string {
  return item.guid || item.link || item.title || "";
}

/**
 * Convert feed item to episode metadata
 */
function createEpisodeMetadata(item: Item): EpisodeMetadata | null {
  const title = item.title;
  const audioUrl = item.enclosure?.url;
  const pubDate = item.pubDate;

  if (!title || !audioUrl || !pubDate) {
    logError(`Skipping item - missing required fields`);
    return null;
  }

  const publishDate = new Date(pubDate);
  const dirName = createEpisodeDirName(publishDate, title);
  const id = createEpisodeId(item);

  // Return all fields from the RSS item (spread to capture everything)
  return {
    ...item,
    id,
    publishDate: publishDate.toISOString(),
    audioUrl,
    dirName,
  } as any;
}

/**
 * Check if an episode has already been processed
 * An episode is considered processed if it has a facts.json file
 */
async function isEpisodeProcessed(dirName: string): Promise<boolean> {
  const factsPath = path.join(EPISODES_DIR, dirName, "facts.json");
  return await fileExists(factsPath);
}

/**
 * Find new episodes that haven't been processed yet
 * An episode needs processing if:
 * - It exists in the RSS feed
 * - It doesn't have a facts.json file
 */
export async function discoverNewEpisodes(): Promise<EpisodeMetadata[]> {
  logSection("Episode Discovery");

  const feedItems = await parseFeed();

  // Find new episodes
  const newEpisodes: EpisodeMetadata[] = [];
  let alreadyProcessed = 0;

  for (const item of feedItems) {
    const metadata = createEpisodeMetadata(item);
    if (!metadata) continue;

    // Check if this episode has been processed
    const processed = await isEpisodeProcessed(metadata.dirName);

    if (processed) {
      alreadyProcessed++;
      continue;
    }

    newEpisodes.push(metadata);
  }

  logSuccess(
    `Found ${newEpisodes.length} new episodes (${alreadyProcessed} already processed)`
  );

  return newEpisodes;
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  discoverNewEpisodes()
    .then((episodes) => {
      console.log("\nNew episodes to process:");
      episodes.forEach((ep, i) => {
        console.log(`${i + 1}. ${ep.title}`);
        console.log(`   Directory: ${ep.dirName}`);
        console.log(`   Published: ${ep.publishDate}`);
      });
    })
    .catch((error) => {
      logError("Discovery failed", error);
      process.exit(1);
    });
}