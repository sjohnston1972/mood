const METRICS = ["mood", "energy", "anxiety", "sleep"];
const METRIC_NAMES = { mood: "Mood", energy: "Energy", anxiety: "Anxiety", sleep: "Sleep" };
const SUB_POS = { mood: "tl", energy: "tr", anxiety: "bl", sleep: "br" };
const RAMP = ["#e8a08a", "#f4d29a", "#dfead4", "#a8c98a", "#5b8c3f"]; // worst -> best
const LINE_COLORS = { mood: "#6c8ead", energy: "#d4a017", anxiety: "#e8a08a", sleep: "#5b8c3f" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function metricColor(metric, value) {
  if (value == null) return null;
  return metric === "anxiety" ? RAMP[5 - value] : RAMP[value - 1];
}

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    e.append(c);
  }
  return e;
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const monthCache = new Map();
let demo = false;
let viewYear, viewMonth;
let monthBody, monthTitle, prevBtn, nextBtn;

async function getMonthData(year, month) {
  const cacheKey = `${year}-${month}-${demo ? "d" : "r"}`;
  if (monthCache.has(cacheKey)) return monthCache.get(cacheKey);
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  let byDate;
  if (demo) {
    byDate = generateDemoEntries(first, last);
  } else {
    const res = await fetch(`/api/entries?from=${isoDate(first)}&to=${isoDate(last)}`);
    const entries = res.ok ? await res.json() : [];
    byDate = Object.fromEntries(entries.map(e => [e.date, e]));
  }
  monthCache.set(cacheKey, byDate);
  return byDate;
}

export async function mountHistory(root) {
  root.innerHTML = "";
  demo = new URLSearchParams(location.search).get("demo") === "1";

  const today = new Date(); today.setHours(0, 0, 0, 0);
  viewYear = today.getFullYear();
  viewMonth = today.getMonth();

  if (demo) {
    root.append(el("div", {
      style: "padding:8px 12px;background:#fff8e6;border-left:4px solid var(--accent);border-radius:6px;font-size:12px;margin-bottom:10px;",
    }, "Demo mode — synthetic data, not from your entries. Remove ?demo=1 to see real history."));
  }

  const header = el("div", { class: "month-header" });
  prevBtn = el("button", { class: "month-nav", type: "button", "aria-label": "Previous month" }, "‹");
  nextBtn = el("button", { class: "month-nav", type: "button", "aria-label": "Next month" }, "›");
  monthTitle = el("div", { class: "month-title" }, "");
  prevBtn.addEventListener("click", () => navigate(-1));
  nextBtn.addEventListener("click", () => navigate(1));
  header.append(prevBtn, monthTitle, nextBtn);
  root.append(header);

  monthBody = el("div", { class: "month-body" });
  root.append(monthBody);

  root.append(buildLegend());

  attachSwipe(root);

  await renderMonth(today);
}

