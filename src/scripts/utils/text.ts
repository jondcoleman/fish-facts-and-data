/**
 * Convert seconds (float) to HH:MM:SS format
 */
export function secondsToHHMMSS(s: number): string {
  const total = Math.max(0, Math.floor(s));
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Sanitize text for CSV export - collapse whitespace and trim
 */
export function sanitizeCsvText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Sanitize filename by replacing non-alphanumeric characters with underscores
 */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Create episode directory name in format: YYYY-MM-DD_episode-title-sanitized
 */
export function createEpisodeDirName(publishDate: Date, title: string): string {
  const dateStr = publishDate.toISOString().split("T")[0]; // YYYY-MM-DD
  const sanitizedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing dashes

  return `${dateStr}_${sanitizedTitle}`;
}

/**
 * Extract JSON from various response formats (raw JSON, markdown code blocks, or embedded JSON)
 */
export function extractJson(text: string): unknown {
  // Try parsing as-is first
  try {
    return JSON.parse(text);
  } catch {}

  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {}
  }

  // Try finding JSON object in text
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }

  throw new Error("Could not parse JSON from model output");
}