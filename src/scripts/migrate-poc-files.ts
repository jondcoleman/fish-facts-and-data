#!/usr/bin/env node
/**
 * Migration script to copy audio and transcript files from POC project
 * Matches POC files to new episode structure by title, avoiding re-downloads and re-transcription
 */
import "dotenv/config";
import * as fs from "fs/promises";
import * as path from "path";
import {
  readJson,
  ensureDir,
  fileExists,
  sanitizeFilename,
  logInfo,
  logSuccess,
  logError,
  logWarning,
  logSection,
  logProgress,
} from "./utils/index.js";

const POC_DIR = "../fish-transcripts-node/downloads";
const EPISODES_DIR = "src/data/episodes";
const AUDIO_DIR = "audio";
const TRANSCRIPTS_DIR = "transcripts";

interface EpisodeInfo {
  dirName: string;
  title: string;
  normalizedTitle: string;
  metadataPath: string;
}

interface POCFile {
  baseName: string; // e.g., "327__No_Such_Thing_As_A_SCUBA_Diver_In_A_Tree"
  title: string; // e.g., "No Such Thing As A SCUBA Diver In A Tree"
  normalizedTitle: string;
  mp3Path: string;
  wavPath: string;
  vttPath: string;
  txtPath: string;
  srtPath: string;
  hasVtt: boolean;
}

interface MigrationStats {
  totalPOCFiles: number;
  matched: number;
  unmatched: number;
  copied: number;
  skipped: number;
  failed: number;
}

/**
 * Normalize title for matching (lowercase, remove special chars, collapse whitespace)
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract title from POC filename
 * Format: "{number}__{Title}" or "{number}_{sub}__{Title}"
 */
function extractTitleFromPOCFilename(filename: string): string {
  // Remove extension
  const base = filename.replace(/\.(mp3|wav|vtt|txt|srt)$/, "");

  // Remove .wav prefix if present (for .wav.vtt files)
  const cleaned = base.replace(/\.wav$/, "");

  // Split on "__" and take everything after it
  const parts = cleaned.split("__");
  if (parts.length < 2) {
    return cleaned;
  }

  // Join everything after first __ (in case title contains __)
  const title = parts.slice(1).join("__");

  // Replace underscores with spaces
  return title.replace(/_/g, " ");
}

/**
 * Load all episode metadata
 */
async function loadEpisodes(): Promise<EpisodeInfo[]> {
  const episodes: EpisodeInfo[] = [];
  const entries = await fs.readdir(EPISODES_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const metadataPath = path.join(EPISODES_DIR, entry.name, "metadata.json");

    try {
      const metadata = await readJson<{ title: string }>(metadataPath);
      episodes.push({
        dirName: entry.name,
        title: metadata.title,
        normalizedTitle: normalizeTitle(metadata.title),
        metadataPath,
      });
    } catch (error) {
      logWarning(`Could not read metadata for ${entry.name}`);
    }
  }

  return episodes;
}

/**
 * Scan POC directory for completed files
 */
async function scanPOCFiles(): Promise<POCFile[]> {
  const files: POCFile[] = [];
  const entries = await fs.readdir(POC_DIR);

  // Group files by base name
  const fileGroups = new Map<string, Set<string>>();

  for (const entry of entries) {
    const ext = path.extname(entry);
    if (![".mp3", ".wav", ".vtt", ".txt", ".srt"].includes(ext)) continue;

    // Handle .wav.vtt, .wav.txt, .wav.srt
    let baseName = entry;
    if (entry.endsWith(".wav.vtt") || entry.endsWith(".wav.txt") || entry.endsWith(".wav.srt")) {
      baseName = entry.replace(/\.wav\.(vtt|txt|srt)$/, "");
    } else {
      baseName = entry.replace(/\.(mp3|wav)$/, "");
    }

    if (!fileGroups.has(baseName)) {
      fileGroups.set(baseName, new Set());
    }
    fileGroups.get(baseName)!.add(entry);
  }

  // Build POCFile objects
  for (const [baseName, fileSet] of fileGroups.entries()) {
    const title = extractTitleFromPOCFilename(baseName);
    const hasVtt = fileSet.has(`${baseName}.wav.vtt`);

    // Only include if has VTT (completed transcription)
    if (!hasVtt) continue;

    files.push({
      baseName,
      title,
      normalizedTitle: normalizeTitle(title),
      mp3Path: path.join(POC_DIR, `${baseName}.mp3`),
      wavPath: path.join(POC_DIR, `${baseName}.wav`),
      vttPath: path.join(POC_DIR, `${baseName}.wav.vtt`),
      txtPath: path.join(POC_DIR, `${baseName}.wav.txt`),
      srtPath: path.join(POC_DIR, `${baseName}.wav.srt`),
      hasVtt,
    });
  }

  return files;
}

/**
 * Match POC file to episode
 */
function matchPOCFileToEpisode(
  pocFile: POCFile,
  episodes: EpisodeInfo[]
): EpisodeInfo | null {
  // Try exact normalized match first
  for (const episode of episodes) {
    if (episode.normalizedTitle === pocFile.normalizedTitle) {
      return episode;
    }
  }

  // Try fuzzy match (contains or is contained by)
  for (const episode of episodes) {
    if (
      episode.normalizedTitle.includes(pocFile.normalizedTitle) ||
      pocFile.normalizedTitle.includes(episode.normalizedTitle)
    ) {
      return episode;
    }
  }

  return null;
}

