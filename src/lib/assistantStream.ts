// Client for POST /api/agent/chat/stream (server-sent events over fetch, so the auth header can be sent).
import type { ChatMessage, ChatStep, PendingAction } from "@shared/types";
import type { Page } from "./nav";
import { token } from "./api";

export interface AssistantReply {
  id: string;
  reply: string;
  suggestions: string[];
  cards: NonNullable<ChatMessage["cards"]>;
  steps: ChatStep[];
  changes: NonNullable<ChatMessage["changes"]>;
  pendingAction?: PendingAction;
  openUrl?: string;
  navigate?: Page;
  mode: "ai" | "basic";
  basicReason?: "no_ai" | "busy" | "quota";
}

export interface StreamHandlers {
  onStep(step: ChatStep): void;
  onDelta(text: string): void;
  onReset(): void;
}

export async function streamChat(
  body: { message: string; context?: { page?: string; jobId?: string }; regenerate?: boolean },
  h: StreamHandlers,
  signal: AbortSignal,
): Promise<AssistantReply> {
  const t = await token();
  const res = await fetch("/api/agent/chat/stream", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || (res.status === 429 ? "You're sending messages quickly — wait a moment and try again." : "The assistant couldn't answer. Please try again."));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done: AssistantReply | null = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const raw = /^data: (.*)$/m.exec(block)?.[1];
      if (!event || raw === undefined) continue;
      const data = JSON.parse(raw);
      if (event === "step") h.onStep(data.step);
      else if (event === "delta") h.onDelta(data.text);
      else if (event === "reset") h.onReset();
      else if (event === "done") done = data;
      else if (event === "error") throw new Error(data.error || "Something went wrong.");
    }
  }
  if (!done) throw new Error("The connection dropped before the answer finished. Please try again.");
  return done;
}
