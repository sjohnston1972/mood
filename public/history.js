import { openChatWithMessage } from "./chat.js";

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

  const insights = el("div", { class: "insights-wrap" });
  await renderMonthInsights(insights, byDate, viewYear, viewMonth, today);
  monthBody.append(insights);
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

async function renderMonthInsights(wrap, byDate, year, month, today) {
  wrap.append(el("h2", {
    style: "font-size:13px;font-weight:600;margin:18px 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;",
  }, "Insights"));

  const stats = computeMonthStats(byDate, year, month, today);

  if (stats.loggedDays === 0) {
    wrap.append(el("div", { class: "insight-card" },
      el("div", { class: "insight-title" }, "No entries this month"),
      el("div", { class: "insight-detail" }, "Log a mood on the Today tab to see insights here."),
    ));
    return;
  }

  let prevStats = null;
  const prev = new Date(year, month - 1, 1);
  const prevByDate = await getMonthData(prev.getFullYear(), prev.getMonth()).catch(() => ({}));
  prevStats = computeMonthStats(prevByDate, prev.getFullYear(), prev.getMonth(), today);

  // Adherence
  const adhPct = Math.round(stats.adherence * 100);
  const adherenceCard = el("div", { class: "insight-card" });
  adherenceCard.append(el("div", { class: "insight-title" }, `Logged ${stats.loggedDays} of ${stats.possibleDays} days · ${adhPct}%`));
  if (stats.maxStreak >= 2) {
    adherenceCard.append(el("div", { class: "insight-detail" }, `Longest streak: ${stats.maxStreak} days`));
  }
  wrap.append(adherenceCard);

  // Averages with month-over-month diff
  const avgCard = el("div", { class: "insight-card" });
  avgCard.append(el("div", { class: "insight-title" }, "Averages"));
  const avgRow = el("div", { class: "avg-row" });
  for (const m of METRICS) {
    if (stats.avg[m] == null) continue;
    const cell = el("div", { class: "avg-cell" });
    cell.append(el("div", { class: "avg-name", style: `color:${LINE_COLORS[m]}` }, METRIC_NAMES[m]));
    cell.append(el("div", { class: "avg-val" }, stats.avg[m].toFixed(1)));
    if (prevStats && prevStats.loggedDays >= 3 && prevStats.avg[m] != null) {
      const diff = stats.avg[m] - prevStats.avg[m];
      const better = m === "anxiety" ? diff < 0 : diff > 0;
      let arrow = "→", cls = "avg-diff";
      if (Math.abs(diff) >= 0.3) {
        arrow = diff > 0 ? "↑" : "↓";
        cls += better ? " good" : " bad";
      }
      cell.append(el("div", { class: cls }, `${arrow} ${diff > 0 ? "+" : ""}${diff.toFixed(1)}`));
    }
    avgRow.append(cell);
  }
  avgCard.append(avgRow);
  if (prevStats && prevStats.loggedDays >= 3) {
    avgCard.append(el("div", { class: "insight-detail", style: "margin-top:6px;" }, `Compared to ${MONTHS[prev.getMonth()]}`));
  }
  wrap.append(avgCard);

  // Best / hardest day
  if (stats.loggedDays >= 3) {
    const card = el("div", { class: "insight-card" });
    card.append(insightRow("Best day", stats.best));
    card.append(insightRow("Hardest day", stats.worst));
    wrap.append(card);
  }

  // Patterns
  const patterns = buildPatterns(stats);
  if (patterns.length > 0) {
    const card = el("div", { class: "insight-card" });
    card.append(el("div", { class: "insight-title" }, "What's going on"));
    const ul = el("ul", { class: "insight-list" });
    for (const p of patterns) ul.append(el("li", {}, p));
    card.append(ul);
    wrap.append(card);
  }

  // Chat about this
  if (stats.loggedDays >= 1) {
    const monthName = `${MONTHS[month]} ${year}`;
    const btn = el("button", { class: "chat-about-btn", type: "button" }, "💬 Want to chat about this?");
    btn.addEventListener("click", () => {
      const opener = buildChatOpener(monthName, stats, patterns);
      openChatWithMessage(opener);
    });
    wrap.append(btn);
  }
}

