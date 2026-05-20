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
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const k = isoDate(daysAgo(i));
    last30.push({ date: k, e: byDate[k] });
  }
  chartWrap.append(el("h2", { style: "font-size:13px;font-weight:600;margin:18px 0 6px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;" }, "Last 30 days"));
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 300 120");
  svg.setAttribute("preserveAspectRatio", "none");

  for (let v = 1; v <= 5; v++) {
    const y = 120 - ((v - 1) / 4) * 100 - 10;
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", "0"); line.setAttribute("x2", "300");
    line.setAttribute("y1", y); line.setAttribute("y2", y);
    line.setAttribute("stroke", "#e0ddd2"); line.setAttribute("stroke-width", "0.5");
    svg.append(line);
  }

  function points(metric) {
    return last30.map((d, i) => {
      if (!d.e) return null;
      const x = (i / 29) * 300;
      const v = d.e[metric];
      const y = 120 - ((v - 1) / 4) * 100 - 10;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).filter(Boolean).join(" ");
  }
  for (const m of METRICS) {
    const poly = document.createElementNS(svgNS, "polyline");
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", LINE_COLORS[m]);
    poly.setAttribute("stroke-width", "2");
    poly.setAttribute("points", points(m));
    svg.append(poly);
  }
  chartWrap.append(svg);
  const chartLegend = el("div", { class: "chart-legend" });
  for (const m of METRICS) {
    chartLegend.append(el("span", { style: `color:${LINE_COLORS[m]};font-weight:600` }, `● ${METRIC_NAMES[m]}`));
  }
  chartWrap.append(chartLegend);
}
