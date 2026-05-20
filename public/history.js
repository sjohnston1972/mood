const METRICS = ["mood", "energy", "anxiety", "sleep"];
const COLORS = {
  mood:    { 1: "#e8a08a", 2: "#f4d29a", 3: "#dfead4", 4: "#a8c98a", 5: "#5b8c3f" },
  energy:  { 1: "#e8a08a", 2: "#f4d29a", 3: "#dfead4", 4: "#a8c98a", 5: "#5b8c3f" },
  anxiety: { 5: "#e8a08a", 4: "#f4d29a", 3: "#dfead4", 2: "#a8c98a", 1: "#5b8c3f" },
  sleep:   { 1: "#e8a08a", 2: "#f4d29a", 3: "#dfead4", 4: "#a8c98a", 5: "#5b8c3f" },
};
const LINE_COLORS = { mood: "#6c8ead", energy: "#ffd166", anxiety: "#e8a08a", sleep: "#5b8c3f" };

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

export async function mountHistory(root) {
  root.innerHTML = "";
  root.append(el("h1", { style: "font-size:20px;margin:8px 0 6px;" }, "History"));

  const tabsRow = el("div", { class: "tabs-row" });
  const tabs = METRICS.map(m => {
    const b = el("button", { class: "history-tab", type: "button" }, m[0].toUpperCase() + m.slice(1));
    b.dataset.metric = m;
    return b;
  });
  tabs[0].classList.add("on");
  tabs.forEach(b => tabsRow.append(b));
  root.append(tabsRow);

  const heatmap = el("div", { class: "heatmap" });
  root.append(heatmap);
  const legend = el("div", { class: "legend" },
    "Less",
    el("span", { class: "sq", style: "background:#e8a08a" }),
    el("span", { class: "sq", style: "background:#f4d29a" }),
    el("span", { class: "sq", style: "background:#dfead4" }),
    el("span", { class: "sq", style: "background:#a8c98a" }),
    el("span", { class: "sq", style: "background:#5b8c3f" }),
    "More",
    el("span", { class: "sq empty", style: "background: repeating-linear-gradient(45deg,#e0ddd2,#e0ddd2 2px,#f0ede2 2px,#f0ede2 4px)" }),
    "No entry",
  );
  root.append(legend);

  const chartWrap = el("div", { class: "chart-wrap" });
  root.append(chartWrap);

  const from = isoDate(daysAgo(55));
  const to = isoDate(new Date());
  const res = await fetch(`/api/entries?from=${from}&to=${to}`);
  const entries = res.ok ? await res.json() : [];
  const byDate = Object.fromEntries(entries.map(e => [e.date, e]));

  let activeMetric = "mood";
  function renderHeatmap() {
    heatmap.innerHTML = "";
    const cells = [];
    for (let i = 55; i >= 0; i--) {
      const d = daysAgo(i);
      const k = isoDate(d);
      const e = byDate[k];
      const c = el("div", { class: "cell", title: k });
      if (e) c.style.background = COLORS[activeMetric][e[activeMetric]];
      else c.classList.add("empty");
      cells.push(c);
    }
    cells.forEach(c => heatmap.append(c));
  }

  tabs.forEach(b => b.addEventListener("click", () => {
    tabs.forEach(t => t.classList.toggle("on", t === b));
    activeMetric = b.dataset.metric;
    renderHeatmap();
  }));
  renderHeatmap();

  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const k = isoDate(daysAgo(i));
    last30.push({ date: k, e: byDate[k] });
  }
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 300 120");
  svg.setAttribute("preserveAspectRatio", "none");
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
    poly.setAttribute("data-metric", m);
    svg.append(poly);
  }
  chartWrap.append(svg);
  const chartLegend = el("div", { class: "chart-legend" });
  for (const m of METRICS) {
    chartLegend.append(el("span", { style: `color:${LINE_COLORS[m]}` }, `━ ${m}`));
  }
  chartWrap.append(chartLegend);
}
