import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const IGNORE_FILE = "episodes-ignore.txt";

/** Project root (repo root) from this file: src/scripts/utils/episode-ignore.ts */
function getProjectRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "../../..");
}

/**
 * Load episode directory names to ignore from episodes-ignore.txt in project root.
 * Path is resolved from script location so it works regardless of process.cwd().
 * File format: one dirName per line; lines starting with # or blank are skipped.
 * Returns a Set of dirNames (trimmed). If the file is missing, returns an empty Set.
 */
export async function loadEpisodeIgnoreList(): Promise<Set<string>> {
  const ignorePath = path.join(getProjectRoot(), IGNORE_FILE);
  try {
    const content = await fs.readFile(ignorePath, "utf-8");
    const set = new Set<string>();
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      set.add(trimmed);
    }
    return set;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return new Set();
    }
    throw err;
  }
}
