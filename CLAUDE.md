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

## Project Structure

```
src/
├── data/episodes/           # Episode data (committed to git)
│   ├── index.json          # Tracks processed episodes
│   └── YYYY-MM-DD_title/   # Per-episode directories
│       ├── facts.json      # Extracted facts (AI-generated)
│       ├── metadata.json   # Episode metadata
│       └── *.transcript.*  # Transcript files
├── scripts/                 # Processing pipeline
│   ├── utils/              # Shared utilities (schemas, logging, file ops)
│   ├── discover.ts         # RSS feed discovery
│   ├── download.ts         # Audio download & WAV conversion
│   ├── transcribe.ts       # Whisper transcription
│   ├── extract-facts.ts    # OpenAI Batch API fact extraction
│   └── process-episodes.ts # Main orchestrator
├── lib/
│   └── episodes.ts         # Episode data access for Astro
└── pages/
    ├── index.astro         # Episode list homepage
    └── episodes/[dirName].astro  # Dynamic episode pages
```

## Architecture

### Processing Pipeline

1. **Discovery** (`discover.ts`): Parse RSS feed, compare against `index.json` to find new episodes
2. **Download** (`download.ts`): Fetch audio with retry logic, convert to 16kHz mono WAV using ffmpeg
3. **Transcription** (`transcribe.ts`): Run Whisper to generate `.vtt`, `.srt`, `.txt` files
4. **Fact Extraction** (`extract-facts.ts`):
   - Convert VTT → CSV with timestamps
   - Submit to OpenAI Batch API with structured output schema
   - Validate with Zod schemas (4 facts for standard episodes)
   - Save `facts.json` in episode directory
5. **Index Update**: Mark episode as processed in `index.json`

### Frontend (Astro)

- **Build-time data loading**: `src/lib/episodes.ts` reads episode JSON during build
- **Static generation**: Each episode directory becomes a route via `[dirName].astro`
- **No runtime database**: All data is pre-rendered from JSON files

## Key Files

- **Zod Schemas** (`src/scripts/utils/schemas.ts`): Type-safe validation for episodes and facts
- **Episode Index** (`src/data/episodes/index.json`): Prevents reprocessing via ID tracking
- **Text Utilities** (`src/scripts/utils/text.ts`): Timestamp conversion, filename sanitization, JSON extraction

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
- **Batch API**: Fact extraction uses OpenAI Batch API for cost efficiency (50% discount)
- **Directory naming**: Episodes stored as `YYYY-MM-DD_sanitized-title` for chronological sorting
- **Git tracking**: Episode JSON is committed; audio/transcripts are gitignored