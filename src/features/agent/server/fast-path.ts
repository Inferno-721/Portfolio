import type { Source } from "./events.ts";
import type { ProfileFacts } from "./knowledge.ts";

export type FastPathAnswer = {
  label: string;
  answer: string;
  sources: Source[];
};

const MAX_FAST_PATH_LENGTH = 80;

/**
 * Questions with one fixed, correct answer skip the model entirely: no latency, no token
 * cost and nothing to hallucinate. Anything longer or less clear-cut goes to the agent.
 */
export function matchFastPath(
  question: string,
  facts: ProfileFacts,
): FastPathAnswer | null {
  const text = question.trim();
  if (text.length > MAX_FAST_PATH_LENGTH) return null;

  if (/^(hi+|hey+|hello+|yo|namaste|hola|sup)\b[\s!.?]*$/i.test(text)) {
    return {
      label: "greeting",
      answer: `Hi! I'm the AI agent on ${facts.name}'s site. Ask me about their agent systems, RAG work, projects or experience.`,
      sources: [],
    };
  }

  if (
    /\b(contact|reach|email|e-mail|in touch|hire|hiring|phone)\b/i.test(text)
  ) {
    return {
      label: "contact",
      answer: `The best way to reach ${facts.name} is email: ${facts.email}. LinkedIn works too.`,
      sources: [
        { title: "Email", url: facts.emailUrl },
        { title: "LinkedIn", url: facts.linkedinUrl },
      ],
    };
  }

  if (/\b(r[eé]sum[eé]|cv)\b/i.test(text)) {
    return {
      label: "résumé",
      answer: `You can open ${facts.name}'s résumé as a PDF here.`,
      sources: [{ title: "Résumé (PDF)", url: facts.resumeUrl }],
    };
  }

  if (/\b(github|repos?|source code)\b/i.test(text)) {
    return {
      label: "GitHub",
      answer: `${facts.name}'s public code is on GitHub.`,
      sources: [{ title: "GitHub", url: facts.githubUrl }],
    };
  }

  return null;
}
