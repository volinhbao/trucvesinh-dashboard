// Đọc Google Sheet "Trực nhật nsv" -> site/data.json cho dashboard.
// Biến môi trường: SHEET_ID (bắt buộc), LICH_GID, TICK_GID.
// Chạy thử với file có sẵn: LICH_CSV=... TICK_CSV=... node build.mjs
import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { parseGrid, weekFor, tasksForDay, weeklyTasks, weeklyNeed, weeklyCount, weeklyDone, thuName } from "./src/lich.js";
import { fetchCsvText, normDate } from "./src/sheet.js";

const env = process.env;
const LICH_GID = env.LICH_GID || "1007624391";
const TICK_GID = env.TICK_GID || "1051999456";
const PENALTY_FROM = env.PENALTY_FROM || "14/11/2026";
const PENALTY_EVERY = 3;

const lichCsv = env.LICH_CSV ? fs.readFileSync(env.LICH_CSV, "utf8") : await fetchCsvText(env.SHEET_ID, LICH_GID);
let tickCsv = "";
try { tickCsv = env.TICK_CSV ? fs.readFileSync(env.TICK_CSV, "utf8") : await fetchCsvText(env.SHEET_ID, TICK_GID); }
catch (e) { console.warn("⚠️ Không đọc được tab Tick vệ sinh:", e.message); }

// Tab "Phạt trà sữa" (số lần đã bao) — đọc theo tên tab, chưa có tab thì coi như chưa ai bao
let paidCsv = "";
try {
  if (env.PAID_CSV) paidCsv = fs.readFileSync(env.PAID_CSV, "utf8");
  else {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${env.SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent("Phạt trà sữa")}`);
    const t = await r.text();
    if (r.ok && !t.trimStart().startsWith("<")) paidCsv = t;
  }
} catch (e) { console.warn("⚠️ Không đọc được tab Phạt trà sữa:", e.message); }

// "Hôm nay" theo giờ VN (cho phép giả lập bằng NOW=2026-11-13)
const nowMs = env.NOW ? Date.parse(env.NOW + "T12:00:00+07:00") : Date.now();
const vn = new Date(nowMs + 7 * 3600_000);
const today = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
const p2 = (n) => String(n).padStart(2, "0");
const key = (d) => `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
const DAY = 864e5;

const grid = parseGrid(lichCsv);
const week = weekFor(grid, today);
const people = (who) => String(who || "").split(/\s*[–+,&]\s*|\s+-\s+/).map((s) => s.trim()).filter(Boolean);

// Thứ Hai của tuần hiện tại
const dowToday = today.getUTCDay();
const monday = new Date(today.getTime() - ((dowToday + 6) % 7) * DAY);
const days = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(monday.getTime() + i * DAY);
  return { key: key(d), dow: d.getUTCDay(), label: thuName(d.getUTCDay()), short: ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][d.getUTCDay()], isToday: d.getTime() === today.getTime(), isPast: d < today };
});

// Bảng tuần: mỗi ca (vd "Trực bếp · T2-4-6") là 1 dòng; tủ lạnh/đổ rác (mỗi ngày 1 cặp) gộp 1 dòng
const order = [];
const groups = new Map();
for (const x of week.tasks) {
  if (x.freq.type === "week") continue;
  const k = x.freq.type === "days" ? `${x.task}|${x.freq.days.join("-")}` : x.task;
  if (!groups.has(k)) { groups.set(k, []); order.push(k); }
  groups.get(k).push(x);
}
const gridRows = order.map((k) => {
  const [name, ds] = k.split("|");
  const list = groups.get(k);
  return {
    task: name,
    sched: ds ? "T" + ds.split("-").join("-") : "mỗi ngày",
    who: ds ? people(list[0].who) : [],
    cells: days.map((d) => {
      const t = tasksForDay({ tasks: list }, d.dow)[0];
      if (!t) return { s: "off" };
      const mark = t.mark;
      const s = mark === "V" || mark === "BV" ? "done" : mark === "B" ? "deferred" : mark === "X" ? "missed" : d.isToday ? "pending" : d.isPast ? "late" : "future";
      return { s, who: people(t.who), lan: t.lan };
    }),
  };
});