function attachSwipe(root) {
  let sx = null, sy = null, t0 = 0;
  root.addEventListener("touchstart", (ev) => {
    if (ev.touches.length !== 1) return;
    sx = ev.touches[0].clientX; sy = ev.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  root.addEventListener("touchend", (ev) => {
    if (sx == null) return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy, dt = Date.now() - t0;
    sx = sy = null;
    if (dt > 600) return;                          // too slow
    if (Math.abs(dx) < 60) return;                 // too short
    if (Math.abs(dx) < Math.abs(dy) * 1.4) return; // too vertical
    navigate(dx < 0 ? 1 : -1);
  }, { passive: true });
}

async function navigate(delta) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const targetY = today.getFullYear(), targetM = today.getMonth();
  let y = viewYear, m = viewMonth + delta;
  while (m < 0) { m += 12; y -= 1; }
  while (m > 11) { m -= 12; y += 1; }
  if (y > targetY || (y === targetY && m > targetM)) return; // cap at current month
  viewYear = y; viewMonth = m;
  await renderMonth(today);
}

async function renderMonth(today) {
  monthTitle.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
  const atCurrent = (viewYear === today.getFullYear() && viewMonth === today.getMonth());
  nextBtn.disabled = atCurrent;
  nextBtn.style.opacity = atCurrent ? "0.3" : "1";

  monthBody.innerHTML = "";
  const byDate = await getMonthData(viewYear, viewMonth);

  const cal = el("div", { class: "month-cal" });
  renderCalendarMonth(cal, byDate, viewYear, viewMonth, today);
  monthBody.append(cal);

  const trends = el("div", { class: "chart-wrap" });
  renderMonthTrends(trends, byDate, viewYear, viewMonth);
  monthBody.append(trends);
}

function renderCalendarMonth(cal, byDate, year, month, today) {
  for (const w of WEEKDAYS) {
    cal.append(el("div", { class: "weekday-header" }, w));
  }

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const numDays = lastDay.getDate();
  const firstDow = (firstDay.getDay() + 6) % 7; // Mon=0

  for (let i = 0; i < firstDow; i++) cal.append(el("div", { class: "day-blank" }));

  const todayKey = isoDate(today);
  for (let day = 1; day <= numDays; day++) {
    const date = new Date(year, month, day);
    const key = isoDate(date);
    const entry = byDate[key];
    const isFuture = date > today;
    const isToday = key === todayKey;

    const classes = ["day-cell"];
    if (!entry) classes.push("empty");
    if (isFuture) classes.push("future");
    if (isToday) classes.push("today");

    const titleLines = [key];
    if (entry) {
      titleLines.push(`Mood ${entry.mood} · Energy ${entry.energy} · Anxiety ${entry.anxiety} · Sleep ${entry.sleep}`);
      if (entry.note) titleLines.push(entry.note);
    } else if (!isFuture) titleLines.push("(no entry)");

    const cell = el("div", { class: classes.join(" "), title: titleLines.join("\n") });
    cell.append(el("div", { class: "day-num" }, String(day)));
    const blocks = el("div", { class: "day-blocks" });
    for (const m of METRICS) {
      const sub = el("div", { class: `sub ${SUB_POS[m]}` });
      if (entry) sub.style.background = metricColor(m, entry[m]);
      blocks.append(sub);
    }
    cell.append(blocks);
    cal.append(cell);
  }

  const trailing = (7 - ((firstDow + numDays) % 7)) % 7;
  for (let i = 0; i < trailing; i++) cal.append(el("div", { class: "day-blank" }));
}

function buildLegend() {
  const wrap = el("div", { class: "history-legend" });
  const sample = el("div", { class: "legend-day" },
    el("div", { class: "sub tl" }, "M"),
    el("div", { class: "sub tr" }, "E"),
    el("div", { class: "sub bl" }, "A"),
    el("div", { class: "sub br" }, "S"),
  );
  wrap.append(sample);

  const text = el("div", { class: "legend-text" });
  text.append(el("div", {}, "Each day shows four blocks: Mood, Energy, Anxiety, Sleep."));
  const rampRow = el("div", { class: "ramp-row" });
  rampRow.append(el("span", { class: "ramp-label" }, "Worse"));
  for (const c of RAMP) rampRow.append(el("span", { class: "ramp-sq", style: `background:${c}` }));
  rampRow.append(el("span", { class: "ramp-label" }, "Better"));
  text.append(rampRow);
  text.append(el("div", { class: "legend-note" }, "Higher mood / energy / sleep = greener. Anxiety is inverted: greener = calmer."));
  wrap.append(text);
  return wrap;
}

function renderMonthTrends(chartWrap, byDate, year, month) {
  const numDays = new Date(year, month + 1, 0).getDate();
  const days = [];
  for (let day = 1; day <= numDays; day++) {
    const k = isoDate(new Date(year, month, day));
    days.push({ date: k, value: byDate[k] || null });
  }
  chartWrap.append(el("h2", {
    style: "font-size:13px;font-weight:600;margin:18px 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;",
  }, `${MONTHS[month]} ${year}`));

  const grid = el("div", { class: "trends-grid" });
  for (const m of METRICS) {
    const values = days.map(d => d.value ? d.value[m] : null);
    const valid = values.filter(v => v != null);
    const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    let latest = null;
    for (let i = values.length - 1; i >= 0; i--) { if (values[i] != null) { latest = values[i]; break; } }
    const hint = m === "anxiety" ? "lower is better" : "higher is better";

    const row = el("div", { class: "trend-row" });
    const head = el("div", { class: "trend-head" });
    head.append(el("div", { class: "trend-label", style: `color:${LINE_COLORS[m]}` }, METRIC_NAMES[m]));
    head.append(el("div", { class: "trend-hint" }, hint));
    row.append(head);

    row.append(buildSparkline(values, LINE_COLORS[m]));

    const stats = el("div", { class: "trend-stats" });
    stats.append(el("div", { class: "trend-current" }, latest != null ? String(latest) : "—"));
    stats.append(el("div", { class: "trend-avg" }, avg != null ? `avg ${avg.toFixed(1)}` : "no data"));
    row.append(stats);

    grid.append(row);
  }
  chartWrap.append(grid);
}

function buildSparkline(values, color) {
  const svgNS = "http://www.w3.org/2000/svg";
  const W = 240, H = 44, PAD = 4;
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "trend-spark");
  svg.setAttribute("preserveAspectRatio", "none");

  for (const v of [1, 3, 5]) {
    const y = H - PAD - ((v - 1) / 4) * (H - 2 * PAD);
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", "0"); line.setAttribute("x2", String(W));
    line.setAttribute("y1", String(y)); line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "#e0ddd2");
    line.setAttribute("stroke-width", "0.5");
    if (v === 3) line.setAttribute("stroke-dasharray", "2,2");
    svg.append(line);
  }

  const denom = Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => {
    if (v == null) return null;
    const x = PAD + (i / denom) * (W - 2 * PAD);
    const y = H - PAD - ((v - 1) / 4) * (H - 2 * PAD);
    return { x, y, i };
  });

  const segments = [];
  let cur = [];
  for (const p of pts) {
    if (p) cur.push(p);
    else if (cur.length) { segments.push(cur); cur = []; }
  }
  if (cur.length) segments.push(cur);

  for (const seg of segments) {
    if (seg.length < 2) continue;
    const d = smoothPath(seg) + ` L ${seg[seg.length - 1].x} ${H - PAD} L ${seg[0].x} ${H - PAD} Z`;
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", color);
    path.setAttribute("fill-opacity", "0.12");
    svg.append(path);
  }

  for (const seg of segments) {
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", smoothPath(seg));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }

  for (const p of pts) {
    if (!p) continue;
    const c = document.createElementNS(svgNS, "circle");
    c.setAttribute("cx", String(p.x)); c.setAttribute("cy", String(p.y));
    c.setAttribute("r", "1.6"); c.setAttribute("fill", color);
    svg.append(c);
  }

  const last = pts.slice().reverse().find(p => p != null);
  if (last) {
    const c = document.createElementNS(svgNS, "circle");
    c.setAttribute("cx", String(last.x)); c.setAttribute("cy", String(last.y));
    c.setAttribute("r", "3.5"); c.setAttribute("fill", color);
    c.setAttribute("stroke", "#fff"); c.setAttribute("stroke-width", "1.5");
    svg.append(c);
  }
  return svg;
}

function smoothPath(points) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || points[i + 1];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function generateDemoEntries(first, last) {
  const out = {};
  const d = new Date(first);
  while (d <= last) {
    const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const rng = (n) => (((seed * (n + 7) * 9301 + 49297) % 233280) / 233280);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const wave = Math.sin(seed / 19) * 0.5 + 0.5;
    const clamp = (x) => Math.max(1, Math.min(5, Math.round(x)));
    const mood = clamp(2 + wave * 2.2 + (isWeekend ? 0.6 : 0) + (rng(1) - 0.5));
    const energy = clamp(2.5 + wave * 1.6 + (rng(2) - 0.5) * 1.4);
    const anxiety = clamp(3.8 - wave * 1.8 + (rng(3) - 0.5) * 1.6);
    const sleep = clamp(3 + wave + (rng(4) - 0.5) * 1.5);
    const skip = rng(5) < 0.06;
    if (!skip) {
      const k = isoDate(d);
      out[k] = { date: k, mood, energy, anxiety, sleep, note: null, tz: "Europe/London", created_at: 0, updated_at: 0 };
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}
