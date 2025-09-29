import "dotenv/config";
import * as fs from "fs/promises";
import { createReadStream } from "fs";
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
} from "./utils/index.js";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Prepared VTT file data for batch processing
 */
interface PreparedVtt {
  fileBase: string;
  csv: string;
  outputPath: string;
}

/**
 * Create batch request for OpenAI API
 */
function createBatchRequest({
  fileBase,
  csv,
  customId,
}: {
  fileBase: string;
  csv: string;
  customId: string;
}) {
  const instructions = `
You are given a transcript of an episode of "No Such Thing As A Fish" podcast in CSV format with columns: start_hhmmss,end_hhmmss,text.

EPISODE TYPE CLASSIFICATION (CRITICAL):
- "standard": The regular weekly episode format with exactly FOUR numbered facts (fact 1, fact 2, fact 3, fact 4). This is the default and most common type. Episodes are numbered (e.g., "575. No Such Thing As..."). If you see phrases like "it's time for fact number 1/2/3/4" or "our first/second/third/final fact", this is STANDARD.
- "bonus": Special episodes that explicitly have "bonus" in the title (e.g., "Bonus: Drop Us A Line", "Bonus: Meet The Elves"). These typically do NOT follow the four-fact structure.
- "compilation": Episodes with "compilation" in the title. These are clip shows and do NOT have four new facts.
- "other": Quizzes, live shows with unusual formats, or anything truly unusual.

IMPORTANT: If the episode follows the standard pattern of introducing four numbered facts with phrases like "it's time for fact number X" or "our Xth fact of the show", it is STANDARD, not bonus or other. Most numbered episodes (e.g., "575", "602") are STANDARD.

FACT EXTRACTION (for STANDARD episodes only):
- Extract the exact 1-2 sentence wording of each fact as stated by the presenter
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

For NON-STANDARD episodes (compilation, bonus, other): Return an EMPTY facts array.

Return only JSON that matches the provided schema.`;

  const input = `Filename: ${fileBase}.vtt\n\nTranscript CSV:\n${csv}`;

  return {
    custom_id: customId,
    method: "POST",
    url: "/v1/chat/completions",
    body: {
      model: MODEL,
      messages: [
        {
          role: "system",
          content: instructions,
        },
        {
          role: "user",
          content: input,
        },
      ],
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "episode_extraction",
          schema: {
            type: "object",
            properties: {
              episode_type: {
                type: "string",
                enum: ["standard", "compilation", "bonus", "other"],
              },
              episode_summary: { type: "string" },
              facts: {
                type: "array",
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
    },
  };
}

/**
 * Prepare VTT file for batch processing (convert to CSV)
 */
export async function prepareVttFile(
  vttPath: string,
  outputDir: string,
  force = false
): Promise<PreparedVtt | null> {
  const base = path.basename(vttPath, ".vtt");
  const outJsonTranscript = path.join(outputDir, `${base}.transcript.json`);
  const outCsvTranscript = path.join(outputDir, `${base}.transcript.csv`);
  const outFacts = path.join(outputDir, `facts.json`);

  // Check if output already exists and skip unless forced
  if (!force && (await fileExists(outFacts))) {
    logInfo(`Skipping ${vttPath} (facts.json already exists)`);
    return null;
  }

  logInfo(`Preparing: ${vttPath}`);

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

  return { fileBase: base, csv, outputPath: outFacts };
}

/**
 * Process batch results and save validated episodes
 */
async function processBatchResults(
  batchResults: any[],
  fileMap: Map<string, string>
): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let fail = 0;

  for (const result of batchResults) {
    const { custom_id, response, error } = result;
    const outputPath = fileMap.get(custom_id);

    if (!outputPath) {
      logError(`No output path found for custom_id: ${custom_id}`);
      fail++;
      continue;
    }

    if (error) {
      logError(`API error for ${custom_id}: ${error.message}`);
      fail++;
      continue;
    }

    try {
      const text = response.body.choices[0]?.message?.content;
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
      logSuccess(`Wrote ${outputPath}`);
      ok++;
    } catch (error) {
      logError(`Failed to process ${custom_id}`, error);
      fail++;
    }
  }

  return { ok, fail };
}

/**
 * Create and submit batch file to OpenAI
 */
async function createAndSubmitBatch(
  batchRequests: any[]
): Promise<string> {
  const batchContent = batchRequests.map((req) => JSON.stringify(req)).join("\n");
  const tempFile = path.join(process.cwd(), `batch_${Date.now()}.jsonl`);

  await fs.writeFile(tempFile, batchContent, "utf-8");

  try {
    // Upload batch file
    const fileStream = createReadStream(tempFile);
    const file = await client.files.create({
      file: fileStream,
      purpose: "batch",
    });

    // Submit batch
    const batch = await client.batches.create({
      input_file_id: file.id,
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
    });

    // Clean up local file
    await fs.unlink(tempFile);

    return batch.id;
  } catch (error) {
    // Clean up on error
    try {
      await fs.unlink(tempFile);
    } catch {}
    throw error;
  }
}

/**
 * Wait for batch completion
 */
async function waitForBatchCompletion(batchId: string): Promise<any> {
  logInfo(`Waiting for batch ${batchId} to complete...`);

  while (true) {
    const batch = await client.batches.retrieve(batchId);
    logInfo(`Batch status: ${batch.status}`);

    if (batch.status === "completed") {
      return batch;
    } else if (
      batch.status === "failed" ||
      batch.status === "expired" ||
      batch.status === "cancelled"
    ) {
      throw new Error(`Batch failed with status: ${batch.status}`);
    }

    // Wait 30 seconds before checking again
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
}

/**
 * Download batch results
 */
async function downloadBatchResults(outputFileId: string): Promise<any[]> {
  const fileResponse = await client.files.content(outputFileId);
  const results = [];
  const lines = (await fileResponse.text()).trim().split("\n");

  for (const line of lines) {
    if (line.trim()) {
      results.push(JSON.parse(line));
    }
  }

  return results;
}

/**
 * Extract facts from VTT files using OpenAI Batch API
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

  const batchRequests = [];
  const fileMap = new Map<string, string>();
  let skipped = 0;

  // Prepare all files
  for (let i = 0; i < vttPaths.length; i++) {
    const vttPath = vttPaths[i];
    const outputDir = outputDirs[i];

    const prepared = await prepareVttFile(vttPath, outputDir, force);
    if (prepared) {
      const customId = `request_${i}_${path.basename(vttPath, ".vtt")}`;
      const batchRequest = createBatchRequest({
        fileBase: prepared.fileBase,
        csv: prepared.csv,
        customId,
      });

      batchRequests.push(batchRequest);
      fileMap.set(customId, prepared.outputPath);
    } else {
      skipped++;
    }
  }

  if (batchRequests.length === 0) {
    logInfo("All files already processed");
    return { ok: 0, fail: 0, skipped };
  }

  logInfo(`Created ${batchRequests.length} batch requests`);

  // Submit batch
  const batchId = await createAndSubmitBatch(batchRequests);
  logSuccess(`Batch submitted: ${batchId}`);

  // Wait for completion
  const completedBatch = await waitForBatchCompletion(batchId);

  // Download and process results
  const batchResults = await downloadBatchResults(
    completedBatch.output_file_id
  );
  const { ok, fail } = await processBatchResults(batchResults, fileMap);

  return { ok, fail, skipped };
}