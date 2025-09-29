import * as path from "path";
import { fileURLToPath } from "url";
import { ensureDir, writeJson, readJson, logSuccess } from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const EPISODES_DIR = path.join(PROJECT_ROOT, "src/data/episodes");

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
 * Saves all RSS data EXCEPT audioUrl, enclosure, and itunes.image (saved separately for privacy)
 */
export async function saveEpisodeMetadata(
  episode: EpisodeMetadata,
  additionalData?: Record<string, any>
): Promise<string> {
  const episodeDir = path.join(EPISODES_DIR, episode.dirName);
  await ensureDir(episodeDir);

  // Extract Patreon-specific data and save separately (gitignored)
  const { audioUrl, enclosure, itunes, ...rest } = episode as any;

  // Extract non-Patreon itunes fields (everything except image)
  const { image, ...publicItunesFields } = itunes || {};

  // Save Patreon-protected data privately (gitignored)
  const audioUrlsPath = path.join(episodeDir, "audio-urls.json");
  await writeJson(audioUrlsPath, {
    audioUrl,
    enclosure,
    itunesImage: image,
  });

  // Save public metadata (committed to git)
  const metadataPath = path.join(episodeDir, "metadata.json");
  await writeJson(metadataPath, {
    ...rest,
    // Include non-image itunes fields if they exist
    ...(Object.keys(publicItunesFields).length > 0 ? { itunes: publicItunesFields } : {}),
    ...additionalData,
  });

  logSuccess(`Saved metadata: ${episode.dirName}`);
  return episodeDir;
}

/**
 * Get audio URL for an episode (from private file)
 */
export async function getAudioUrl(dirName: string): Promise<string | null> {
  const episodeDir = path.join(EPISODES_DIR, dirName);
  const audioUrlsPath = path.join(episodeDir, "audio-urls.json");

  try {
    const data = await readJson<{ audioUrl: string }>(audioUrlsPath);
    return data.audioUrl;
  } catch {
    return null;
  }
}

/**
 * Get episode directory path
 */
export function getEpisodeDir(dirName: string): string {
  return path.join(EPISODES_DIR, dirName);
}