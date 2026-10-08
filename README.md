# Kapitan Karel — embeddable Ollama chat widget

TypeScript chat widget + Node proxy for a local Ollama instance (e.g. Docker). Embed into any site with one `<script>` tag.

## Architecture

```
Host page  →  widget.js  →  Node proxy (:3000)  →  Ollama (:11434)
```

The browser never talks to Ollama directly (CORS / safety). The proxy streams OpenAI-compatible chat completions.

## Prerequisites

- Node.js 20+
- Ollama running (Docker or native) with at least one model pulled

Example Docker:

```bash
docker run -d -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama
docker exec -it ollama ollama pull qwen2.5:3b
```

## Setup

```bash
npm install
npm run build -w widget   # first build so /widget.js exists
npm run dev               # proxy + widget watch
```

Open [http://localhost:3000/demo.html](http://localhost:3000/demo.html).

Production:

```bash
npm run build
npm start
```

## Environment

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Proxy listen port |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama base URL |
| `DEFAULT_MODEL` | `qwen2.5:3b` | Fallback model name |
| `CORS_ORIGIN` | `*` | Comma-separated origins, or `*` |

If the proxy runs in Docker on the same network as Ollama, set e.g. `OLLAMA_BASE_URL=http://ollama:11434`.

## Embed

```html
<script
  src="http://localhost:3000/widget.js"
  data-api="http://localhost:3000"
  data-model="qwen2.5:3b"
  data-title="Kapitán Karel"
  data-system="Jsi Kapitán Karel, přátelský pirátský asistent."
  async
></script>
```

| Attribute | Description |
|---|---|
| `data-api` | Proxy base URL (defaults to script origin) |
| `data-model` | Ollama model name |
| `data-title` | Panel title (default: Kapitán Karel) |
| `data-system` | Optional system prompt |

## API

- `GET /api/health` — Ollama connectivity + model list
- `POST /api/chat` — body `{ messages, model? }`, SSE stream (OpenAI chunk format)
- `GET /widget.js` — built embed bundle
- `GET /demo.html` — sample host page
