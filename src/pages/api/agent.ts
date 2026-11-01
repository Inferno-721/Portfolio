import type { APIRoute } from "astro";
import { getSecret } from "astro:env/server";
import { agentStatus, handleAgentRequest } from "@/features/agent";

export const prerender = false;

const providerConfig = () => ({
  geminiKey: getSecret("GEMINI_API_KEY"),
  anthropicKey: getSecret("ANTHROPIC_API_KEY"),
  model: getSecret("AGENT_MODEL"),
});

export const POST: APIRoute = ({ request, clientAddress }) =>
  handleAgentRequest(request, { clientAddress, ...providerConfig() });

export const GET: APIRoute = () => agentStatus(providerConfig());
