import type { ChatMessage, ChatRequest } from "./types.js";

/** Gemini 3.5 Flash-Lite — GA pricing (USD / 1M tokens). */
const PRICE_INPUT_PER_M = 0.3;
const PRICE_OUTPUT_PER_M = 2.5;

export type UsageInfo = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
};

export function getGeminiModel(): string {
  return process.env.DEFAULT_MODEL?.trim() || "gemini-3.5-flash-lite";
}

function getApiKey(): string {
  return (process.env.GEMINI_API_KEY || "").trim();
}

export function estimateCostUsd(prompt: number, completion: number): number {
  return (
    (prompt / 1_000_000) * PRICE_INPUT_PER_M +
    (completion / 1_000_000) * PRICE_OUTPUT_PER_M
  );
}

export async function checkGeminiHealth(): Promise<{
  ok: boolean;
  models?: string[];
  error?: string;
}> {
  const key = getApiKey();
  if (!key) {
    return { ok: false, error: "GEMINI_API_KEY není nastavený" };
  }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=20`,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Gemini API ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as {
      models?: Array<{ name?: string }>;
    };
    const models = (data.models ?? [])
      .map((m) => (m.name || "").replace(/^models\//, ""))
      .filter(Boolean)
      .slice(0, 30);
    return { ok: true, models };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gemini health failed",
    };
  }
}

type GeminiPart = { text?: string };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

function toGeminiPayload(messages: ChatMessage[]) {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (msg.content.trim()) systemParts.push(msg.content.trim());
      continue;
    }
    const role = msg.role === "assistant" ? "model" : "user";
    const text = msg.content;
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts[0].text = `${last.parts[0].text ?? ""}\n${text}`;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  // Gemini vyžaduje začít user turnem
  if (contents[0]?.role === "model") {
    contents.unshift({ role: "user", parts: [{ text: "(pokračování)" }] });
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: Number(process.env.GEMINI_MAX_TOKENS ?? 1024) || 1024,
    },
  };

  if (systemParts.length) {
    body.systemInstruction = {
      parts: [{ text: systemParts.join("\n\n") }],
    };
  }

  return body;
}

function sseChunk(content: string, model: string): string {
  return (
    `data: ${JSON.stringify({
      id: `chatcmpl-gemini`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    })}\n\n`
  );
}

function sseUsage(usage: UsageInfo, model: string): string {
  return (
    `data: ${JSON.stringify({
      id: `chatcmpl-gemini`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [],
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        cost_usd: usage.cost_usd,
      },
    })}\n\n`
  );
}

/**
 * Stream Gemini → OpenAI-compatible SSE (+ usage chunk na konci).
 */
export async function streamGeminiChat(
  request: ChatRequest,
): Promise<Response> {
  const key = getApiKey();
  if (!key) {
    throw new Error("GEMINI_API_KEY není nastavený");
  }

  const model = request.model?.trim() || getGeminiModel();
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:streamGenerateContent` +
    `?alt=sse&key=${encodeURIComponent(key)}`;

  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toGeminiPayload(request.messages)),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    throw new Error(
      `Gemini chat failed (${upstream.status}): ${text.slice(0, 400) || upstream.statusText}`,
    );
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: UsageInfo | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const event of events) {
            for (const line of event.split("\n")) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const raw = trimmed.slice(5).trim();
              if (!raw || raw === "[DONE]") continue;
              try {
                const json = JSON.parse(raw) as {
                  candidates?: Array<{
                    content?: { parts?: Array<{ text?: string }> };
                  }>;
                  usageMetadata?: {
                    promptTokenCount?: number;
                    candidatesTokenCount?: number;
                    totalTokenCount?: number;
                  };
                };

                const text =
                  json.candidates?.[0]?.content?.parts
                    ?.map((p) => p.text || "")
                    .join("") ?? "";
                if (text) {
                  controller.enqueue(enc.encode(sseChunk(text, model)));
                }

                const meta = json.usageMetadata;
                if (meta) {
                  const prompt = meta.promptTokenCount ?? 0;
                  const completion = meta.candidatesTokenCount ?? 0;
                  const total = meta.totalTokenCount ?? prompt + completion;
                  usage = {
                    prompt_tokens: prompt,
                    completion_tokens: completion,
                    total_tokens: total,
                    cost_usd: estimateCostUsd(prompt, completion),
                  };
                }
              } catch {
                // skip malformed
              }
            }
          }
        }

        if (usage) {
          controller.enqueue(enc.encode(sseUsage(usage, model)));
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      void reader.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
