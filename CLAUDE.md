# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Astro-based static site project called "fish-facts-and-data". It uses Astro 5.14.1+ with TypeScript strict mode enabled.

## Development Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start development server at `localhost:4321` |
| `npm run build` | Build production site to `./dist/` |
| `npm run preview` | Preview production build locally |
| `npm run astro ...` | Run Astro CLI commands (e.g., `astro add`, `astro check`) |

## Project Structure

```
src/
├── pages/         # File-based routing (*.astro files become routes)
├── layouts/       # Reusable page layouts
├── components/    # Astro components
└── assets/        # Static assets processed by Astro
```

## Architecture Notes

- **Astro Components**: Files with `.astro` extension contain frontmatter (between `---` delimiters) for component logic and template markup below
- **Layouts**: The `Layout.astro` component provides the HTML document structure with a `<slot />` for page content
- **Pages**: Files in `src/pages/` automatically become routes (e.g., `index.astro` → `/`)
- **TypeScript**: Configured with Astro's strict tsconfig preset