const todayTasks = tasksForDay(week, dowToday).map((t) => ({ task: t.task, who: people(t.who), lan: t.lan, s: t.mark === "V" || t.mark === "BV" ? "done" : t.mark === "B" ? "deferred" : t.mark === "X" ? "missed" : "pending" }));
const weekly = weeklyTasks(week).map((x) => ({ task: x.task, who: people(x.who), need: weeklyNeed(x), count: weeklyCount(x), done: weeklyDone(x) }));

// Tab Tick vệ sinh: hàng 1 = ngày, cột A = tên, ô TRUE = bị tick (chưa trực)
const ticks = { people: [], dates: [], month: key(today).slice(3), monthCounts: [], recent: { dates: [], rows: [] } };
const penalty = { from: PENALTY_FROM, every: PENALTY_EVERY, people: [] };
const normName = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]/g, "");
const paidBy = new Map();
if (paidCsv) for (const r of parse(paidCsv, { relax_column_count: true, bom: true }).slice(1)) if (String(r[0] || "").trim()) paidBy.set(normName(r[0]), Number(r[1]) || 0);
if (tickCsv) {
  const rows = parse(tickCsv, { relax_column_count: true, bom: true });
  const header = rows[0] || [];
  const dates = header.map((h) => normDate(h));
  const body = rows.slice(1).filter((r) => String(r[0] || "").trim());
  const toUTC = (k) => { const [d, m, y] = k.split("/").map(Number); return Date.UTC(y, m - 1, d); };
  const recentIdx = dates.map((k, i) => (k && toUTC(k) <= today.getTime() && toUTC(k) > today.getTime() - 30 * DAY ? i : -1)).filter((i) => i >= 0);
  ticks.recent.dates = recentIdx.map((i) => dates[i]);
  for (const r of body) {
    const name = String(r[0]).trim();
    const isT = (i) => String(r[i] || "").trim().toUpperCase() === "TRUE";
    let month = 0, total = 0, since = 0;
    const fromT = toUTC(PENALTY_FROM);
    dates.forEach((k, i) => { if (!k || !isT(i)) return; total++; if (k.slice(3) === ticks.month) month++; if (toUTC(k) >= fromT) since++; });
    const paid = paidBy.get(normName(name)) || 0;
    penalty.people.push({ name, ticks: since, paid, owed: Math.max(0, Math.floor(since / PENALTY_EVERY) - paid), progress: since % PENALTY_EVERY });
    ticks.people.push(name);
    ticks.monthCounts.push({ name, month, total });
    ticks.recent.rows.push({ name, cells: recentIdx.map((i) => isT(i)) });
  }
  ticks.monthCounts.sort((a, b) => b.month - a.month || b.total - a.total || a.name.localeCompare(b.name, "vi"));
}

// Số liệu tổng
const scheduledSoFar = gridRows.flatMap((r) => r.cells.filter((c, i) => c.s !== "off" && (days[i].isPast || days[i].isToday)));
const data = {
  generatedAt: new Date(nowMs).toISOString(),
  today: { key: key(today), label: thuName(dowToday) },
  weekTitle: week.title.replace(/\s+/g, " ").trim(),
  days,
  grid: gridRows,
  todayTasks,
  weekly,
  ticks,
  penalty,
  kpi: {
    todayDone: todayTasks.filter((t) => t.s === "done").length,
    todayTotal: todayTasks.length,
    weekDone: scheduledSoFar.filter((c) => c.s === "done").length,
    weekTotal: scheduledSoFar.length,
    weeklyDone: weekly.filter((w) => w.done).length,
    weeklyTotal: weekly.length,
    monthTicks: ticks.monthCounts.reduce((a, b) => a + b.month, 0),
  },
};

fs.mkdirSync("site", { recursive: true });
fs.writeFileSync("site/data.json", JSON.stringify(data));
console.log(`✅ site/data.json — ${data.weekTitle} · hôm nay ${data.kpi.todayDone}/${data.kpi.todayTotal} · tuần ${data.kpi.weekDone}/${data.kpi.weekTotal} · tick tháng ${data.kpi.monthTicks}`);
