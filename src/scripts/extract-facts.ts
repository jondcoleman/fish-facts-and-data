import "dotenv/config";
import * as fs from "fs/promises";
import * as path from "path";
import OpenAI from "openai";
import { parse as parseSubtitle } from "@plussub/srt-vtt-parser";
import { stringify } from "csv-stringify/sync";
import {
  EpisodeSchema,
  secondsToHHMMSS,
  sanitizeCsvText,
  extractJson,
  fileExists,
  writeJson,
  logInfo,
  logSuccess,
  logError,
  logWarning,
  logSection,
  getEpisodeDir,
  readJson,
} from "./utils/index.js";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Token tracking for rate limiting
 */
class TokenTracker {
  private tokensUsed: { timestamp: number; tokens: number }[] = [];
  private readonly maxTPM: number;
  private readonly safetyMargin = 0.9; // Use 90% of limit to be safe

  constructor(maxTPM: number = 2_000_000) {
    this.maxTPM = maxTPM * this.safetyMargin;
  }

  /**
   * Add tokens to tracker
   */
  add(tokens: number) {
    this.tokensUsed.push({ timestamp: Date.now(), tokens });
    this.cleanup();
  }

  /**
   * Remove entries older than 60 seconds
   */
  private cleanup() {
    const cutoff = Date.now() - 60000;
    this.tokensUsed = this.tokensUsed.filter((t) => t.timestamp > cutoff);
  }

  /**
   * Get total tokens used in last 60 seconds
   */
  getUsage(): number {
    this.cleanup();
    return this.tokensUsed.reduce((sum, t) => sum + t.tokens, 0);
  }

  /**
   * Check if we can add tokens without exceeding limit
   */
  canAdd(tokens: number): boolean {
    return this.getUsage() + tokens <= this.maxTPM;
  }

  /**
   * Wait until we can add tokens
   */
  async waitForCapacity(tokens: number) {
    while (!this.canAdd(tokens)) {
      const usage = this.getUsage();
      const waitTime = Math.ceil((usage + tokens - this.maxTPM) / (this.maxTPM / 60));
      logInfo(`Rate limit approaching. Waiting ${waitTime}s...`);
      await new Promise((resolve) => setTimeout(resolve, Math.max(1000, waitTime * 1000)));
    }
  }
}

/**
 * Estimate tokens in text (rough approximation: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Prepare VTT file for processing (convert to CSV)
 */
export async function prepareVttFile(
  vttPath: string,
  outputDir: string,
  force = false
): Promise<{ csv: string; outputPath: string } | null> {
  const base = path.basename(vttPath, ".vtt");
  const outJsonTranscript = path.join(outputDir, `${base}.transcript.json`);
  const outCsvTranscript = path.join(outputDir, `${base}.transcript.csv`);
  const outFacts = path.join(outputDir, `facts.json`);

  // Check if output already exists and skip unless forced
  if (!force && (await fileExists(outFacts))) {
    return null;
  }

  // Read VTT
  let vttContent: string;
  try {
    vttContent = await fs.readFile(vttPath, "utf-8");
  } catch (error) {
    logError(`Read failed: ${vttPath}`, error);
    return null;
  }

  // Parse using @plussub/srt-vtt-parser
  let parsed;
  try {
    parsed = parseSubtitle(vttContent);
  } catch (error) {
    logError(`Subtitle parse failed: ${vttPath}`, error);
    return null;
  }

  // Extract cues
  const cues: { start: number; end: number; text: string }[] = Array.isArray(
    parsed
  )
    ? parsed.map((c: any) => ({
      start: (c.from || c.start || 0) / 1000, // Convert ms to seconds
      end: (c.to || c.end || 0) / 1000,
      text: c.text,
    }))
    : ((parsed as any).entries || (parsed as any).cues || []).map((c: any) => ({
      start: (c.from || c.start || 0) / 1000,
      end: (c.to || c.end || 0) / 1000,
      text: c.text,
    }));

  // Save JSON transcript
  try {
    await writeJson(outJsonTranscript, cues);
  } catch (error) {
    logWarning(`Could not write ${outJsonTranscript}`);
  }

  // Build CSV
  const records = cues.map((c) => ({
    start_hhmmss: secondsToHHMMSS(c.start),
    end_hhmmss: secondsToHHMMSS(c.end),
    text: sanitizeCsvText(c.text),
  }));

  const csv = stringify(records, {
    header: true,
    columns: ["start_hhmmss", "end_hhmmss", "text"],
  });

  try {
    await fs.writeFile(outCsvTranscript, csv, "utf-8");
  } catch (error) {
    logWarning(`Could not write ${outCsvTranscript}`);
  }

  return { csv, outputPath: outFacts };
}