function insightRow(label, entry) {
  const row = el("div", { class: "insight-row" });
  row.append(el("div", { class: "insight-row-label" }, label));
  const v = el("div", { class: "insight-row-value" });
  v.append(el("div", { class: "insight-row-date" }, formatDateShort(entry._date)));
  const chips = el("div", { class: "score-chips" });
  for (const m of METRICS) {
    const chip = el("span", { class: "score-chip" }, `${METRIC_NAMES[m][0]} ${entry[m]}`);
    const c = metricColor(m, entry[m]);
    if (c) { chip.style.background = c; chip.style.color = chipTextColor(entry[m], m); }
    chips.append(chip);
  }
  v.append(chips);
  row.append(v);
  return row;
}

function chipTextColor(v, m) {
  // Use dark text on light backgrounds (values 2, 3) and light on dark (1, 5)
  const score = m === "anxiety" ? 6 - v : v;
  return score >= 4 ? "#fff" : "rgba(0,0,0,0.7)";
}

function buildPatterns(s) {
  const out = [];
  const avg = (arr, k) => arr.length ? arr.reduce((a, b) => a + b[k], 0) / arr.length : null;

  // Within-month trends
  if (s.firstHalf.length >= 3 && s.secondHalf.length >= 3) {
    const f = avg(s.firstHalf, "mood"), l = avg(s.secondHalf, "mood");
    if (Math.abs(l - f) >= 0.5) {
      out.push(l > f
        ? `Your mood is on the up — was around ${f.toFixed(1)} earlier in the month, now averaging ${l.toFixed(1)}.`
        : `Your mood has dipped recently — was ${f.toFixed(1)} earlier on, now ${l.toFixed(1)}.`);
    }
    const fA = avg(s.firstHalf, "anxiety"), lA = avg(s.secondHalf, "anxiety");
    if (Math.abs(lA - fA) >= 0.5) {
      out.push(lA < fA
        ? `Your anxiety has been easing — from ${fA.toFixed(1)} early in the month to ${lA.toFixed(1)} more recently.`
        : `Your anxiety is getting worse — from ${fA.toFixed(1)} early on to ${lA.toFixed(1)} more recently.`);
    }
    const fS = avg(s.firstHalf, "sleep"), lS = avg(s.secondHalf, "sleep");
    if (Math.abs(lS - fS) >= 0.5) {
      out.push(lS > fS
        ? `You seem to be sleeping better than at the start of the month (${fS.toFixed(1)} → ${lS.toFixed(1)}).`
        : `Your sleep has slipped through the month (${fS.toFixed(1)} → ${lS.toFixed(1)}).`);
    }
    const fE = avg(s.firstHalf, "energy"), lE = avg(s.secondHalf, "energy");
    if (Math.abs(lE - fE) >= 0.5) {
      out.push(lE > fE
        ? `Your energy has been picking up (${fE.toFixed(1)} → ${lE.toFixed(1)}).`
        : `Your energy has been waning (${fE.toFixed(1)} → ${lE.toFixed(1)}).`);
    }
  }

  // Weekend vs weekday
  if (s.weekend.length >= 2 && s.weekday.length >= 3) {
    const we = avg(s.weekend, "mood"), wd = avg(s.weekday, "mood");
    if (Math.abs(we - wd) >= 0.4) {
      out.push(we > wd
        ? `Weekends have been brighter than weekdays for you (mood ${we.toFixed(1)} vs ${wd.toFixed(1)}).`
        : `Weekdays have actually been better than weekends this month (mood ${wd.toFixed(1)} vs ${we.toFixed(1)}).`);
    }
    const weA = avg(s.weekend, "anxiety"), wdA = avg(s.weekday, "anxiety");
    if (Math.abs(weA - wdA) >= 0.5) {
      out.push(weA < wdA
        ? `Your anxiety drops at weekends (${weA.toFixed(1)} vs ${wdA.toFixed(1)} on weekdays).`
        : `Anxiety has been higher at weekends than weekdays (${weA.toFixed(1)} vs ${wdA.toFixed(1)}) — that's unusual, worth a thought.`);
    }
  }

  // Sleep → mood / energy
  if (s.goodSleep.length >= 2 && s.poorSleep.length >= 2) {
    const g = avg(s.goodSleep, "mood"), p = avg(s.poorSleep, "mood");
    if (g - p >= 0.5) {
      out.push(`You feel noticeably better on days you sleep well — mood ${g.toFixed(1)} after good sleep vs ${p.toFixed(1)} after rough nights.`);
    }
    const ge = avg(s.goodSleep, "energy"), pe = avg(s.poorSleep, "energy");
    if (ge - pe >= 0.5) {
      out.push(`Your energy follows your sleep too: ${ge.toFixed(1)} after good sleep vs ${pe.toFixed(1)} after poor.`);
    }
  }

  return out;
}

