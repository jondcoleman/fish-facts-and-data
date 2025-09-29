import "dotenv/config";
import * as path from "path";
import { fileURLToPath } from "url";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const EPISODES_DIR = path.join(PROJECT_ROOT, "src/data/episodes");

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
  modelName: string = "base"
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
  episodeDirName: string,
  options: TranscribeOptions = {}
): Promise<TranscriptionResult | null> {
  const { modelName = "base", language = "auto" } = options;

  // Transcripts go in episode directory
  const outputDir = path.join(EPISODES_DIR, episodeDirName);
  await ensureDir(outputDir);

  const txtPath = path.join(outputDir, "transcript.txt");
  const vttPath = path.join(outputDir, "transcript.vtt");
  const srtPath = path.join(outputDir, "transcript.srt");

  // Check if transcript already exists
  if (await fileExists(vttPath)) {
    logInfo(`Transcript already exists: ${episodeDirName}`);
    return {
      txtPath,
      vttPath,
      srtPath,
      transcriptExists: true,
    };
  }

  logInfo(`Transcribing: ${episodeDirName}`);
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
        output_file: "transcript",
      },
    };

    await whisper(wavPath, whisperOptions);

    // Verify that transcription actually created the VTT file
    if (!(await fileExists(vttPath))) {
      throw new Error(`Transcription completed but VTT file was not created: ${vttPath}`);
    }

    logSuccess(`Transcription complete for: ${episodeDirName}`);

    return {
      txtPath,
      vttPath,
      srtPath,
    };
  } catch (error) {
    logError(`Error in transcription for ${episodeDirName}`, error);
    return null;
  }
}

/**
 * Get transcript paths for an episode
 */
export function getTranscriptPaths(episodeDirName: string): {
  txtPath: string;
  vttPath: string;
  srtPath: string;
} {
  const episodeDir = path.join(EPISODES_DIR, episodeDirName);

  return {
    txtPath: path.join(episodeDir, "transcript.txt"),
    vttPath: path.join(episodeDir, "transcript.vtt"),
    srtPath: path.join(episodeDir, "transcript.srt"),
  };
}