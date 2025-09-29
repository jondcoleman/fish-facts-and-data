import * as fs from "fs/promises";
import * as path from "path";
import type { Episode } from "../scripts/utils/schemas.js";

/**
 * Episode with metadata combined
 */
export interface EpisodeWithMetadata extends Episode {
  metadata: {
    id: string;
    dirName: string;
    publishDate: string;
    audioUrl: string;
    processedAt?: string;
  };
}

const EPISODES_DIR = path.join(process.cwd(), "src/data/episodes");

/**
 * Get all processed episodes with their facts
 */
export async function getAllEpisodes(): Promise<EpisodeWithMetadata[]> {
  const episodes: EpisodeWithMetadata[] = [];

  try {
    const entries = await fs.readdir(EPISODES_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const episodeDir = path.join(EPISODES_DIR, entry.name);
        const factsPath = path.join(episodeDir, "facts.json");
        const metadataPath = path.join(episodeDir, "metadata.json");

        // Only include if facts exist
        try {
          await fs.access(factsPath);
          const factsData = await fs.readFile(factsPath, "utf-8");
          const facts = JSON.parse(factsData);

          let metadata;
          try {
            await fs.access(metadataPath);
            const metadataData = await fs.readFile(metadataPath, "utf-8");
            metadata = JSON.parse(metadataData);
          } catch {
            metadata = {
              id: entry.name,
              dirName: entry.name,
              publishDate: "",
              audioUrl: "",
            };
          }

          episodes.push({
            ...facts,
            metadata,
          });
        } catch (error) {
          // Facts file doesn't exist, skip this episode
        }
      }
    }

    // Sort by publish date (newest first)
    episodes.sort(
      (a, b) =>
        new Date(b.metadata.publishDate).getTime() -
        new Date(a.metadata.publishDate).getTime()
    );

    return episodes;
  } catch (error) {
    console.error("Error loading episodes:", error);
    return [];
  }
}

/**
 * Get a single episode by directory name
 */
export async function getEpisodeByDirName(
  dirName: string
): Promise<EpisodeWithMetadata | null> {
  const episodeDir = path.join(EPISODES_DIR, dirName);
  const factsPath = path.join(episodeDir, "facts.json");
  const metadataPath = path.join(episodeDir, "metadata.json");

  try {
    await fs.access(factsPath);
  } catch {
    return null;
  }

  try {
    const factsData = await fs.readFile(factsPath, "utf-8");
    const facts = JSON.parse(factsData);

    let metadata;
    try {
      await fs.access(metadataPath);
      const metadataData = await fs.readFile(metadataPath, "utf-8");
      metadata = JSON.parse(metadataData);
    } catch {
      metadata = {
        id: dirName,
        dirName,
        publishDate: "",
        audioUrl: "",
      };
    }

    return {
      ...facts,
      metadata,
    };
  } catch (error) {
    console.error(`Error reading episode ${dirName}:`, error);
    return null;
  }
}

/**
 * Get all facts from all episodes (for search/filtering)
 */
export async function getAllFacts() {
  const episodes = await getAllEpisodes();
  const allFacts = episodes.flatMap((episode) =>
    episode.facts.map((fact) => ({
      ...fact,
      episodeTitle: episode.episode_title,
      episodeNumber: episode.episode_number,
      episodeDirName: episode.metadata.dirName,
      publishDate: episode.metadata.publishDate,
    }))
  );

  return allFacts;
}