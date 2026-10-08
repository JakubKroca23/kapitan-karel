export type WelcomeAction = {
  label: string;
  /** Odeslat jako uživatelskou zprávu */
  prompt?: string;
  /** Navigace v hostitelské aplikaci (event kk:navigate) nebo location */
  href?: string;
};

export type WidgetConfig = {
  api: string;
  model: string;
  title: string;
  system?: string;
  /** Pevná uvítací zpráva (negeneruje model) */
  welcome?: string;
  actions?: WelcomeAction[];
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type KapitanKarelTheme = {
  /** dark | light — Contsystem Manager */
  mode?: "dark" | "light";
  /** CSS font-family, např. z document.body */
  fontFamily?: string;
};

export type KapitanKarelApi = {
  setPageContext: (text: string) => void;
  setActions: (actions: WelcomeAction[]) => void;
  setWelcome: (text: string) => void;
  setTheme: (theme: KapitanKarelTheme) => void;
};

type StoredMessage = {
  role: "user" | "assistant";
  content: string;
};

const DEFAULT_WELCOME =
  "Ahoj — jsem Kapitán Karel. Pomůžu s tím, co právě vidíte na obrazovce.";

const NEW_CHAT_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;

const CLOSE_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>`;

const MAX_PAGE_CONTEXT = 3500;
/** Max čekání na první token / dokončení streamu (ms) */
const CHAT_TIMEOUT_MS = 90_000;

declare global {
  interface Window {
    KapitanKarel?: KapitanKarelApi;
  }
}

/** Základní scrape viditelného obsahu stránky (bez chatu). */
export function scrapePageContext(maxLen = MAX_PAGE_CONTEXT): string {
  const path = `${window.location.pathname}${window.location.search}`;
  const title = document.title.trim();
  const main =
    document.querySelector("main") ??
    document.querySelector("[role='main']") ??
    document.body;

  const headings = Array.from(
    main.querySelectorAll("h1, h2, h3, [data-kk-label]"),
  )
    .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 40);

  const clone = main.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      "#kk-chat-root, script, style, noscript, svg title, [aria-hidden='true']",
    )
    .forEach((el) => el.remove());

  let bodyText = (clone.innerText || "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  if (bodyText.length > maxLen) {
    bodyText = `${bodyText.slice(0, maxLen)}\n…[zkráceno]`;
  }

  const parts = [
    `URL: ${path}`,
    title ? `Document title: ${title}` : "",
    headings.length ? `Nadpisy:\n- ${headings.join("\n- ")}` : "",
    bodyText ? `Viditelný obsah stránky:\n${bodyText}` : "",
  ].filter(Boolean);

  return parts.join("\n\n");
}

export function createWidget(config: WidgetConfig, styles: string): void {
  if (document.getElementById("kk-chat-root")) return;

  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  const apiBase = config.api.replace(/\/$/, "");
  const avatarUrl = `${apiBase}/karel-avatar.png`;
  const launcherUrl = avatarUrl;
  let welcomeText = config.welcome?.trim() || DEFAULT_WELCOME;
  let welcomeActions: WelcomeAction[] = [...(config.actions ?? [])];
  let externalPageContext = "";
  const storageKey = `kk-chat-v2:${apiBase}:${config.model}`;

  const root = document.createElement("div");
  root.id = "kk-chat-root";
  root.className = "kk-root kk-theme-dark";
  root.innerHTML = `
    <button type="button" class="kk-launcher" aria-label="Otevřít chat Kapitán Karel">
      <img class="kk-launcher-img" alt="Kapitán Karel" />
    </button>
    <div class="kk-panel" aria-hidden="true">
      <div class="kk-header">
        <div class="kk-brand">
          <img class="kk-avatar" alt="" />
          <div class="kk-brand-text">
            <h2 class="kk-title"></h2>
            <p class="kk-model"></p>
            <p class="kk-usage" title="Spotřeba tokenů v této session"></p>
          </div>
        </div>
        <div class="kk-header-actions">
          <button type="button" class="kk-new" aria-label="Nový chat" title="Nový chat">${NEW_CHAT_ICON}</button>
          <button type="button" class="kk-close" aria-label="Zavřít chat" title="Zavřít">${CLOSE_ICON}</button>
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
  const modelEl = root.querySelector<HTMLParagraphElement>(".kk-model")!;
  const usageEl = root.querySelector<HTMLParagraphElement>(".kk-usage")!;
  const launcherImg = root.querySelector<HTMLImageElement>(".kk-launcher-img")!;
  const avatarImg = root.querySelector<HTMLImageElement>(".kk-avatar")!;
  const messagesEl = root.querySelector<HTMLDivElement>(".kk-messages")!;
  const form = root.querySelector<HTMLFormElement>(".kk-form")!;
  const input = root.querySelector<HTMLTextAreaElement>(".kk-input")!;
  const sendBtn = root.querySelector<HTMLButtonElement>(".kk-send")!;

  const isGemini = /gemini/i.test(config.model);
  titleEl.textContent = config.title;
  modelEl.textContent = isGemini
    ? `Gemini: ${config.model}`
    : `lokální model: ${config.model}`;
  launcherImg.src = launcherUrl;
  avatarImg.src = avatarUrl;

  type UsageTotals = {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd: number;
    last_prompt_tokens: number;
    last_completion_tokens: number;
    last_cost_usd: number;
  };

  const usageKey = `kk-usage-v1:${apiBase}:${config.model}`;
  let usageTotals: UsageTotals = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    last_prompt_tokens: 0,
    last_completion_tokens: 0,
    last_cost_usd: 0,
  };

  function formatTokens(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
    return String(n);
  }

  function formatUsd(n: number): string {
    if (n <= 0) return "$0";
    if (n < 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(3)}`;
  }

  function persistUsage(): void {
    try {
      sessionStorage.setItem(usageKey, JSON.stringify(usageTotals));
    } catch {
      // ignore
    }
  }

  function loadUsage(): void {
    try {
      const raw = sessionStorage.getItem(usageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<UsageTotals>;
      usageTotals = {
        prompt_tokens: Number(parsed.prompt_tokens) || 0,
        completion_tokens: Number(parsed.completion_tokens) || 0,
        total_tokens: Number(parsed.total_tokens) || 0,
        cost_usd: Number(parsed.cost_usd) || 0,
        last_prompt_tokens: Number(parsed.last_prompt_tokens) || 0,
        last_completion_tokens: Number(parsed.last_completion_tokens) || 0,
        last_cost_usd: Number(parsed.last_cost_usd) || 0,
      };
    } catch {
      // ignore
    }
  }

  function renderUsage(): void {
    const { last_prompt_tokens, last_completion_tokens, last_cost_usd, cost_usd } =
      usageTotals;
    if (
      !usageTotals.total_tokens &&
      !last_prompt_tokens &&
      !last_completion_tokens
    ) {
      usageEl.textContent = "spotřeba: —";
      return;
    }
    usageEl.textContent =
      `poslední in ${formatTokens(last_prompt_tokens)} · out ${formatTokens(last_completion_tokens)} · ${formatUsd(last_cost_usd)}` +
      `  ·  Σ ${formatUsd(cost_usd)}`;
  }

  function addUsage(u: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost_usd?: number;
  }): void {
    const prompt = Number(u.prompt_tokens) || 0;
    const completion = Number(u.completion_tokens) || 0;
    const total = Number(u.total_tokens) || prompt + completion;
    const cost = Number(u.cost_usd) || 0;
    usageTotals.last_prompt_tokens = prompt;
    usageTotals.last_completion_tokens = completion;
    usageTotals.last_cost_usd = cost;
    usageTotals.prompt_tokens += prompt;
    usageTotals.completion_tokens += completion;
    usageTotals.total_tokens += total;
    usageTotals.cost_usd += cost;
    persistUsage();
    renderUsage();
  }

  loadUsage();
  renderUsage();

  const history: ChatMessage[] = [];
  if (config.system) {
    history.push({ role: "system", content: config.system });
  }

  let open = false;
  let busy = false;
  let closeTimer: number | undefined;
  let abortCtrl: AbortController | undefined;
  let actionsEl: HTMLDivElement | null = null;

  function setBusy(next: boolean): void {
    busy = next;
    sendBtn.disabled = next;
    newBtn.disabled = next;
    actionsEl
      ?.querySelectorAll<HTMLButtonElement>("button")
      .forEach((btn) => {
        btn.disabled = next;
      });
  }

  function resolvePageContext(): string {
    const host = externalPageContext.trim();
    // Když máme datový kontext z Manageru, scrape jen krátce (jinak 32k model hangne)
    const scrapeBudget = host ? Math.min(1800, MAX_PAGE_CONTEXT) : MAX_PAGE_CONTEXT;
    const scraped = scrapePageContext(scrapeBudget);
    if (host) {
      const hostTrim =
        host.length > 9000 ? `${host.slice(0, 9000)}\n…[datový kontext zkrácen]` : host;
      return `${hostTrim}\n\n---\n${scraped}`;
    }
    return scraped;
  }

  function messagesForApi(): ChatMessage[] {
    const ctx = resolvePageContext();
    const pageSystem: ChatMessage = {
      role: "system",
      content:
        "ŽIVÝ KONTEXT AKTUÁLNÍ STRÁNKY (aktualizováno právě teď — ber ho jako pravdu o tom, co uživatel vidí):\n\n" +
        ctx +
        "\n\nPravidla: odpovídej podle tohoto kontextu. Necituj celou stránku. " +
        "Když něco na stránce není, řekni to rovnou. Nevymýšlej data, která v kontextu nejsou.",
    };

    if (history.length === 0) return [pageSystem];
    if (history[0]?.role === "system") {
      return [history[0], pageSystem, ...history.slice(1)];
    }
    return [pageSystem, ...history];
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

  function navigate(href: string): void {
    const ev = new CustomEvent("kk:navigate", {
      detail: { href },
      cancelable: true,
      bubbles: true,
    });
    const allowed = window.dispatchEvent(ev);
    if (!allowed || ev.defaultPrevented) return;
    window.location.assign(href);
  }

  function renderActions(actions: WelcomeAction[]): void {
    welcomeActions = actions;
    actionsEl?.remove();
    actionsEl = null;
    if (!actions.length) return;

    const wrap = document.createElement("div");
    wrap.className = "kk-actions";
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "kk-action";
      btn.textContent = action.label;
      btn.disabled = busy;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (action.href) {
          navigate(action.href);
          return;
        }
        if (action.prompt) {
          void sendMessage(action.prompt);
        }
      });
      wrap.appendChild(btn);
    }
    messagesEl.appendChild(wrap);
    actionsEl = wrap;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showStaticWelcome(): void {
    const bubble = appendBubble("assistant", "");
    const row = bubble.parentElement;
    row?.classList.add("kk-welcome");
    bubble.classList.add("kk-welcome-typing");

    history.push({ role: "assistant", content: welcomeText });
    persist();

    const text = welcomeText;
    let i = 0;
    const stepMs = text.length > 220 ? 10 : 14;

    const tick = () => {
      i = Math.min(text.length, i + 1);
      // Piš po znacích, ale odřádkování automaticky
      bubble.textContent = text.slice(0, i);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      if (i < text.length) {
        window.setTimeout(tick, stepMs);
        return;
      }
      bubble.classList.remove("kk-welcome-typing");
      renderActions(welcomeActions);
    };

    window.setTimeout(tick, 120);
  }

  async function streamCompletion(
    messages: ChatMessage[],
    bubble: HTMLDivElement,
    signal: AbortSignal,
  ): Promise<string> {
    showTyping(bubble);

    const timeout = window.setTimeout(() => {
      if (!signal.aborted) abortCtrl?.abort();
    }, CHAT_TIMEOUT_MS);

    try {
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
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
                cost_usd?: number;
              };
            };
            if (json.usage) {
              addUsage(json.usage);
            }
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

      if (!started) {
        clearTyping(bubble);
        throw new Error(
          "Model nevrátil žádný text (timeout nebo příliš velký kontext). Zkus Nový chat.",
        );
      }
      return full;
    } catch (err) {
      if (signal.aborted) {
        throw new Error(
          "Odpověď trvala moc dlouho. Zkus kratší otázku nebo Nový chat.",
        );
      }
      throw err;
    } finally {
      window.clearTimeout(timeout);
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
    actionsEl = null;
    resetHistoryBase();
    clearStorage();
    usageTotals = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
      last_prompt_tokens: 0,
      last_completion_tokens: 0,
      last_cost_usd: 0,
    };
    persistUsage();
    renderUsage();
    showStaticWelcome();
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
    const hasUser = stored.some((m) => m.role === "user");
    if (!hasUser) renderActions(welcomeActions);
  } else {
    showStaticWelcome();
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

    // Po první uživatelské zprávě schovat quick-akce (zůstávají jen u welcome)
    if (actionsEl) {
      actionsEl.remove();
      actionsEl = null;
    }

    const assistantEl = appendBubble("assistant", "");

    try {
      const full = await streamCompletion(messagesForApi(), assistantEl, signal);
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

  function hasUserMessages(): boolean {
    return history.some((m) => m.role === "user");
  }

  function applyTheme(theme: KapitanKarelTheme): void {
    // Panel bota je vždy tmavý (Contsystem dark)
    root.classList.add("kk-theme-dark");
    root.classList.remove("kk-theme-light");
    if (theme.fontFamily?.trim()) {
      root.style.setProperty("--kk-font", theme.fontFamily.trim());
    }
  }

  // Preferuj font hostitelské stránky hned po mountu
  try {
    const hostFont = getComputedStyle(document.body).fontFamily;
    if (hostFont) root.style.setProperty("--kk-font", hostFont);
    applyTheme({ mode: "dark" });
  } catch {
    // ignore
  }

  window.KapitanKarel = {
    setPageContext(text: string) {
      externalPageContext = text || "";
    },
    setActions(actions: WelcomeAction[]) {
      welcomeActions = actions ?? [];
      // Quick-akce jen u čistého welcome — ne během konverzace.
      if (!hasUserMessages()) {
        renderActions(welcomeActions);
      }
    },
    setWelcome(text: string) {
      welcomeText = text?.trim() || DEFAULT_WELCOME;
      if (hasUserMessages()) return;
      const welcomeRow = messagesEl.querySelector(
        ".kk-welcome .kk-msg-assistant",
      );
      if (welcomeRow) {
        welcomeRow.textContent = welcomeText;
        const idx = history.findIndex((m) => m.role === "assistant");
        if (idx >= 0) {
          history[idx] = { role: "assistant", content: welcomeText };
          persist();
        }
      }
    },
    setTheme(theme: KapitanKarelTheme) {
      applyTheme(theme ?? {});
    },
  };
}
