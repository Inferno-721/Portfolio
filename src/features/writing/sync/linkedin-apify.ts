import type { Post } from "../types.ts";
import { toLinkedInPost } from "./normalize.ts";

const ACTOR = "harvestapi~linkedin-profile-posts";

type ApifyPostItem = {
  type?: string;
  linkedinUrl?: string;
  content?: string;
  postedAt?: { date?: string };
  engagement?: { likes?: number; comments?: number };
};

/** Maps the actor's output. Items that aren't the author's own text posts are dropped. */
export function parseApifyItems(items: ApifyPostItem[]): Post[] {
  return items.flatMap((item) => {
    if (
      item.type !== "post" ||
      !item.content ||
      !item.linkedinUrl ||
      !item.postedAt?.date
    ) {
      return [];
    }
    const post = toLinkedInPost({
      text: item.content,
      url: item.linkedinUrl,
      publishedAt: item.postedAt.date,
      reactions: item.engagement?.likes ?? null,
      comments: item.engagement?.comments ?? null,
    });
    return post ? [post] : [];
  });
}

/** LinkedIn has no open API for a member's own posts, so this reads public posts via Apify. */
export async function fetchLinkedInPosts(input: {
  profileUrl: string;
  token: string;
  maxPosts: number;
  /** Routine runs only ask for recent posts, because the actor charges per post. */
  postedLimit?: "month";
}): Promise<Post[]> {
  const response = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        targetUrls: [input.profileUrl],
        maxPosts: input.maxPosts,
        ...(input.postedLimit ? { postedLimit: input.postedLimit } : {}),
        includeQuotePosts: true,
        includeReposts: false,
        scrapeReactions: false,
        scrapeComments: false,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Apify returned ${response.status}: ${(await response.text()).slice(0, 200)}`,
    );
  }
  return parseApifyItems((await response.json()) as ApifyPostItem[]);
}
