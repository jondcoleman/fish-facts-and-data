import "dotenv/config";
import Parser, { type Item } from "rss-parser";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  readJson,
  writeJson,
  createEpisodeDirName,
  logInfo,
  logSuccess,
  logError,
  logSection,
} from "./utils/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Episode index structure
 */
interface EpisodeIndex {
  processed: string[];
  lastUpdated: string | null;
}

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
const INDEX_PATH = path.join(__dirname, "../data/episodes/index.json");

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
 * Load the episode index
 */
async function loadIndex(): Promise<EpisodeIndex> {
  try {
    return await readJson<EpisodeIndex>(INDEX_PATH);
  } catch {
    logInfo("Index not found, creating new index");
    return {
      processed: [],
      lastUpdated: null,
    };
  }
}

/**
 * Save the episode index
 */
async function saveIndex(index: EpisodeIndex): Promise<void> {
  await writeJson(INDEX_PATH, index);
  logSuccess(`Index updated with ${index.processed.length} processed episodes`);
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
 * Find new episodes that haven't been processed yet
 */
export async function discoverNewEpisodes(): Promise<EpisodeMetadata[]> {
  logSection("Episode Discovery");

  // Load index and feed
  const index = await loadIndex();
  const feedItems = await parseFeed();

  // Find new episodes
  const newEpisodes: EpisodeMetadata[] = [];

  for (const item of feedItems) {
    const id = createEpisodeId(item);

    if (index.processed.includes(id)) {
      continue; // Already processed
    }

    const metadata = createEpisodeMetadata(item);
    if (metadata) {
      newEpisodes.push(metadata);
    }
  }

  logSuccess(
    `Found ${newEpisodes.length} new episodes (${index.processed.length} already processed)`
  );

  return newEpisodes;
}

/**
 * Mark an episode as processed in the index
 */
export async function markEpisodeProcessed(episodeId: string): Promise<void> {
  const index = await loadIndex();

  if (!index.processed.includes(episodeId)) {
    index.processed.push(episodeId);
    index.lastUpdated = new Date().toISOString();
    await saveIndex(index);
  }
}

/**
 * Get all processed episode IDs
 */
export async function getProcessedEpisodes(): Promise<string[]> {
  const index = await loadIndex();
  return index.processed;
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