/**
 * Copy file if it doesn't exist
 */
async function copyFileIfNotExists(
  sourcePath: string,
  destPath: string,
  dryRun: boolean
): Promise<"copied" | "skipped" | "missing"> {
  // Check if source exists
  if (!(await fileExists(sourcePath))) {
    return "missing";
  }

  // Check if destination exists
  if (await fileExists(destPath)) {
    return "skipped";
  }

  if (dryRun) {
    return "copied"; // Would copy
  }

  // Ensure destination directory exists
  await ensureDir(path.dirname(destPath));

  // Copy file
  await fs.copyFile(sourcePath, destPath);
  return "copied";
}

/**
 * Migrate a single POC file to new structure
 */
async function migratePOCFile(
  pocFile: POCFile,
  episode: EpisodeInfo,
  dryRun: boolean
): Promise<{
  copied: number;
  skipped: number;
  failed: number;
}> {
  const stats = { copied: 0, skipped: 0, failed: 0 };

  // Extract title portion from dirName (after the date_)
  // Format: YYYY-MM-DD_title-here -> title-here
  const sanitized = episode.dirName.split("_").slice(1).join("_");

  // Define destination paths
  const destMp3 = path.join(AUDIO_DIR, `${sanitized}.mp3`);
  const destWav = path.join(AUDIO_DIR, `${sanitized}.wav`);
  const transcriptDir = path.join(TRANSCRIPTS_DIR, sanitized);
  const destVtt = path.join(transcriptDir, `${sanitized}.vtt`);
  const destTxt = path.join(transcriptDir, `${sanitized}.txt`);
  const destSrt = path.join(transcriptDir, `${sanitized}.srt`);

  // Copy files
  const filesToCopy = [
    { source: pocFile.mp3Path, dest: destMp3, label: "mp3" },
    { source: pocFile.wavPath, dest: destWav, label: "wav" },
    { source: pocFile.vttPath, dest: destVtt, label: "vtt" },
    { source: pocFile.txtPath, dest: destTxt, label: "txt" },
    { source: pocFile.srtPath, dest: destSrt, label: "srt" },
  ];

  for (const { source, dest, label } of filesToCopy) {
    try {
      const result = await copyFileIfNotExists(source, dest, dryRun);
      if (result === "copied") {
        stats.copied++;
      } else if (result === "skipped") {
        stats.skipped++;
      }
      // Missing files are not counted as failures (txt/srt may not exist)
    } catch (error) {
      logError(`Failed to copy ${label} for ${episode.title}`, error);
      stats.failed++;
    }
  }

  return stats;
}

/**
 * Main migration function
 */
async function migratePOCFiles() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--execute");

  logSection("POC File Migration");

  if (dryRun) {
    logWarning("DRY RUN MODE - No files will be copied");
    logInfo("Use --execute flag to actually copy files");
  }

  const stats: MigrationStats = {
    totalPOCFiles: 0,
    matched: 0,
    unmatched: 0,
    copied: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    // Load episodes
    logInfo("Loading episode metadata...");
    const episodes = await loadEpisodes();
    logSuccess(`Loaded ${episodes.length} episodes`);

    // Scan POC files
    logInfo("Scanning POC files...");
    const pocFiles = await scanPOCFiles();
    stats.totalPOCFiles = pocFiles.length;
    logSuccess(`Found ${pocFiles.length} completed POC transcripts`);

    // Match and migrate
    logSection("Matching and Migrating Files");

    for (let i = 0; i < pocFiles.length; i++) {
      const pocFile = pocFiles[i];
      logProgress(i + 1, pocFiles.length, pocFile.title);

      const match = matchPOCFileToEpisode(pocFile, episodes);

      if (!match) {
        logWarning(`No match found for: ${pocFile.title}`);
        stats.unmatched++;
        continue;
      }

      stats.matched++;

      const result = await migratePOCFile(pocFile, match, dryRun);
      stats.copied += result.copied;
      stats.skipped += result.skipped;
      stats.failed += result.failed;
    }

    // Summary
    logSection("Migration Complete");
    logInfo(`Total POC files: ${stats.totalPOCFiles}`);
    logInfo(`Matched: ${stats.matched}`);
    logInfo(`Unmatched: ${stats.unmatched}`);
    if (!dryRun) {
      logInfo(`Copied: ${stats.copied} files`);
    } else {
      logInfo(`Would copy: ${stats.copied} files`);
    }
    logInfo(`Skipped (already exist): ${stats.skipped} files`);
    if (stats.failed > 0) {
      logError(`Failed: ${stats.failed} files`);
    }

    if (dryRun) {
      logWarning("DRY RUN - No files were actually copied");
      logInfo("Run with --execute to perform the migration");
    }

    if (stats.failed > 0 && !dryRun) {
      process.exit(1);
    }
  } catch (error) {
    logError("Migration failed", error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migratePOCFiles();
}