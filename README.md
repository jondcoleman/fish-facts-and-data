# No Such Thing As A Fish - Facts Database

An automated podcast transcript and fact-extraction pipeline for the "No Such Thing As A Fish" podcast, with an Astro-based frontend for browsing episodes and facts.

## Features

- 🎙️ **Automated RSS Feed Discovery** - Automatically detect new episodes from podcast RSS feed
- 📥 **Audio Download & Archiving** - Download and convert audio files to WAV format
- 🎯 **AI-Powered Transcription** - Use Whisper for accurate speech-to-text transcription
- 🤖 **Fact Extraction** - Extract structured facts using OpenAI's Batch API
- 🔍 **Episode Browser** - Browse episodes and facts in a clean Astro frontend
- 📊 **Structured Data** - All data stored as JSON for easy querying and integration

## Setup

### Prerequisites

- Node.js 18+ (for native fetch support)
- FFmpeg (for audio conversion)
- OpenAI API key
- RSS feed URL (with auth token if required)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` with your credentials:
   ```env
   OPENAI_API_KEY=your_openai_api_key
   OPENAI_MODEL=gpt-4o
   PODCAST_RSS_FEED_URL=your_rss_feed_url
   ```

## Usage

### Process New Episodes

Run the complete pipeline to discover, download, transcribe, and extract facts from new episodes:

```bash
npm run process
```

**Options:**
- `--limit N` - Process only the first N new episodes
- `--model NAME` - Specify Whisper model (tiny, base, small, medium, large; default: base)

**Example:**
```bash
npm run process -- --limit 5 --model base
```

### Retry Fact Extraction

Re-extract facts for specific episodes by episode number or ID:

```bash
tsx src/scripts/retry-facts.ts <episode-number-or-id> [...]
```

**Examples:**
```bash
tsx src/scripts/retry-facts.ts 575
tsx src/scripts/retry-facts.ts 575 576 601
tsx src/scripts/retry-facts.ts 124785842
```

This will:
1. Find the episode by number (e.g., "575"), ID (e.g., "124785842"), or title pattern
2. Delete existing facts.json
3. Re-extract facts using OpenAI Batch API
4. Mark episode as processed on success

### Discover Episodes (Preview)

Preview what episodes would be processed without actually processing them:

```bash
npm run discover
```

### Development Server

Start the Astro development server to preview the frontend:

```bash
npm run dev
```

Visit `http://localhost:4321` to browse episodes and facts.

### Build for Production

Build the static site:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Project Structure

```
.
├── audio/                      # Downloaded audio files (gitignored)
├── src/
│   ├── data/
│   │   └── episodes/          # Episode data and facts (committed)
│   │       ├── index.json     # Processed episode tracking
│   │       └── YYYY-MM-DD_episode-title/
│   │           ├── facts.json          # Extracted facts
│   │           ├── metadata.json       # Episode metadata
│   │           ├── transcript.vtt      # VTT transcript
│   │           ├── transcript.srt      # SRT transcript
│   │           ├── transcript.txt      # Plain text transcript
│   │           └── *.mp3/*.wav         # Audio files
│   ├── scripts/
│   │   ├── utils/             # Shared utilities
│   │   ├── discover.ts        # RSS feed discovery
│   │   ├── download.ts        # Audio download & conversion
│   │   ├── transcribe.ts      # Whisper transcription
│   │   ├── extract-facts.ts   # AI fact extraction (batch API)
│   │   ├── process-episodes.ts # Main orchestrator
│   │   ├── retry-facts.ts     # Retry fact extraction for episodes
│   │   └── bootstrap-episodes.ts # Bootstrap from RSS (one-time)
│   ├── lib/
│   │   └── episodes.ts        # Episode data access for Astro
│   └── pages/
│       ├── index.astro        # Homepage with episode list
│       └── episodes/
│           └── [dirName].astro # Individual episode pages
└── package.json
```

## Data Flow

1. **Discovery** - Parse RSS feed and compare against processed episodes index
2. **Download** - Download audio and convert to WAV (16kHz mono)
3. **Transcription** - Generate `.vtt`, `.srt`, `.txt` transcripts using Whisper (local)
4. **Episode Classification** - Check metadata to determine if standard episode:
   - Has `itunes.episode` number AND NOT `episodeType: "bonus"`
   - OR has `episodeType: "full"`
   - OR title starts with a number (e.g., "575. No Such Thing...")
5. **Fact Extraction**:
   - **Standard episodes**: Send transcripts to OpenAI Batch API (gpt-4o) for structured fact extraction
   - **Non-standard episodes**: Create empty facts.json immediately (no API call)
6. **Validation** - Validate extracted data with Zod schemas
7. **Storage** - Save facts and metadata to episode directories
8. **Tracking** - Mark episodes as processed in index.json
9. **Frontend** - Astro reads episode JSON at build time to generate pages

## Episode Directory Naming

Episodes are stored in directories named: `YYYY-MM-DD_episode-title-sanitized`

Example: `2025-01-15_no-such-thing-as-a-fish-episode-500`

## Fact Schema

Each episode's `facts.json` follows this structure:

### Standard Episodes
```typescript
{
  episode_type: "standard";
  episode_summary: string;
  facts: [
    {
      fact_number: 1-4;
      fact: string;
      presenter: string;
      guest: boolean;
      start_time: "HH:MM:SS";
    }
  ]
}
```

### Non-Standard Episodes
```typescript
{
  episode_type: "compilation" | "bonus" | "other";
  episode_summary: "";
  facts: []
}
```

**Episode Type Classification:**
- `standard` - Regular weekly episodes with exactly 4 facts
- `compilation` - Monthly compilation episodes
- `bonus` - Bonus episodes (Drop Us A Line, Meet The Elves, etc.)
- `other` - Special episodes like "Your Facts" audience submissions

## Maintenance

### Weekly Processing

Set up a weekly cron job or GitHub Action to:
1. Run `npm run process`
2. Commit updated JSON files
3. Trigger site rebuild

### Retry Failed Fact Extractions

If fact extraction fails or needs improvement for specific episodes:

```bash
tsx src/scripts/retry-facts.ts <episode-number>
```

### Full Reprocessing

To fully reprocess an episode (download, transcribe, extract):
1. Delete the episode directory from `src/data/episodes/`
2. Remove the episode ID from `src/data/episodes/index.json`
3. Run `npm run process`

## Important Notes

### Episode Type Detection
The pipeline automatically filters episodes by metadata **before** sending to OpenAI:
- Only standard episodes are sent to the LLM for fact extraction
- Non-standard episodes get empty facts.json immediately
- This significantly reduces API costs (~100+ fewer calls)

### Model Selection
- **Transcription**: Whisper base model (default) - runs locally
- **Fact Extraction**: gpt-4o - better accuracy than gpt-4o-mini for classification

### File Locations
- Audio files: Stored in episode directories (not in separate `audio/` folder)
- Transcripts: Stored in episode directories alongside metadata
- All episode data is committed to the repository

## License

ISC