const fab = document.getElementById("chat-fab");
const panel = document.getElementById("chat-panel");
const closeBtn = document.getElementById("chat-close");
const log = document.getElementById("chat-log");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");

let sessionId = null;

function ensureSession() {
  if (!sessionId) sessionId = crypto.randomUUID();
  return sessionId;
}

function appendMessage(role, text) {
  const li = document.createElement("li");
  li.className = role;
  li.textContent = text;
  log.append(li);
  log.scrollTop = log.scrollHeight;
  return li;
}

async function sendMessage(message) {
  const session_id = ensureSession();
  appendMessage("user", message);
  const li = appendMessage("assistant", "…");

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id, message }),
  });
  if (!res.ok || !res.body) { li.textContent = "Sorry, something went wrong."; return; }

  li.textContent = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const event = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const line = event.split("\n").find(l => l.startsWith("data: "));
      if (!line) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") return;
      try {
        const obj = JSON.parse(payload);
        if (obj.response) {
          li.textContent += obj.response;
          log.scrollTop = log.scrollHeight;
        }
      } catch { /* ignore */ }
    }
  }
}

export function mountChat() {
  fab.addEventListener("click", () => {
    panel.hidden = false;
    fab.classList.add("hidden");
    setTimeout(() => input.focus(), 50);
  });
  closeBtn.addEventListener("click", () => {
    panel.hidden = true;
    fab.classList.remove("hidden");
  });

  // Prevent the send button from stealing focus from the input — keeps the
  // mobile keyboard open across send / streaming response.
  const sendBtn = form.querySelector("button[type=submit]");
  if (sendBtn) {
    const keepFocus = (e) => { e.preventDefault(); };
    sendBtn.addEventListener("mousedown", keepFocus);
    sendBtn.addEventListener("touchstart", keepFocus, { passive: false });
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    input.focus();
    try { await sendMessage(message); }
    catch (e) { console.error(e); appendMessage("assistant", "Sorry, something went wrong."); }
    finally { input.focus(); }
  });

  sessionId = crypto.randomUUID();
}
