import cv from "@cv";
import { posts } from "@/features/writing";
import { SITE } from "@/shared/site";
import { createStreamMessage } from "./anthropic-stream.ts";
import { createGeminiStream, DEFAULT_GEMINI_MODEL } from "./gemini-stream.ts";
import { createAgentHandler, DEFAULT_MODEL } from "./handler.ts";
import { buildKnowledge } from "./knowledge.ts";
import type { StreamMessage } from "./run-agent.ts";

const handle = createAgentHandler(buildKnowledge(cv, posts, SITE.resumeHref));

export type AgentConfig = {
  clientAddress: string;
  geminiKey: string | undefined;
  anthropicKey: string | undefined;
  model: string | undefined;
};

type ProviderConfig = Omit<AgentConfig, "clientAddress">;

/** Gemini if its key is set, then Claude. With neither, the agent answers from search. */
function chooseProvider(config: ProviderConfig): {
  streamMessage: StreamMessage | null;
  model: string;
} {
  if (config.geminiKey) {
    return {
      streamMessage: createGeminiStream(config.geminiKey),
      model: config.model || DEFAULT_GEMINI_MODEL,
    };
  }
  if (config.anthropicKey) {
    return {
      streamMessage: createStreamMessage(config.anthropicKey),
      model: config.model || DEFAULT_MODEL,
    };
  }
  return { streamMessage: null, model: config.model || DEFAULT_MODEL };
}

export function handleAgentRequest(
  request: Request,
  config: AgentConfig,
): Promise<Response> {
  return handle(request, {
    clientAddress: config.clientAddress,
    ...chooseProvider(config),
  });
}

/** Lets the console show whether the model is connected. */
export function agentStatus(config: ProviderConfig): Response {
  const { streamMessage, model } = chooseProvider(config);
  return new Response(
    JSON.stringify(
      streamMessage
        ? { mode: "agent", model }
        : { mode: "search", model: null },
    ),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
}