/**
 * Create prompt for fact extraction
 */
function createPrompt(fileBase: string, csv: string): string {
  const instructions = `
You are given a transcript of a STANDARD episode of "No Such Thing As A Fish" podcast in CSV format with columns: start_hhmmss,end_hhmmss,text.

This is a regular weekly episode with exactly FOUR numbered facts. Your task is to extract these four facts.

FACT EXTRACTION:
- Extract the exact 1-2 sentence wording of each fact as stated by the presenter
- Each fact is numbered 1-4
- The four main hosts are: James Harkin, Anna Ptaszynski, Dan Schreiber, Andrew Hunter Murray
- If only first names are used (James, Anna, Dan, Andy/Andrew), match to full names above
- Identify guest presenters by context (they'll be introduced by name)
- Almost never does the same person present multiple facts in one episode
- Start times should be HH:MM:SS format from the transcript; use "unknown" if unreliable

Facts are typically introduced with patterns like:
- "It's time for fact number 1/2/3/4"
- "Our first/second/third/final fact of the show"
- "Okay, it is time for fact number X and that is [Name]"

Example fact introduction:
---
00:37:02.560 --> 00:37:07.260
 - Okay, it is time for a final fact of the show

00:37:07.260 --> 00:37:09.020
 and that is Anna.
---

SUMMARY: Provide a brief 1-2 sentence summary of the episode's topics.

Return only JSON that matches the provided schema.`;

  return `Filename: ${fileBase}.vtt\n\nTranscript CSV:\n${csv}`;
}

/**
 * Extract facts from a single episode using synchronous API
 */
async function extractFactsFromEpisode(
  fileBase: string,
  csv: string,
  outputPath: string,
  retries = 3
): Promise<boolean> {
  const prompt = createPrompt(fileBase, csv);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: `You are given a transcript of a STANDARD episode of "No Such Thing As A Fish" podcast in CSV format with columns: start_hhmmss,end_hhmmss,text.

This is a regular weekly episode with exactly FOUR numbered facts. Your task is to extract these four facts.

FACT EXTRACTION:
- Extract the exact 1-2 sentence wording of each fact as stated by the presenter
- Each fact is numbered 1-4
- The four main hosts are: James Harkin, Anna Ptaszynski, Dan Schreiber, Andrew Hunter Murray
- If only first names are used (James, Anna, Dan, Andy/Andrew), match to full names above
- Identify guest presenters by context (they'll be introduced by name)
- Almost never does the same person present multiple facts in one episode
- Start times should be HH:MM:SS format from the transcript; use "unknown" if unreliable

Facts are typically introduced with patterns like:
- "It's time for fact number 1/2/3/4"
- "Our first/second/third/final fact of the show"
- "Okay, it is time for fact number X and that is [Name]"

Example fact introduction:
---
00:37:02.560 --> 00:37:07.260
 - Okay, it is time for a final fact of the show

00:37:07.260 --> 00:37:09.020
 and that is Anna.
---

SUMMARY: Provide a brief 1-2 sentence summary of the episode's topics.

Return only JSON that matches the provided schema.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: MODEL.startsWith("gpt-5") ? 1 : 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "episode_extraction",
            schema: {
              type: "object",
              properties: {
                episode_type: {
                  type: "string",
                  const: "standard",
                },
                episode_summary: { type: "string" },
                facts: {
                  type: "array",
                  minItems: 4,
                  maxItems: 4,
                  items: {
                    type: "object",
                    properties: {
                      fact_number: { type: "integer", minimum: 1, maximum: 4 },
                      fact: { type: "string" },
                      presenter: { type: "string" },
                      guest: { type: "boolean" },
                      start_time: {
                        type: "string",
                        pattern: "^(\\d{2}:\\d{2}:\\d{2}|unknown)$",
                      },
                    },
                    required: [
                      "fact_number",
                      "fact",
                      "presenter",
                      "guest",
                      "start_time",
                    ],
                    additionalProperties: false,
                  },
                },
              },
              required: ["episode_type", "episode_summary", "facts"],
              additionalProperties: false,
            },
            strict: true,
          },
        },
      });

      const text = response.choices[0]?.message?.content;
      if (!text || !text.trim()) {
        throw new Error("Empty response from model");
      }

      const obj = extractJson(text.trim());
      const parsedEpisode = EpisodeSchema.parse(obj);

      // Additional constraint: standard must have 4
      if (
        parsedEpisode.episode_type === "standard" &&
        parsedEpisode.facts.length !== 4
      ) {
        throw new Error("Validation: standard episode must have 4 facts");
      }

      await writeJson(outputPath, parsedEpisode);
      return true;
    } catch (error: any) {
      // Handle rate limit errors with exponential backoff
      if (error?.status === 429 && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        logWarning(
          `Rate limited (attempt ${attempt}/${retries}). Waiting ${waitTime / 1000}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }

      // Log error and return false on final attempt
      if (attempt === retries) {
        logError(`Failed to extract facts for ${fileBase}`, error);
        return false;
      }
    }
  }

  return false;
}

