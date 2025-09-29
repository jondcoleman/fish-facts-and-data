/**
 * Simple logging utility with consistent formatting
 */

export function logInfo(message: string): void {
  console.log(`ℹ️  ${message}`);
}

export function logSuccess(message: string): void {
  console.log(`✅ ${message}`);
}

export function logError(message: string, error?: Error | unknown): void {
  console.error(`❌ ${message}`);
  if (error) {
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
    } else {
      console.error(`   ${String(error)}`);
    }
  }
}

export function logWarning(message: string): void {
  console.warn(`⚠️  ${message}`);
}

export function logSkip(message: string): void {
  console.log(`⏭️  ${message}`);
}

export function logProgress(current: number, total: number, message: string): void {
  console.log(`[${current}/${total}] ${message}`);
}

export function logSection(title: string): void {
  console.log(`\n=== ${title} ===\n`);
}