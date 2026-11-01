import type { AgentEvent, ChatTurn, TraceStatus } from "../server/events.ts";

const ENDPOINT = "/api/agent";
const MAX_HISTORY_TURNS = 6;
const STORAGE_KEY = "agent-conversation";

const STATE_BY_STATUS: Record<TraceStatus, string> = {
  start: "running",
  done: "done",
  skip: "skip",
  error: "error",
};

type SavedConversation = { history: ChatTurn[]; answer: string };

/** Markdown symbols are dropped because answers render as plain text. */
function cleanAnswer(text: string): string {
  return text.replace(/\*\*/g, "");
}

/** Keeps the chat going across pages for this tab only. Nothing leaves the browser. */
function loadConversation(): SavedConversation | null {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as SavedConversation) : null;
  } catch (error) {
    console.debug("Conversation not restored:", error);
    return null;
  }
}

function saveConversation(conversation: SavedConversation): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(conversation));
  } catch (error) {
    console.debug("Conversation not saved:", error);
  }
}

function startConsole(root: HTMLElement): void {
  function part<T extends HTMLElement>(name: string): T {
    const element = root.querySelector<T>(`[data-agent-${name}]`);
    if (!element) throw new Error(`Agent console is missing ${name}`);
    return element;
  }

  const form = part<HTMLFormElement>("form");
  const input = part<HTMLInputElement>("input");
  const answer = part("answer");
  const rail = part("rail");
  const log = part("log");
  const sources = part("sources");
  const meta = part("meta");
  const suggestions = part("suggestions");

  const saved = loadConversation();
  const history: ChatTurn[] = saved?.history ?? [];
  let answerText = saved?.answer ?? "";
  let active: AbortController | null = null;

  function renderAnswer(): void {
    answer.textContent = cleanAnswer(answerText);
    answer.scrollTop = answer.scrollHeight;
  }

  if (saved?.answer) {
    renderAnswer();
    suggestions.hidden = true;
  }

  function reset(): void {
    answerText = "";
    renderAnswer();
    sources.replaceChildren();
    sources.hidden = true;
    log.replaceChildren();
    log.hidden = true;
    meta.textContent = "";
    for (const stage of rail.querySelectorAll("li")) {
      stage.removeAttribute("data-state");
    }
  }

  function addLogLine(
    label: string,
    ms: number | undefined,
    failed: boolean,
  ): void {
    const line = document.createElement("li");
    line.textContent = ms === undefined ? label : `${label} · ${ms}ms`;
    if (failed) line.classList.add("text-danger");
    log.append(line);
    log.hidden = false;
  }

  function handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case "trace": {
        const stage = rail.querySelector(`[data-stage="${event.stage}"]`);
        const current = stage?.getAttribute("data-state");
        // A skip can't overwrite real work already shown on that stage.
        if (stage && !(event.status === "skip" && current === "done")) {
          stage.setAttribute("data-state", STATE_BY_STATUS[event.status]);
        }
        if (event.status !== "start" && event.stage !== "answer") {
          addLogLine(event.label, event.ms, event.status === "error");
        }
        break;
      }
      case "delta":
        answerText += event.text;
        answer.dataset.streaming = "true";
        renderAnswer();
        break;
      case "reset":
        answerText = "";
        renderAnswer();
        break;
      case "sources":
        sources.replaceChildren(
          ...event.items.map(({ title, url }) => {
            const item = document.createElement("li");
            const link = document.createElement("a");
            link.className = "chip press";
            link.href = url;
            link.textContent = title;
            if (url.startsWith("http")) {
              link.target = "_blank";
              link.rel = "noopener noreferrer";
            }
            item.append(link);
            return item;
          }),
        );
        sources.hidden = false;
        break;
      case "done": {
        const parts = [
          event.mode === "fast-path"
            ? "fast path"
            : event.mode === "search"
              ? "search mode"
              : event.model,
          `${(event.ms / 1000).toFixed(1)}s`,
          event.tokens > 0 ? `${event.tokens} tokens` : "0 tokens",
          `${event.tools} ${event.tools === 1 ? "tool" : "tools"}`,
        ];
        meta.textContent = parts.join(" · ");
        break;
      }
    }
  }

  async function ask(question: string): Promise<void> {
    active?.abort();
    const controller = new AbortController();
    active = controller;
    reset();
    suggestions.hidden = true;
    answer.setAttribute("aria-busy", "true");

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, history }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        answerText = body?.error ?? "Something went wrong. Please try again.";
        renderAnswer();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (frame.startsWith("data: ")) {
            handleEvent(JSON.parse(frame.slice(6)) as AgentEvent);
          }
          boundary = buffer.indexOf("\n\n");
        }
      }

      history.push(
        { role: "user", text: question },
        { role: "assistant", text: answerText },
      );
      history.splice(0, Math.max(0, history.length - MAX_HISTORY_TURNS));
      saveConversation({ history, answer: answerText });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Agent request failed:", error);
      answerText =
        "I couldn't reach the agent. Please check your connection and try again.";
      renderAnswer();
    } finally {
      if (active === controller) {
        answer.removeAttribute("aria-busy");
        delete answer.dataset.streaming;
      }
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    input.value = "";
    void ask(question);
  });

  suggestions.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLElement>(
      "[data-suggestion]",
    );
    if (button?.dataset.suggestion) void ask(button.dataset.suggestion);
  });
}

export function startAgentConsoles(): void {
  for (const root of document.querySelectorAll<HTMLElement>(
    "[data-agent-console]",
  )) {
    startConsole(root);
  }

  void fetch(ENDPOINT)
    .then((response) => response.json())
    .then((config: { mode: string; model: string | null }) => {
      const label =
        config.mode === "agent" ? `Live on ${config.model}` : "Search mode";
      for (const status of document.querySelectorAll("[data-agent-status]")) {
        status.textContent = label;
      }
    })
    .catch((error: unknown) => {
      console.warn("Could not read agent status:", error);
    });
}
