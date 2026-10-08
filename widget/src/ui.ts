export type WidgetConfig = {
  api: string;
  model: string;
  title: string;
  system?: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function createWidget(config: WidgetConfig, styles: string): void {
  if (document.getElementById("kk-chat-root")) return;

  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  const apiBase = config.api.replace(/\/$/, "");
  const avatarUrl = `${apiBase}/karel-avatar.png`;
  const launcherUrl = avatarUrl;

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
        <button type="button" class="kk-close" aria-label="Zavřít chat">Zavřít</button>
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

  async function sendMessage(text: string): Promise<void> {
    if (busy || !text.trim()) return;
    busy = true;
    sendBtn.disabled = true;

    const userText = text.trim();
    history.push({ role: "user", content: userText });
    appendBubble("user", userText);
    input.value = "";

    const assistantEl = appendBubble("assistant", "");
    const typing = document.createElement("div");
    typing.className = "kk-typing";
    typing.textContent = "Generuji…";
    messagesEl.appendChild(typing);

    try {
      const res = await fetch(`${config.api.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: history,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(
          (errBody && errBody.error) || `HTTP ${res.status}`,
        );
      }

      if (!res.body) throw new Error("Empty response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";

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
              full += chunk;
              assistantEl.textContent = full;
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
          } catch {
            // skip malformed SSE chunks
          }
        }
      }

      typing.remove();
      if (!full) {
        assistantEl.parentElement?.remove();
        appendBubble("error", "Model nevrátil žádný text.");
      } else {
        history.push({ role: "assistant", content: full });
      }
    } catch (err) {
      typing.remove();
      assistantEl.parentElement?.remove();
      appendBubble(
        "error",
        err instanceof Error ? err.message : "Nepodařilo se odeslat zprávu.",
      );
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
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
