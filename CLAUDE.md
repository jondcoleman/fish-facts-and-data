# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Automated podcast transcript and fact-extraction pipeline for "No Such Thing As A Fish" with an Astro frontend. Combines RSS feed discovery, Whisper transcription, OpenAI fact extraction, and static site generation.

## Development Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start Astro development server at `localhost:4321` |
| `npm run build` | Build static site to `./dist/` |
| `npm run preview` | Preview production build locally |
| `npm run process` | Run complete episode processing pipeline |
| `npm run discover` | Preview new episodes without processing |
| `npm run extract-facts` | Extract facts from episodes (supports `--limit N` for incremental processing) |

## Project Structure

```
src/
├── data/episodes/           # Episode data (committed to git)
│   └── YYYY-MM-DD_title/   # Per-episode directories
│       ├── facts.json      # Extracted facts (AI-generated, presence = processed)
│       ├── metadata.json   # Episode metadata
│       └── *.transcript.*  # Transcript files
├── scripts/                 # Processing pipeline
│   ├── utils/              # Shared utilities (schemas, logging, file ops)
│   ├── discover.ts         # RSS feed discovery (checks facts.json existence)
│   ├── download.ts         # Audio download & WAV conversion
│   ├── transcribe.ts       # Whisper transcription
│   ├── extract-facts.ts    # OpenAI synchronous API fact extraction
│   ├── process-episodes.ts # Main orchestrator
│   └── retry-facts.ts      # Retry fact extraction for specific episodes
├── lib/
│   └── episodes.ts         # Episode data access for Astro
└── pages/
    ├── index.astro         # Episode list homepage
    └── episodes/[dirName].astro  # Dynamic episode pages
```

## Architecture

### Processing Pipeline

1. **Discovery** (`discover.ts`): Parse RSS feed, check for missing `facts.json` to find new episodes
2. **Download** (`download.ts`): Fetch audio with retry logic, convert to 16kHz mono WAV using ffmpeg
3. **Transcription** (`transcribe.ts`): Run Whisper to generate `.vtt`, `.srt`, `.txt` files
4. **Fact Extraction** (`extract-facts.ts`):
   - Convert VTT → CSV with timestamps
   - Submit to OpenAI synchronous API with structured output schema
   - Rate limiting: 2M TPM with 90% safety margin and exponential backoff
   - Validate with Zod schemas (4 facts for standard episodes)
   - Save `facts.json` in episode directory
   - Episode filtering: Excludes titles starting with "Bonus Compilation" or "Bonus:"
5. **Episode Classification**:
   - Standard episodes: Has `itunes.episode` (not bonus), OR `episodeType: "full"`, OR title starts with number (e.g., "280:" or "280.")
   - Non-standard episodes get empty facts.json (compilations, bonus content)

### Frontend (Astro)

- **Build-time data loading**: `src/lib/episodes.ts` reads episode JSON during build
- **Static generation**: Each episode directory becomes a route via `[dirName].astro`
- **No runtime database**: All data is pre-rendered from JSON files

## Key Files

- **Zod Schemas** (`src/scripts/utils/schemas.ts`): Type-safe validation for episodes and facts
- **Text Utilities** (`src/scripts/utils/text.ts`): Timestamp conversion, filename sanitization, JSON extraction
- **Episode Discovery** (`src/scripts/discover.ts`): Tracks processing via `facts.json` file existence (no separate index)

## Environment Variables

Required in `.env`:
```
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
PODCAST_RSS_FEED_URL=...
```

## Important Notes

- **Native fetch**: Uses Node.js fetch (no axios)
- **ES Modules**: All scripts use ESM with `.js` extensions in imports
- **Error handling**: Scripts return null on failure, never throw during batch processing
- **Synchronous API**: Fact extraction uses OpenAI synchronous API with token rate limiting (2M TPM)
- **Incremental processing**: Use `npm run extract-facts -- --limit N` to process episodes in batches
- **Directory naming**: Episodes stored as `YYYY-MM-DD_sanitized-title` for chronological sorting
- **Git tracking**: Episode JSON is committed; audio/transcripts are gitignored
- **Processing state**: Presence of `facts.json` indicates completed processing (no separate index file)