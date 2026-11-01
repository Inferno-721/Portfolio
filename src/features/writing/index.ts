import data from "./data/posts.json";
import type { Post } from "./types.ts";

export const posts: Post[] = data as Post[];

export { default as LatestPosts } from "./components/latest-posts.astro";
export { default as PostGrid } from "./components/post-grid.astro";
export type { Post } from "./types.ts";
