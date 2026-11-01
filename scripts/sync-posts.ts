/**
 * Refreshes src/features/writing/data/posts.json.
 *
 *   pnpm posts:sync                  fetch the latest from every configured source
 *   pnpm posts:sync --all            first run: fetch the whole LinkedIn history
 *   pnpm posts:import <Shares.csv>   load LinkedIn's own data export, no account needed
 *
 * A failing source is reported and skipped. Saved posts are never removed, so an outage
 * or an expired token can't empty the page.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fetchLinkedInPosts } from "../src/features/writing/sync/linkedin-apify.ts";
import { parseSharesCsv } from "../src/features/writing/sync/linkedin-export.ts";
import { mergePosts } from "../src/features/writing/sync/normalize.ts";
import { fetchFeed } from "../src/features/writing/sync/rss.ts";
import type { Post } from "../src/features/writing/types.ts";

type FeedConfig = {
  linkedinProfile: string;
  rssFeeds: { name: string; url: string }[];
  latestPostsPerRun: number;
  maxStoredPosts: number;
};

const POSTS_PATH = new URL(
  "../src/features/writing/data/posts.json",
  import.meta.url,
);
const CONFIG_PATH = new URL("../feed.config.json", import.meta.url);

const args = process.argv.slice(2);
const config: FeedConfig = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
const existing: Post[] = JSON.parse(await readFile(POSTS_PATH, "utf8"));
const incoming: Post[] = [];
let failures = 0;

const importIndex = args.indexOf("--import");
if (importIndex >= 0) {
  const path = args[importIndex + 1];
  if (!path) throw new Error("Usage: pnpm posts:import <path to Shares.csv>");
  const posts = parseSharesCsv(await readFile(path, "utf8"));
  console.log(`LinkedIn export: ${posts.length} posts`);
  incoming.push(...posts);
} else {
  const token = process.env.APIFY_TOKEN;
  if (token) {
    try {
      const all = args.includes("--all");
      const posts = await fetchLinkedInPosts({
        profileUrl: config.linkedinProfile,
        token,
        maxPosts: all ? 0 : config.latestPostsPerRun,
        postedLimit: all ? undefined : "month",
      });
      console.log(`LinkedIn: ${posts.length} posts`);
      incoming.push(...posts);
    } catch (error) {
      failures++;
      console.error("LinkedIn sync failed:", error);
    }
  } else {
    console.log("LinkedIn: skipped, APIFY_TOKEN is not set");
  }

  for (const feed of config.rssFeeds) {
    try {
      const posts = await fetchFeed(feed.url, feed.name);
      console.log(`${feed.name}: ${posts.length} posts`);
      incoming.push(...posts);
    } catch (error) {
      failures++;
      console.error(`${feed.name} sync failed:`, error);
    }
  }
}

const merged = mergePosts(existing, incoming, config.maxStoredPosts);
await writeFile(POSTS_PATH, `${JSON.stringify(merged, null, 2)}\n`);
console.log(
  `Saved ${merged.length} posts (${merged.length - existing.length} new).`,
);

// Flags the scheduled run as failed so a dead token gets noticed, while keeping the data.
if (failures > 0) process.exitCode = 1;
