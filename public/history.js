const METRICS = ["mood", "energy", "anxiety", "sleep"];
const METRIC_NAMES = { mood: "Mood", energy: "Energy", anxiety: "Anxiety", sleep: "Sleep" };
const SUB_POS = { mood: "tl", energy: "tr", anxiety: "bl", sleep: "br" };
const RAMP = ["#e8a08a", "#f4d29a", "#dfead4", "#a8c98a", "#5b8c3f"]; // worst -> best
const LINE_COLORS = { mood: "#6c8ead", energy: "#d4a017", anxiety: "#e8a08a", sleep: "#5b8c3f" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKS = 8;

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
  for (const c of children) e.append(c);
  return e;
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgo(n) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n);
  return d;
}

function startOfWeekMon(d) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (out.getDay() + 6) % 7; // 0 = Mon
  out.setDate(out.getDate() - dow);
  return out;
}

export async function mountHistory(root) {
  root.innerHTML = "";
  const demo = new URLSearchParams(location.search).get("demo") === "1";

  root.append(el("h1", { style: "font-size:20px;margin:8px 0 12px;" }, "History"));

  if (demo) {
    const banner = el("div", {
      style: "padding:8px 12px;background:#fff8e6;border-left:4px solid var(--accent);border-radius:6px;font-size:12px;margin-bottom:10px;",
    }, "Demo mode — synthetic data, not from your entries. Remove ?demo=1 to see real history.");
    root.append(banner);
  }

  const heatmap = el("div", { class: "heatmap-cal" });
  root.append(heatmap);

  root.append(buildLegend());

  const chartWrap = el("div", { class: "chart-wrap" });
  root.append(chartWrap);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const oldestMon = startOfWeekMon(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (WEEKS - 1) * 7));

  let byDate;
  if (demo) {
    byDate = generateDemoEntries(oldestMon, today);
  } else {
    const from = isoDate(oldestMon);
    const to = isoDate(today);
    const res = await fetch(`/api/entries?from=${from}&to=${to}`);
    const entries = res.ok ? await res.json() : [];
    byDate = Object.fromEntries(entries.map(e => [e.date, e]));
  }

  renderCalendarHeatmap(heatmap, byDate, today, oldestMon);
  renderTrendChart(chartWrap, byDate);
}

function generateDemoEntries(oldestMon, today) {
  const out = {};
  const d = new Date(oldestMon);
  while (d <= today) {
    const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const rng = (n) => (((seed * (n + 7) * 9301 + 49297) % 233280) / 233280);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const wave = Math.sin(seed / 19) * 0.5 + 0.5;
    const clamp = (x) => Math.max(1, Math.min(5, Math.round(x)));
    const mood = clamp(2 + wave * 2.2 + (isWeekend ? 0.6 : 0) + (rng(1) - 0.5));
    const energy = clamp(2.5 + wave * 1.6 + (rng(2) - 0.5) * 1.4);
    const anxiety = clamp(3.8 - wave * 1.8 + (rng(3) - 0.5) * 1.6);
    const sleep = clamp(3 + wave + (rng(4) - 0.5) * 1.5);
    const skip = rng(5) < 0.06; // ~6% gap days to show empty pattern
    if (!skip) {
      out[isoDate(d)] = { date: isoDate(d), mood, energy, anxiety, sleep, note: null, tz: "Europe/London", created_at: 0, updated_at: 0 };
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function renderCalendarHeatmap(heatmap, byDate, today, oldestMon) {
  heatmap.innerHTML = "";
  const todayKey = isoDate(today);

  for (let row = 0; row < 7; row++) {
    heatmap.append(el("div", {
      class: "weekday-label",
      style: `grid-row:${row + 1};grid-column:1;`,
    }, WEEKDAYS[row]));
  }

  for (let col = 0; col < WEEKS; col++) {
    for (let row = 0; row < 7; row++) {
      const cellDate = new Date(oldestMon);
      cellDate.setDate(oldestMon.getDate() + col * 7 + row);
      const key = isoDate(cellDate);
      const entry = byDate[key];
      const isFuture = cellDate > today;
      const isToday = key === todayKey;

      const classes = ["day"];
      if (!entry) classes.push("empty");
      if (isFuture) classes.push("future");
      if (isToday) classes.push("today");

      const titleParts = [key];
      if (entry) {
        titleParts.push(`Mood ${entry.mood} · Energy ${entry.energy} · Anxiety ${entry.anxiety} · Sleep ${entry.sleep}`);
        if (entry.note) titleParts.push(entry.note);
      } else if (!isFuture) {
        titleParts.push("(no entry)");
      }

      const day = el("div", {
        class: classes.join(" "),
        style: `grid-row:${row + 1};grid-column:${col + 2};`,
        title: titleParts.join("\n"),
      });

      for (const m of METRICS) {
        const sub = el("div", { class: `sub ${SUB_POS[m]}` });
        if (entry) sub.style.background = metricColor(m, entry[m]);
        day.append(sub);
      }
      heatmap.append(day);
    }
  }
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

function renderTrendChart(chartWrap, byDate) {
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const k = isoDate(daysAgo(i));
    days.push({ date: k, value: byDate[k] || null });
  }
  chartWrap.append(el("h2", { style: "font-size:13px;font-weight:600;margin:18px 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;" }, "Last 30 days"));

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

  // Reference lines at 1, 3, 5
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

  const pts = values.map((v, i) => {
    if (v == null) return null;
    const x = PAD + (i / (values.length - 1)) * (W - 2 * PAD);
    const y = H - PAD - ((v - 1) / 4) * (H - 2 * PAD);
    return { x, y, i };
  });

  // Split into contiguous segments separated by null values
  const segments = [];
  let cur = [];
  for (const p of pts) {
    if (p) cur.push(p);
    else if (cur.length) { segments.push(cur); cur = []; }
  }
  if (cur.length) segments.push(cur);

  // Filled area under each segment
  for (const seg of segments) {
    if (seg.length < 2) continue;
    const d = smoothPath(seg) + ` L ${seg[seg.length - 1].x} ${H - PAD} L ${seg[0].x} ${H - PAD} Z`;
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", color);
    path.setAttribute("fill-opacity", "0.12");
    svg.append(path);
  }

  // Smoothed line on top
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

  // Small dots on each data point
  for (const p of pts) {
    if (!p) continue;
    const c = document.createElementNS(svgNS, "circle");
    c.setAttribute("cx", String(p.x)); c.setAttribute("cy", String(p.y));
    c.setAttribute("r", "1.6"); c.setAttribute("fill", color);
    svg.append(c);
  }

  // Highlight latest non-null point
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
