export type PostSource = "linkedin" | "blog";

/** One post from any source. Only this shape reaches the site and the agent. */
export type Post = {
  id: string;
  source: PostSource;
  sourceName: string;
  title: string | null;
  excerpt: string;
  url: string;
  publishedAt: string;
  image: string | null;
  reactions: number | null;
  comments: number | null;
};
