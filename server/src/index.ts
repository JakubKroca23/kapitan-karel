import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkOllamaHealth,
  getDefaultModel,
  streamChat,
  type ChatMessage,
} from "./ollama.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";

const app = express();

app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN.split(",").map((s) => s.trim()),
  }),
);
app.use(express.json({ limit: "1mb" }));

const widgetDist = path.resolve(__dirname, "../../widget/dist");
const publicDir = path.resolve(__dirname, "../../public");

app.use(express.static(publicDir));
app.use(express.static(widgetDist));

app.get("/api/health", async (_req, res) => {
  const health = await checkOllamaHealth();
  res.status(health.ok ? 200 : 503).json({
    ...health,
    defaultModel: getDefaultModel(),
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  });
});

app.post("/api/chat", async (req, res) => {
  const messages = req.body?.messages as ChatMessage[] | undefined;
  const model = typeof req.body?.model === "string" ? req.body.model : undefined;

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages must be a non-empty array" });
    return;
  }

  for (const msg of messages) {
    if (
      !msg ||
      typeof msg.content !== "string" ||
      !["system", "user", "assistant"].includes(msg.role)
    ) {
      res.status(400).json({ error: "invalid message format" });
      return;
    }
  }

  try {
    const upstream = await streamChat({ messages, model });
    if (!upstream.body) {
      res.status(502).json({ error: "empty response from Ollama" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    } catch (streamErr) {
      if (!res.headersSent) {
        res.status(502).json({
          error:
            streamErr instanceof Error
              ? streamErr.message
              : "stream interrupted",
        });
      } else {
        res.end();
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "chat failed";
    if (!res.headersSent) {
      res.status(502).json({ error: message });
    } else {
      res.end();
    }
  }
});

app.get("/widget.js", (_req, res) => {
  res.sendFile(path.join(widgetDist, "widget.js"), (err) => {
    if (err) {
      res
        .status(404)
        .type("text/plain")
        .send("widget.js not found — run npm run build -w widget first");
    }
  });
});

app.listen(PORT, () => {
  console.log(`Chat proxy listening on http://localhost:${PORT}`);
  console.log(`Demo: http://localhost:${PORT}/demo.html`);
  console.log(`Widget: http://localhost:${PORT}/widget.js`);
});
