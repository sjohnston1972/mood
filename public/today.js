const METRICS = [
  { key: "mood",    label: "Mood",    emojis: ["\u{1F622}","\u{1F615}","\u{1F610}","\u{1F642}","\u{1F60A}"] },
  { key: "energy",  label: "Energy",  emojis: ["\u{1F971}","\u{1F634}","\u{1F642}","\u{1F4AA}","\u{26A1}"] },
  { key: "anxiety", label: "Anxiety", emojis: ["\u{1F60C}","\u{1F642}","\u{1F610}","\u{1F61F}","\u{1F630}"] },
  { key: "sleep",   label: "Sleep",   emojis: ["\u{1F635}","\u{1F62A}","\u{1F610}","\u{1F642}","\u{1F634}"] },
];

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function mountToday(root) {
  root.innerHTML = "";
  const state = { mood: null, energy: null, anxiety: null, sleep: null, note: "" };

  const heading = el("h1", { style: "font-size:20px;margin:8px 0 12px;" }, "How are you today?");
  root.append(heading);

  const insightSlot = el("div", { id: "insight-slot" });
  root.append(insightSlot);

  for (const m of METRICS) {
    root.append(el("div", { class: "metric-label" }, m.label));
    const row = el("div", { class: "emoji-row", role: "radiogroup", "aria-label": m.label });
    m.emojis.forEach((emoji, i) => {
      const val = i + 1;
      const b = el("button", {
        type: "button",
        class: "emoji-btn",
        role: "radio",
        "aria-checked": "false",
        "aria-label": `${m.label}: ${val} of 5`,
        "aria-pressed": "false",
      }, emoji);
      b.addEventListener("click", () => {
        state[m.key] = val;
        for (const sib of row.querySelectorAll(".emoji-btn")) {
          sib.setAttribute("aria-pressed", "false");
          sib.setAttribute("aria-checked", "false");
        }
        b.setAttribute("aria-pressed", "true");
        b.setAttribute("aria-checked", "true");
        updateSaveEnabled();
      });
      row.append(b);
    });
    root.append(row);
  }

  const note = el("textarea", { id: "note", placeholder: "Note (optional)", maxlength: "2000" });
  note.addEventListener("input", () => { state.note = note.value; });
  root.append(note);

  const save = el("button", { id: "save-btn", type: "button", disabled: true }, "Save entry");
  root.append(save);

  function updateSaveEnabled() {
    save.disabled = !(state.mood && state.energy && state.anxiety && state.sleep);
    save.textContent = save.dataset.update === "1" ? "Update entry" : "Save entry";
  }

  save.addEventListener("click", async () => {
    save.disabled = true; save.textContent = "Saving…";
    try {
      const date = todayLocalISO();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`/api/entries/${date}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mood: state.mood, energy: state.energy, anxiety: state.anxiety, sleep: state.sleep,
          note: state.note || undefined, tz,
        }),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      save.dataset.update = "1";
      save.textContent = "Saved ✓";
      await loadInsight(insightSlot);
      setTimeout(updateSaveEnabled, 1500);
    } catch (err) {
      console.error(err);
      save.textContent = "Try again";
      save.disabled = false;
    }
  });

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await fetch(`/api/entries/today?tz=${encodeURIComponent(tz)}`);
    if (res.ok) {
      const entry = await res.json();
      if (entry) {
        state.mood = entry.mood; state.energy = entry.energy;
        state.anxiety = entry.anxiety; state.sleep = entry.sleep;
        state.note = entry.note || "";
        note.value = state.note;
        for (const m of METRICS) {
          const row = root.querySelectorAll(".emoji-row")[METRICS.indexOf(m)];
          const buttons = row.querySelectorAll(".emoji-btn");
          buttons.forEach((b, i) => {
            const on = i + 1 === entry[m.key];
            b.setAttribute("aria-pressed", on ? "true" : "false");
            b.setAttribute("aria-checked", on ? "true" : "false");
          });
        }
        save.dataset.update = "1";
        updateSaveEnabled();
      }
    }
  } catch (e) { /* ignore */ }

  await loadInsight(insightSlot);
}

async function loadInsight(slot) {
  slot.innerHTML = "";
  try {
    const res = await fetch("/api/insight");
    if (!res.ok) return;
    const body = await res.json();
    if (!body) return;
    const dismissedFor = localStorage.getItem("insight-dismissed-for");
    if (dismissedFor === body.date) return;
    const banner = document.createElement("div");
    banner.className = "insight-banner";
    banner.innerHTML = `<span>✨</span><span><strong>AI noticed:</strong> ${escapeHtml(body.text)}</span>`;
    const dismiss = document.createElement("button");
    dismiss.textContent = "×"; dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.addEventListener("click", () => {
      localStorage.setItem("insight-dismissed-for", body.date);
      banner.remove();
    });
    banner.append(dismiss);
    slot.append(banner);
  } catch { /* ignore */ }
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" })[c]);
}
