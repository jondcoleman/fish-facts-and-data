import * as fs from "fs-extra";
import * as path from "path";

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.ensureDir(dirPath);
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively find all files with a specific extension in a directory
 */
export async function findFilesByExtension(
  dir: string,
  extension: string
): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && fullPath.toLowerCase().endsWith(extension)) {
        results.push(fullPath);
      }
    }
  }

  const stat = await fs.stat(dir).catch(() => null);
  if (!stat) {
    throw new Error(`Path not found: ${dir}`);
  }

  if (stat.isFile()) {
    if (dir.toLowerCase().endsWith(extension)) {
      return [dir];
    }
    throw new Error(`File is not ${extension}: ${dir}`);
  }

  await walk(dir);
  return results;
}

/**
 * Write JSON data to file with pretty formatting
 */
export async function writeJson(
  filePath: string,
  data: unknown
): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Read and parse JSON file
 */
export async function readJson<T = unknown>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content) as T;
}