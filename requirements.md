### Podcast Fact Extraction System — Plan

This is a concise architecture/plan for a podcast transcript and fact-extraction pipeline optimized for maintainability and simple Astro-based browsing.

## Goals

- Automate weekly ingestion of new "No Such Thing As A Fish" episodes
- Archive original audio and generated artifacts (transcripts, metadata, facts)
- Produce structured JSON suitable for browsing and querying
- Keep code maintainable and storage choices sustainable
- Minimize legal/copyright risk by keeping heavy media private
- Provide a lightweight Astro frontend for exploration

## System Overview

High-level flow from discovery to frontend build artifacts.

## Data Flow

### 1) Episode Discovery

- Read RSS feed from `PODCAST_RSS_FEED_URL` in `.env`
- Compare feed items to `src/data/episodes/index.json` of processed episodes
- Queue only new episodes for processing
- Persist episode metadata JSON under `src/data/episodes/`
- Per-episode directory name format:
  - `YYYY-MM-DD` (publish date)
  - `episode-title-sanitized` (safe for filesystem)

### 2) Download & Archive Audio

- Download audio for each new episode
- Store privately on disk in `audio/` (ignored by git)
- Save the audio path/URL reference in episode metadata JSON

### 3) Transcription

- Transcribe audio (e.g., Whisper)
- Save transcripts within the episode folder in multiple formats:
  - `.vtt`
  - `.txt`
  - `.json`
  - `.csv`
- Use a consistent base filename across formats

### 4) Fact Extraction

- Send transcript `.csv` to OpenAI with a specialized prompt to extract facts and metadata
- Receive structured JSON containing: `episode_number`, `title`, `summary`, `type`, and 4 facts
- Validate with a Zod schema; retry up to 3 times on validation failure
- Save `facts.json` in the episode folder alongside transcript files

### 5) Index Update

- Append processed episode IDs to `src/data/episodes/index.json`
- Prevent reprocessing by checking this index before each run

### 6) Frontend Integration (Astro)

- Astro reads episode JSON files at build time
- Generate per-episode pages and an index page
- No backend database required to render

## Maintenance / Operations

- Run a weekly script to:
  1. Fetch RSS → find new episodes
  2. Download audio → transcribe → extract facts
  3. Save artifacts and update `src/data/episodes/index.json`
- Commit and push updated JSON to the repo
- The Astro site rebuilds from JSON on Vercel
- Failures (e.g., invalid model output) are retried per validation policy
- Write logs for auditing
