import "dotenv/config";
import * as path from "path";
// @ts-expect-error - whisper-node has no type definitions
import { whisper } from "whisper-node";
import {
  ensureDir,
  fileExists,
  sanitizeFilename,
  logInfo,
  logSuccess,
  logError,
  logWarning,
} from "./utils/index.js";

const TRANSCRIPTS_DIR = "transcripts";

/**
 * Options for Whisper transcription
 */
interface TranscribeOptions {
  modelName?: "tiny" | "base" | "small" | "medium" | "large";
  language?: string;
}

/**
 * Result from transcription process
 */
interface TranscriptionResult {
  txtPath: string;
  vttPath: string;
  srtPath: string;
  transcriptExists?: boolean;
}

/**
 * Download Whisper model if not already present
 * Note: whisper-node handles this automatically on first run
 */
export async function ensureWhisperModel(
  modelName: string = "small"
): Promise<void> {
  logInfo(`Using Whisper model: ${modelName}`);
  logWarning(
    "Note: Model will be downloaded automatically on first transcription if not present"
  );
}

/**
 * Transcribe audio file using Whisper
 */
export async function transcribeAudio(
  wavPath: string,
  episodeTitle: string,
  options: TranscribeOptions = {}
): Promise<TranscriptionResult | null> {
  const { modelName = "small", language = "auto" } = options;

  // Create sanitized filename
  const sanitizedTitle = sanitizeFilename(episodeTitle);
  const outputDir = path.join(TRANSCRIPTS_DIR, sanitizedTitle);

  await ensureDir(outputDir);

  const basePath = path.join(outputDir, sanitizedTitle);
  const txtPath = `${basePath}.txt`;
  const vttPath = `${basePath}.vtt`;
  const srtPath = `${basePath}.srt`;

  // Check if transcript already exists
  if (await fileExists(vttPath)) {
    logInfo(`Transcript already exists: ${episodeTitle}`);
    return {
      txtPath,
      vttPath,
      srtPath,
      transcriptExists: true,
    };
  }

  logInfo(`Transcribing: ${episodeTitle}`);
  logInfo(`Audio path: ${wavPath}`);

  try {
    // Verify WAV file exists and is readable
    if (!(await fileExists(wavPath))) {
      throw new Error(`WAV file not found: ${wavPath}`);
    }

    const whisperOptions = {
      modelName,
      whisperOptions: {
        language: language === "auto" ? undefined : language,
        gen_file_txt: true,
        gen_file_subtitle: true,
        gen_file_vtt: true,
        word_timestamps: false,
        output_dir: outputDir,
        output_file: sanitizedTitle,
      },
    };

    await whisper(wavPath, whisperOptions);

    logSuccess(`Transcription complete for: ${episodeTitle}`);

    return {
      txtPath,
      vttPath,
      srtPath,
    };
  } catch (error) {
    logError(`Error in transcription for ${episodeTitle}`, error);
    return null;
  }
}

/**
 * Generate CSV from VTT file (for fact extraction)
 * This will be used in the fact extraction phase
 */
export function getTranscriptPaths(episodeTitle: string): {
  txtPath: string;
  vttPath: string;
  srtPath: string;
} {
  const sanitizedTitle = sanitizeFilename(episodeTitle);
  const outputDir = path.join(TRANSCRIPTS_DIR, sanitizedTitle);
  const basePath = path.join(outputDir, sanitizedTitle);

  return {
    txtPath: `${basePath}.txt`,
    vttPath: `${basePath}.vtt`,
    srtPath: `${basePath}.srt`,
  };
}