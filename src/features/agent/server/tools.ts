import type Anthropic from "@anthropic-ai/sdk";
import type { Source } from "./events.ts";
import type { Knowledge } from "./knowledge.ts";
import { search } from "./retrieve.ts";

const MAX_QUERY_LENGTH = 200;

const queryInput = (description: string) => ({
  type: "object" as const,
  properties: { query: { type: "string", description } },
  required: ["query"],
  additionalProperties: false,
});

const noInput = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

export const TOOL_DEFINITIONS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: "search_profile",
    description:
      "Search Shubham's work history, projects, skills, achievements and education by keyword. Use for any specific factual question, such as a technology, company, metric or award.",
    eager_input_streaming: true,
    input_schema: queryInput(
      "Keywords to look for, e.g. 'Qdrant RAG' or 'eval harness'",
    ),
  },
  {
    name: "list_projects",
    description:
      "List every project Shubham has built, with descriptions, stacks and links. Use for broad questions about what Shubham has built.",
    eager_input_streaming: true,
    input_schema: noInput,
  },
  {
    name: "get_experience",
    description:
      "Get Shubham's full work history in order: companies, roles, dates and what was done at each. Use for career questions.",
    eager_input_streaming: true,
    input_schema: noInput,
  },
  {
    name: "search_posts",
    description:
      "Search Shubham's LinkedIn posts and blog articles by keyword. Pass an empty query to get the most recent ones. Use when asked what Shubham has written or thinks about a topic.",
    eager_input_streaming: true,
    input_schema: queryInput(
      "Keywords to look for, or an empty string for the latest posts",
    ),
  },
];

export type ToolResult = {
  label: string;
  content: string;
  isError: boolean;
  sources: Source[];
};

function readQuery(input: unknown): string | null {
  if (typeof input !== "object" || input === null || !("query" in input))
    return null;
  const { query } = input;
  return typeof query === "string" && query.length <= MAX_QUERY_LENGTH
    ? query
    : null;
}

function toSources(items: { title: string; url: string | null }[]): Source[] {
  return items.flatMap(({ title, url }) => (url ? [{ title, url }] : []));
}

function invalid(name: string): ToolResult {
  return {
    label: `${name}(invalid input)`,
    content:
      "Invalid input: 'query' must be a string of at most 200 characters.",
    isError: true,
    sources: [],
  };
}

/** Tools are read-only lookups over static data, so a bad call can't change anything. */
export function executeTool(
  name: string,
  input: unknown,
  knowledge: Knowledge,
): ToolResult {
  switch (name) {
    case "search_profile": {
      const query = readQuery(input);
      if (query === null) return invalid(name);
      const hits = search(
        query,
        knowledge.chunks.filter((chunk) => chunk.kind !== "post"),
      );
      return {
        label: `search_profile("${query}")`,
        content: JSON.stringify(
          hits.length > 0
            ? hits.map(({ kind, title, text, url }) => ({
                kind,
                title,
                text,
                url,
              }))
            : {
                results: [],
                note: "Nothing in the profile matches this query.",
              },
        ),
        isError: false,
        sources: toSources(hits),
      };
    }
    case "list_projects": {
      const projects = knowledge.projects.map(
        ({ name: title, url, note, description, stack }) => ({
          title,
          url,
          note,
          description,
          stack,
        }),
      );
      return {
        label: "list_projects()",
        content: JSON.stringify(projects),
        isError: false,
        sources: toSources(projects),
      };
    }
    case "get_experience": {
      const roles = knowledge.work.map(
        ({
          company,
          position,
          location,
          startDate,
          endDate,
          highlights,
          stack,
          url,
        }) => ({
          company,
          position,
          location,
          startDate,
          endDate: endDate ?? "present",
          highlights,
          stack,
          url,
        }),
      );
      return {
        label: "get_experience()",
        content: JSON.stringify(roles),
        isError: false,
        sources: toSources(
          roles.map(({ company, url }) => ({ title: company, url })),
        ),
      };
    }
    case "search_posts": {
      const query = readQuery(input);
      if (query === null) return invalid(name);
      if (knowledge.posts.length === 0) {
        return {
          label: `search_posts("${query}")`,
          content: JSON.stringify({
            posts: [],
            note: "No posts have been synced to this site yet.",
          }),
          isError: false,
          sources: [{ title: "LinkedIn", url: knowledge.facts.linkedinUrl }],
        };
      }
      const hits = query.trim()
        ? search(
            query,
            knowledge.chunks.filter((chunk) => chunk.kind === "post"),
          )
        : knowledge.chunks.filter((chunk) => chunk.kind === "post").slice(0, 5);
      return {
        label: `search_posts("${query}")`,
        content: JSON.stringify(
          hits.map(({ title, text, url, date }) => ({
            title,
            text,
            url,
            date,
          })),
        ),
        isError: false,
        sources: toSources(hits),
      };
    }
    default:
      return {
        label: `${name}(unknown tool)`,
        content: `Unknown tool: ${name}`,
        isError: true,
        sources: [],
      };
  }
}
