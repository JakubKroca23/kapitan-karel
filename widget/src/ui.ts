export type WidgetConfig = {
  api: string;
  model: string;
  title: string;
  system?: string;
  /** Fallback if model welcome fails */
  welcome?: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type StoredMessage = {
  role: "user" | "assistant";
  content: string;
};

const DEFAULT_WELCOME =
  "Ahoj! Jsem Kapitán Karel. Čím ti můžu pomoct?";

const NEW_CHAT_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;

function dayContext(now = new Date()): string {
  const weekday = new Intl.DateTimeFormat("cs-CZ", { weekday: "long" }).format(
    now,
  );
  const date = new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const time = new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const hour = now.getHours();
  const partOfDay =
    hour < 5
      ? "noc"
      : hour < 11
        ? "ráno"
        : hour < 17
          ? "odpoledne"
          : hour < 21
            ? "večer"
            : "noc";

  return `Dnes je ${weekday} ${date}, kolem ${time} (${partOfDay}).`;
}

export function createWidget(config: WidgetConfig, styles: string): void {
  if (document.getElementById("kk-chat-root")) return;

  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  const apiBase = config.api.replace(/\/$/, "");
  const avatarUrl = `${apiBase}/karel-avatar.png`;
  const launcherUrl = avatarUrl;
  const fallbackWelcome = config.welcome?.trim() || DEFAULT_WELCOME;
  const storageKey = `kk-chat-v1:${apiBase}:${config.model}`;

  const root = document.createElement("div");
  root.id = "kk-chat-root";
  root.className = "kk-root";
  root.innerHTML = `
    <button type="button" class="kk-launcher" aria-label="Otevřít chat Kapitán Karel">
      <img class="kk-launcher-img" alt="Kapitán Karel" />
    </button>
    <div class="kk-panel" aria-hidden="true">
      <div class="kk-header">
        <div class="kk-brand">
          <img class="kk-avatar" alt="" />
          <h2 class="kk-title"></h2>
        </div>
        <div class="kk-header-actions">
          <button type="button" class="kk-new" aria-label="Nový chat" title="Nový chat">${NEW_CHAT_ICON}</button>
          <button type="button" class="kk-close" aria-label="Zavřít chat">Zavřít</button>
        </div>
      </div>
      <div class="kk-messages" role="log" aria-live="polite"></div>
      <form class="kk-form">
        <textarea class="kk-input" rows="1" placeholder="Napište zprávu…"></textarea>
        <button type="submit" class="kk-send">Odeslat</button>
      </form>
    </div>
  `;
  document.body.appendChild(root);

  const launcher = root.querySelector<HTMLButtonElement>(".kk-launcher")!;
  const panel = root.querySelector<HTMLDivElement>(".kk-panel")!;
  const newBtn = root.querySelector<HTMLButtonElement>(".kk-new")!;
  const closeBtn = root.querySelector<HTMLButtonElement>(".kk-close")!;
  const titleEl = root.querySelector<HTMLHeadingElement>(".kk-title")!;
  const launcherImg = root.querySelector<HTMLImageElement>(".kk-launcher-img")!;
  const avatarImg = root.querySelector<HTMLImageElement>(".kk-avatar")!;
  const messagesEl = root.querySelector<HTMLDivElement>(".kk-messages")!;
  const form = root.querySelector<HTMLFormElement>(".kk-form")!;
  const input = root.querySelector<HTMLTextAreaElement>(".kk-input")!;
  const sendBtn = root.querySelector<HTMLButtonElement>(".kk-send")!;

  titleEl.textContent = config.title;
  launcherImg.src = launcherUrl;
  avatarImg.src = avatarUrl;

  const history: ChatMessage[] = [];
  if (config.system) {
    history.push({ role: "system", content: config.system });
  }

  let open = false;
  let busy = false;
  let closeTimer: number | undefined;
  let abortCtrl: AbortController | undefined;

  function setBusy(next: boolean): void {
    busy = next;
    sendBtn.disabled = next;
    newBtn.disabled = next;
  }

  function loadStored(): StoredMessage[] {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (m): m is StoredMessage =>
          !!m &&
          typeof m === "object" &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.length > 0,
      );
    } catch {
      return [];
    }
  }

  function persist(): void {
    const toStore: StoredMessage[] = history
      .filter(
        (m): m is StoredMessage =>
          (m.role === "user" || m.role === "assistant") && !!m.content,
      )
      .map((m) => ({ role: m.role, content: m.content }));
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(toStore));
    } catch {
      // ignore quota / private mode
    }
  }

  function clearStorage(): void {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }

  function setOpen(next: boolean): void {
    if (next === open) return;
    open = next;
    window.clearTimeout(closeTimer);

    if (open) {
      panel.classList.remove("kk-panel-closing");
      panel.classList.add("kk-panel-open");
      panel.setAttribute("aria-hidden", "false");
      launcher.classList.remove("kk-launcher-rise");
      launcher.classList.add("kk-launcher-behind");
      window.setTimeout(() => input.focus(), 320);
    } else {
      panel.classList.remove("kk-panel-open");
      panel.classList.add("kk-panel-closing");
      panel.setAttribute("aria-hidden", "true");
      launcher.classList.remove("kk-launcher-behind");
      launcher.classList.add("kk-launcher-rise");
      closeTimer = window.setTimeout(() => {
        panel.classList.remove("kk-panel-closing");
      }, 340);
    }
  }

  launcher.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!open);
  });
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(false);
  });
  panel.addEventListener("click", (e) => e.stopPropagation());

  document.addEventListener("click", () => {
    if (open) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (open && e.key === "Escape") setOpen(false);
  });

  function appendBubble(
    role: "user" | "assistant" | "error",
    content: string,
  ): HTMLDivElement {
    if (role === "assistant") {
      const row = document.createElement("div");
      row.className = "kk-msg-row kk-msg-row-assistant";

      const icon = document.createElement("img");
      icon.className = "kk-msg-icon";
      icon.src = avatarUrl;
      icon.alt = "";

      const bubble = document.createElement("div");
      bubble.className = "kk-msg kk-msg-assistant";
      bubble.textContent = content;

      row.append(icon, bubble);
      messagesEl.appendChild(row);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return bubble;
    }

    const el = document.createElement("div");
    el.className =
      role === "error" ? "kk-msg kk-msg-error" : "kk-msg kk-msg-user";
    el.textContent = content;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function showTyping(bubble: HTMLDivElement): void {
    bubble.textContent = "";
    bubble.classList.add("kk-msg-typing");
    const dots = document.createElement("span");
    dots.className = "kk-typing-dots";
    dots.setAttribute("aria-label", "Karel píše");
    dots.innerHTML = "<i></i><i></i><i></i>";
    bubble.appendChild(dots);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function clearTyping(bubble: HTMLDivElement): void {
    bubble.classList.remove("kk-msg-typing");
    bubble.replaceChildren();
  }

  async function streamCompletion(
    messages: ChatMessage[],
    bubble: HTMLDivElement,
    signal: AbortSignal,
  ): Promise<string> {
    showTyping(bubble);

    const res = await fetch(`${apiBase}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages,
      }),
      signal,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new Error((errBody && errBody.error) || `HTTP ${res.status}`);
    }

    if (!res.body) throw new Error("Empty response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let started = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const chunk = json.choices?.[0]?.delta?.content ?? "";
          if (chunk) {
            if (!started) {
              clearTyping(bubble);
              started = true;
            }
            full += chunk;
            bubble.textContent = full;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        } catch {
          // skip malformed SSE chunks
        }
      }
    }

    if (!started) clearTyping(bubble);
    return full;
  }

  async function generateWelcome(): Promise<void> {
    abortCtrl?.abort();
    abortCtrl = new AbortController();
    const { signal } = abortCtrl;

    setBusy(true);
    const bubble = appendBubble("assistant", "");
    bubble.parentElement?.classList.add("kk-welcome");

    const prompt =
      `Napiš krátký přátelský uvítací pozdrav jako Kapitán Karel (1–2 věty, česky). ` +
      `Zohledni den v týdnu a denní dobu. Nezmiňuj, že jsi AI, model ani prompt. ` +
      `Na konci jemně nabídni pomoc.\n\nKontext: ${dayContext()}`;

    const messages: ChatMessage[] = [
      ...history.filter((m) => m.role === "system"),
      { role: "user", content: prompt },
    ];

    try {
      const full = await streamCompletion(messages, bubble, signal);
      if (!full.trim()) {
        bubble.textContent = fallbackWelcome;
      }
      history.push({
        role: "assistant",
        content: bubble.textContent || fallbackWelcome,
      });
      persist();
    } catch (err) {
      if (signal.aborted) {
        bubble.parentElement?.remove();
        return;
      }
      clearTyping(bubble);
      bubble.textContent = fallbackWelcome;
      history.push({ role: "assistant", content: fallbackWelcome });
      persist();
      console.warn("Welcome generation failed:", err);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  function resetHistoryBase(): void {
    history.length = 0;
    if (config.system) {
      history.push({ role: "system", content: config.system });
    }
  }

  function startNewChat(): void {
    if (busy) {
      abortCtrl?.abort();
      abortCtrl = undefined;
      setBusy(false);
    }
    messagesEl.replaceChildren();
    resetHistoryBase();
    clearStorage();
    void generateWelcome();
    input.focus();
  }

  newBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    startNewChat();
  });

  const stored = loadStored();
  if (stored.length > 0) {
    for (const msg of stored) {
      history.push(msg);
      appendBubble(msg.role, msg.content);
    }
  } else {
    void generateWelcome();
  }

  async function sendMessage(text: string): Promise<void> {
    if (busy || !text.trim()) return;

    abortCtrl = new AbortController();
    const { signal } = abortCtrl;
    setBusy(true);

    const userText = text.trim();
    history.push({ role: "user", content: userText });
    persist();
    appendBubble("user", userText);
    input.value = "";

    const assistantEl = appendBubble("assistant", "");

    try {
      const full = await streamCompletion(history, assistantEl, signal);
      if (!full) {
        assistantEl.parentElement?.remove();
        appendBubble("error", "Model nevrátil žádný text.");
      } else {
        history.push({ role: "assistant", content: full });
        persist();
      }
    } catch (err) {
      if (signal.aborted) {
        assistantEl.parentElement?.remove();
        return;
      }
      clearTyping(assistantEl);
      assistantEl.parentElement?.remove();
      appendBubble(
        "error",
        err instanceof Error ? err.message : "Nepodařilo se odeslat zprávu.",
      );
    } finally {
      if (!signal.aborted) {
        setBusy(false);
        input.focus();
      }
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void sendMessage(input.value);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input.value);
    }
  });
}