function buildChatOpener(monthName, stats, patterns) {
  const lines = [`I'd like to talk about how I've been doing in ${monthName}.`];
  if (patterns.length > 0) {
    lines.push("");
    lines.push("Some things I've noticed from my entries:");
    for (const p of patterns) lines.push(`- ${p}`);
  } else {
    const a = stats.avg;
    lines.push("");
    const summary = METRICS
      .filter(m => a[m] != null)
      .map(m => `${m} ${a[m].toFixed(1)}`).join(", ");
    lines.push(`My averages this month: ${summary}.`);
  }
  lines.push("");
  lines.push("What stands out to you?");
  return lines.join("\n");
}

function computeMonthStats(byDate, year, month, today) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const cap = (today.getFullYear() === year && today.getMonth() === month) ? today.getDate() : lastDay;

  const entries = [];
  for (let day = 1; day <= cap; day++) {
    const date = new Date(year, month, day);
    const key = isoDate(date);
    const e = byDate[key];
    if (e) entries.push({ ...e, _date: date });
  }
  const possibleDays = cap;
  const loggedDays = entries.length;

  const avg = {};
  for (const m of METRICS) {
    const vals = entries.map(e => e[m]);
    avg[m] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  let best = null, worst = null;
  for (const e of entries) {
    const score = e.mood + e.energy + e.sleep + (6 - e.anxiety);
    if (best == null || score > best._score) best = { ...e, _score: score };
    if (worst == null || score < worst._score) worst = { ...e, _score: score };
  }

  const weekend = entries.filter(e => { const d = e._date.getDay(); return d === 0 || d === 6; });
  const weekday = entries.filter(e => { const d = e._date.getDay(); return d !== 0 && d !== 6; });
  const goodSleep = entries.filter(e => e.sleep >= 4);
  const poorSleep = entries.filter(e => e.sleep <= 2);

  const mid = Math.ceil(possibleDays / 2);
  const firstHalf = entries.filter(e => e._date.getDate() <= mid);
  const secondHalf = entries.filter(e => e._date.getDate() > mid);

  let maxStreak = 0, curStreak = 0;
  for (let day = 1; day <= cap; day++) {
    const key = isoDate(new Date(year, month, day));
    if (byDate[key]) { curStreak++; if (curStreak > maxStreak) maxStreak = curStreak; }
    else curStreak = 0;
  }

  return { possibleDays, loggedDays, adherence: possibleDays ? loggedDays / possibleDays : 0,
    avg, best, worst, weekend, weekday, goodSleep, poorSleep, firstHalf, secondHalf, maxStreak };
}

function formatDateShort(d) {
  const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return `${dayName} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
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
