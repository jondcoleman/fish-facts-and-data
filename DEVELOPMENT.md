# Development Notes

## Overview
This project processes the "No Such Thing As A Fish" podcast RSS feed to automatically extract episode metadata, transcribe audio, and use AI to extract the 4 main facts from each standard episode.

## Quick Start (After Coming Back)

### Check for New Episodes
```bash
npm run discover
```

### Process New Episodes
```bash
npm run process
```

### Fix Failed Fact Extraction
```bash
tsx src/scripts/retry-facts.ts <episode-number>
```

### Run Dev Server
```bash
npm run dev
```

## Key Design Decisions

### Episode Type Classification (Important!)
**Problem**: Early versions used gpt-4o-mini to classify episode types, but it was inaccurate and costly (~100+ API calls for non-standard episodes).

**Solution**: Filter episodes by RSS metadata **before** sending to LLM:
- Check `metadata.itunes.episode` (has number) AND `episodeType !== "bonus"`
- OR check `episodeType === "full"`
- OR check if title starts with number (e.g., "575. No Such Thing...")

Only standard episodes get sent to OpenAI. Non-standard episodes get empty facts.json immediately.

**Location**: `src/scripts/process-episodes.ts` lines 170-196

### Transcription File Locations
**Problem**: whisper-node ignores output_dir and creates files next to input WAV files.

**Solution**: Let whisper create files wherever it wants, then move them to episode directories using fs.rename.

**Location**: `src/scripts/transcribe.ts` lines 82-99

### Fact Extraction Schema
Standard episodes must have **exactly 4 facts** (minItems: 4, maxItems: 4). The schema enforces:
- `episode_type: "standard"` (const)
- `facts` array with exactly 4 items
- Each fact has: number (1-4), fact text, presenter, guest flag, start_time

**Location**: `src/scripts/extract-facts.ts` lines 41-97

## Migration Scripts (One-Time Use)

These scripts were used during initial setup and should NOT be run again:

### `bootstrap-episodes.ts`
One-time script to populate episode metadata from RSS feed without processing audio.
- ✅ Already run - populated ~350+ episodes
- ⚠️ Do not run again unless starting fresh

### `migrate-poc-files.ts`
One-time migration from old POC project structure.
- ✅ Already run - migrated audio/transcripts from `../fish-transcripts-node/`
- ⚠️ POC directory no longer exists, script will fail

### `migrate-audio-urls.ts`
One-time migration to extract Patreon-protected URLs from metadata.json to audio-urls.json.
- ✅ Already run - moved audioUrl, enclosure, itunes.image to gitignored file
- ⚠️ Do not run again - would overwrite current audio-urls.json

## Active Scripts (Use Regularly)

### `process-episodes.ts` (npm run process)
Main pipeline orchestrator. Use this for weekly processing.
- Discovers new episodes from RSS
- Downloads audio and converts to WAV
- Transcribes with Whisper
- Classifies episode type by metadata
- Extracts facts (standard episodes only)
- Marks episodes as processed

### `retry-facts.ts`
Re-extract facts for specific episodes. Use when:
- Fact extraction failed
- Need to improve fact quality
- OpenAI API had issues

### `discover.ts` (npm run discover)
Preview what would be processed without actually doing it. Use to check for new episodes.

### `debug-rss.ts` (npm run debug-rss)
Debug RSS feed parsing. Use if RSS feed format changes or you're getting unexpected results.

## File Structure

### Episode Directories
Each episode gets a directory: `YYYY-MM-DD_episode-number-episode-title`

Example: `2025-03-21_575-no-such-thing-as-a-guinea-pig-saloon/`

Contains:
- `metadata.json` - Episode metadata from RSS (sans protected URLs)
- `audio-urls.json` - Patreon-protected URLs (gitignored)
- `facts.json` - Extracted facts or empty for non-standard episodes
- `transcript.vtt` - WebVTT format with timestamps
- `transcript.srt` - SubRip format with timestamps
- `transcript.txt` - Plain text without timestamps
- `*.mp3` or `*.wav` - Audio files (gitignored)

### Tracking File
`src/data/episodes/index.json` tracks processed episodes:
```json
{
  "processed": ["episode-id-1", "episode-id-2", ...],
  "lastUpdated": "ISO-8601-timestamp"
}
```

## Common Issues

### Episode Not Getting Facts
1. Check if it's a standard episode: `tsx src/scripts/retry-facts.ts <number>`
2. If script says "not a standard episode":
   - Check `metadata.json` - does it have `itunes.episode`?
   - Is `itunes.episodeType` set to "bonus"?
   - Does title start with a number?
3. If none of above, it's correctly classified as non-standard (e.g., "Your Facts" audience episodes)

### Transcription Issues
1. Check if audio file exists in episode directory
2. Check if WAV conversion succeeded (look for .wav file)
3. Try re-running with different Whisper model: `npm run process -- --model small`

### OpenAI Batch API Issues
1. Check batch status in OpenAI dashboard
2. Batches can take 5-30 minutes to complete
3. Failed batches are logged but don't stop the pipeline
4. Use `retry-facts.ts` to retry specific episodes

## Environment Variables

Required:
- `OPENAI_API_KEY` - OpenAI API key (for gpt-4o)
- `PODCAST_RSS_FEED_URL` - RSS feed URL with auth token

Optional:
- `OPENAI_MODEL` - Override model (default: gpt-4o)

## Testing Changes

### Test on Single Episode
```bash
npm run process -- --limit 1
```

### Test Fact Extraction Only
```bash
tsx src/scripts/retry-facts.ts <episode-number>
```

### Test Frontend
```bash
npm run dev
# Visit http://localhost:4321
```

## Git Workflow

### What Gets Committed
- Episode metadata.json
- Episode facts.json
- Transcripts (.vtt, .srt, .txt)
- index.json (processed tracking)
- Scripts and code changes

### What's Gitignored
- audio-urls.json (contains Patreon-protected URLs)
- Audio files (.mp3, .wav)
- .env file

### Commit Message Examples
```bash
git commit -m "Process episodes 575-580"
git commit -m "Retry fact extraction for episode 601"
git commit -m "Fix: Update episode classification logic"
```

## Future Improvements

### Potential Enhancements
1. Add caching for OpenAI responses to reduce costs on retries
2. Add validation for fact quality (e.g., check if start_time is reasonable)
3. Add support for updating existing episodes when RSS metadata changes
4. Add web scraping for show notes to supplement facts
5. Add search functionality to frontend

### Known Limitations
1. Whisper sometimes misidentifies speakers
2. Start times may be approximate due to transcript chunking
3. Guest detection relies on LLM inference, not always accurate
4. No automatic detection of episode corrections/updates