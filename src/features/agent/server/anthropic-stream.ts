import Anthropic from "@anthropic-ai/sdk";
import type { StreamMessage } from "./run-agent.ts";

const TIMEOUT_MS = 30_000;

/** Omit the key to use the SDK's own credential lookup, as local eval runs do. */
export function createStreamMessage(apiKey?: string): StreamMessage {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 2 });
  return (params, signal) => client.beta.messages.stream(params, { signal });
}
