import "dotenv/config";
import * as fs from "fs-extra";
import * as path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import ffmpeg from "fluent-ffmpeg";
import {
  ensureDir,
  fileExists,
  logInfo,
  logSuccess,
  logError,
  logWarning,
} from "./utils/index.js";

const AUDIO_DIR = "audio";
const MAX_RETRIES = 3;

/**
 * Download audio file from URL with retry logic
 */
export async function downloadAudio(
  url: string,
  filename: string,
  maxRetries = MAX_RETRIES
): Promise<string | null> {
  const filePath = path.join(AUDIO_DIR, filename);

  // Ensure audio directory exists
  await ensureDir(AUDIO_DIR);

  // Check if already exists
  if (await fileExists(filePath)) {
    logInfo(`Audio file already exists: ${filename}`);
    return filePath;
  }

  // Attempt download with retries
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logInfo(
      `Downloading audio: ${filename} (attempt ${attempt}/${maxRetries})`
    );

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(60000), // 60 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      // Convert Web ReadableStream to Node.js Readable
      const webStream = response.body;
      const nodeStream = Readable.fromWeb(webStream as any);

      // Write to file
      const writeStream = fs.createWriteStream(filePath);
      await pipeline(nodeStream, writeStream);

      logSuccess(`Downloaded: ${filename}`);
      return filePath;
    } catch (error) {
      logError(`Download attempt ${attempt} failed for ${filename}`, error);

      // Clean up partial file
      try {
        if (await fileExists(filePath)) {
          await fs.unlink(filePath);
        }
      } catch (cleanupError) {
        logWarning(`Failed to clean up partial file: ${filePath}`);
      }

      if (attempt === maxRetries) {
        logError(`Failed to download ${filename} after ${maxRetries} attempts`);
        return null;
      }

      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      logInfo(`Waiting ${delay}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return null;
}

/**
 * Convert audio file to WAV format required by Whisper
 */
export async function convertToWav(
  inputPath: string,
  outputPath?: string
): Promise<string | null> {
  const wavPath =
    outputPath || inputPath.replace(path.extname(inputPath), ".wav");

  // Check if WAV already exists
  if (await fileExists(wavPath)) {
    logInfo(`WAV file already exists: ${path.basename(wavPath)}`);
    return wavPath;
  }

  logInfo(`Converting to WAV: ${path.basename(inputPath)}`);

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .toFormat("wav")
        .audioFrequency(16000) // 16kHz for Whisper
        .audioChannels(1) // Mono
        .on("end", () => {
          logSuccess(`Converted to WAV: ${path.basename(wavPath)}`);
          resolve();
        })
        .on("error", (err) => {
          logError(`Error converting audio ${inputPath}`, err);
          reject(err);
        })
        .save(wavPath);
    });

    return wavPath;
  } catch (error) {
    logError(`Failed to convert ${inputPath} to WAV`, error);

    // Clean up partial output file
    try {
      if (await fileExists(wavPath)) {
        await fs.unlink(wavPath);
      }
    } catch (cleanupError) {
      logWarning(`Failed to clean up partial WAV file: ${wavPath}`);
    }

    return null;
  }
}

/**
 * Download and prepare audio file (download + convert to WAV)
 */
export async function downloadAndPrepareAudio(
  url: string,
  filename: string
): Promise<{ audioPath: string; wavPath: string } | null> {
  // Download audio
  const audioPath = await downloadAudio(url, filename);
  if (!audioPath) {
    return null;
  }

  // Convert to WAV
  const wavPath = await convertToWav(audioPath);
  if (!wavPath) {
    return null;
  }

  return { audioPath, wavPath };
}