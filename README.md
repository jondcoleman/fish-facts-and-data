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
   OPENAI_MODEL=gpt-4o-mini
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

**Example:**
```bash
npm run process -- --limit 5
```

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
├── transcripts/                # Generated transcripts (gitignored)
├── src/
│   ├── data/
│   │   └── episodes/          # Episode data and facts (committed)
│   │       ├── index.json     # Processed episode tracking
│   │       └── YYYY-MM-DD_episode-title/
│   │           ├── facts.json          # Extracted facts
│   │           ├── metadata.json       # Episode metadata
│   │           └── *.transcript.*      # Transcript files
│   ├── scripts/
│   │   ├── utils/             # Shared utilities
│   │   ├── discover.ts        # RSS feed discovery
│   │   ├── download.ts        # Audio download & conversion
│   │   ├── transcribe.ts      # Whisper transcription
│   │   ├── extract-facts.ts   # AI fact extraction
│   │   └── process-episodes.ts # Main orchestrator
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
3. **Transcription** - Generate `.vtt`, `.srt`, `.txt` transcripts using Whisper
4. **Fact Extraction** - Send transcripts to OpenAI Batch API for structured fact extraction
5. **Validation** - Validate extracted data with Zod schemas
6. **Storage** - Save facts and metadata to episode directories
7. **Frontend** - Astro reads episode JSON at build time to generate pages

## Episode Directory Naming

Episodes are stored in directories named: `YYYY-MM-DD_episode-title-sanitized`

Example: `2025-01-15_no-such-thing-as-a-fish-episode-500`

## Fact Schema

Each episode's `facts.json` follows this structure:

```typescript
{
  episode_number: string;
  episode_title: string;
  episode_type: "standard" | "compilation" | "bonus" | "other";
  episode_summary: string;
  facts: [
    {
      fact_number: 1-4;
      fact: string;
      presenter: string;
      guest: boolean;
      start_time: "HH:MM:SS" | "unknown";
    }
  ]
}
```

## Maintenance

### Weekly Processing

Set up a weekly cron job or GitHub Action to:
1. Run `npm run process`
2. Commit updated JSON files
3. Trigger site rebuild

### Manual Reprocessing

To reprocess an episode, delete its directory from `src/data/episodes/` and remove its ID from `index.json`, then run `npm run process`.

## License

ISC