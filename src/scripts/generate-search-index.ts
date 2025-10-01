import * as fs from "fs/promises";
import * as path from "path";
import MiniSearch from "minisearch";
import { stringify } from "csv-stringify/sync";

interface SearchDocument {
  id: string;
  episode_title: string;
  episode_number: string;
  episode_slug: string;
  fact_number: number;
  fact_text: string;
  presenter: string;
  start_time: string;
  publish_date: string;
}

const EPISODES_DIR = path.join(process.cwd(), "src/data/episodes");
const PUBLIC_DIR = path.join(process.cwd(), "public");

/**
 * Generate search index and CSV export for all facts
 */
async function generateSearchIndex() {
  console.log("🔍 Generating search index...");

  const documents: SearchDocument[] = [];

  try {
    // Read all episode directories
    const entries = await fs.readdir(EPISODES_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const episodeDir = path.join(EPISODES_DIR, entry.name);
      const factsPath = path.join(episodeDir, "facts.json");
      const metadataPath = path.join(episodeDir, "metadata.json");

      // Only process episodes with facts
      try {
        await fs.access(factsPath);
      } catch {
        continue;
      }

      const factsData = await fs.readFile(factsPath, "utf-8");
      const facts = JSON.parse(factsData);

      let metadata;
      try {
        const metadataData = await fs.readFile(metadataPath, "utf-8");
        metadata = JSON.parse(metadataData);
      } catch {
        metadata = {
          title: entry.name,
          publishDate: "",
          itunes: {},
        };
      }

      // Generate slug from title
      const slug = metadata.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      const episodeNumber = metadata.itunes?.episode || "";

      // Add each fact as a searchable document
      if (facts.facts && Array.isArray(facts.facts)) {
        for (const fact of facts.facts) {
          documents.push({
            id: `${entry.name}_${fact.fact_number}`,
            episode_title: metadata.title,
            episode_number: episodeNumber,
            episode_slug: slug,
            fact_number: fact.fact_number,
            fact_text: fact.fact,
            presenter: fact.presenter,
            start_time: fact.start_time || "unknown",
            publish_date: metadata.publishDate || "",
          });
        }
      }
    }

    console.log(`📊 Found ${documents.length} facts from ${entries.length} episodes`);

    // Create MiniSearch index
    const miniSearch = new MiniSearch({
      fields: ["episode_title", "fact_text", "presenter"], // Fields to index
      storeFields: [
        "episode_title",
        "episode_number",
        "episode_slug",
        "fact_number",
        "fact_text",
        "presenter",
        "start_time",
        "publish_date",
      ], // Fields to return with results
      searchOptions: {
        boost: { episode_title: 2, presenter: 1.5, fact_text: 1 },
        fuzzy: 0.2,
        prefix: true,
      },
    });

    // Add all documents to the index
    miniSearch.addAll(documents);

    // Ensure public directory exists
    await fs.mkdir(PUBLIC_DIR, { recursive: true });

    // Export MiniSearch index as JSON
    const indexPath = path.join(PUBLIC_DIR, "no-such-thing-facts-index.json");
    await fs.writeFile(indexPath, JSON.stringify(miniSearch), "utf-8");
    console.log(`✅ MiniSearch index written to ${indexPath}`);

    // Export CSV for download/ChatGPT
    const csvPath = path.join(PUBLIC_DIR, "facts-index.csv");
    const csvData = stringify(documents, {
      header: true,
      columns: [
        { key: "episode_number", header: "Episode Number" },
        { key: "episode_title", header: "Episode Title" },
        { key: "fact_number", header: "Fact Number" },
        { key: "presenter", header: "Presenter" },
        { key: "fact_text", header: "Fact" },
        { key: "start_time", header: "Start Time" },
        { key: "publish_date", header: "Publish Date" },
        { key: "episode_slug", header: "Episode Slug" },
      ],
    });
    await fs.writeFile(csvPath, csvData, "utf-8");
    console.log(`✅ CSV export written to ${csvPath}`);

    console.log("🎉 Search index generation complete!");
  } catch (error) {
    console.error("❌ Error generating search index:", error);
    process.exit(1);
  }
}

// Run the script
generateSearchIndex();