/**
 * Find all episodes that need fact extraction
 */
async function findEpisodesNeedingFacts(): Promise<
  { vttPath: string; outputDir: string; dirName: string }[]
> {
  const EPISODES_DIR = path.join(process.cwd(), "src/data/episodes");
  const entries = await fs.readdir(EPISODES_DIR, { withFileTypes: true });

  const episodes: { vttPath: string; outputDir: string; dirName: string }[] =
    [];

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const episodeDir = getEpisodeDir(entry.name);
      const metadataPath = path.join(episodeDir, "metadata.json");
      const vttPath = path.join(episodeDir, "transcript.vtt");
      const factsPath = path.join(episodeDir, "facts.json");

      // Skip if facts already exist or no transcript
      if (
        (await fileExists(factsPath)) ||
        !(await fileExists(vttPath)) ||
        !(await fileExists(metadataPath))
      ) {
        continue;
      }

      // Check if it's a standard episode
      const metadata = await readJson<any>(metadataPath);

      const hasEpisodeNumber =
        metadata.itunes?.episode && metadata.itunes?.episodeType !== "bonus";
      const isFullEpisode = metadata.itunes?.episodeType === "full";
      const titleHasNumber = /^\d+[.:]/.test(metadata.title);
      const titleHasCompilationOrBonus = /compilation|^bonus/i.test(metadata.title);
      const isStandard = (hasEpisodeNumber || isFullEpisode || titleHasNumber) && !titleHasCompilationOrBonus;

      if (isStandard) {
        episodes.push({ vttPath, outputDir: episodeDir, dirName: entry.name });
      }
    }
  }

  return episodes;
}

/**
 * Extract facts from VTT files using synchronous API
 */
export async function extractFactsFromVtt(
  vttPaths: string[],
  outputDirs: string[],
  force = false
): Promise<{ ok: number; fail: number; skipped: number }> {
  logSection("Fact Extraction");

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not set in environment");
  }

  const tokenTracker = new TokenTracker();
  let ok = 0;
  let fail = 0;
  let skipped = 0;

  // Process each episode
  for (let i = 0; i < vttPaths.length; i++) {
    const vttPath = vttPaths[i];
    const outputDir = outputDirs[i];

    logInfo(`[${i + 1}/${vttPaths.length}] Processing: ${path.basename(vttPath)}`);

    const prepared = await prepareVttFile(vttPath, outputDir, force);
    if (!prepared) {
      skipped++;
      continue;
    }

    const { csv, outputPath } = prepared;
    const fileBase = path.basename(vttPath, ".vtt");

    // Estimate tokens for this request
    const estimatedTokens = estimateTokens(csv) + 2000; // CSV + prompt + response

    // Wait for rate limit capacity
    await tokenTracker.waitForCapacity(estimatedTokens);

    // Extract facts
    const success = await extractFactsFromEpisode(fileBase, csv, outputPath);

    if (success) {
      logSuccess(`✓ Extracted facts: ${fileBase}`);
      ok++;
    } else {
      fail++;
    }

    // Track tokens used
    tokenTracker.add(estimatedTokens);
  }

  return { ok, fail, skipped };
}

/**
 * Main function for CLI usage
 */
async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit")
    ? parseInt(args[args.indexOf("--limit") + 1] || "0")
    : undefined;

  logSection("Fact Extraction - Synchronous API");

  // Find all episodes needing facts
  const episodes = await findEpisodesNeedingFacts();

  if (episodes.length === 0) {
    logInfo("No episodes need fact extraction");
    return;
  }

  const episodesToProcess = limit ? episodes.slice(0, limit) : episodes;

  logInfo(
    `Found ${episodes.length} episodes needing facts${limit ? `, processing first ${episodesToProcess.length}` : ""}`
  );

  const vttPaths = episodesToProcess.map((e) => e.vttPath);
  const outputDirs = episodesToProcess.map((e) => e.outputDir);

  const result = await extractFactsFromVtt(vttPaths, outputDirs, false);

  logSection("Complete");
  logInfo(`Successful: ${result.ok}`);
  logInfo(`Failed: ${result.fail}`);
  logInfo(`Skipped: ${result.skipped}`);

  if (result.fail > 0) {
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logError("Script failed", error);
    process.exit(1);
  });
}