import * as path from "path";
import { ensureDir, writeJson, logSuccess } from "./index.js";

const EPISODES_DIR = "src/data/episodes";

/**
 * Episode metadata to save
 */
export interface EpisodeMetadata {
  id: string;
  title: string;
  publishDate: string;
  audioUrl: string;
  link?: string;
  description?: string;
  guid?: string;
  dirName: string;
}

/**
 * Create episode directory and save metadata
 * Shared by bootstrap and process-episodes scripts
 * Saves all available RSS data without filtering
 */
export async function saveEpisodeMetadata(
  episode: EpisodeMetadata,
  additionalData?: Record<string, any>
): Promise<string> {
  const episodeDir = path.join(EPISODES_DIR, episode.dirName);
  await ensureDir(episodeDir);

  const metadataPath = path.join(episodeDir, "metadata.json");

  // Save all RSS data plus any additional data
  await writeJson(metadataPath, {
    ...episode,
    ...additionalData,
  });

  logSuccess(`Saved metadata: ${episode.dirName}`);
  return episodeDir;
}

/**
 * Get episode directory path
 */
export function getEpisodeDir(dirName: string): string {
  return path.join(EPISODES_DIR, dirName);
}