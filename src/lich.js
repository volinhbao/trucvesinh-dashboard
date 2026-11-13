// Đọc tab "Lịch mới": lấy bảng tuần MỚI NHẤT (bảng dưới cùng có tiêu đề "LỊCH TRỰC VỆ SINH"),
// rồi tính việc của hôm nay + ai chưa điểm danh.
//
// Cột: A=STT, B=Nội dung, D=Tần suất/Ngày, E=Phân công, F/G/H=Điểm danh lần 1/2/3 (V = đã trực, X = chưa)
import { parse } from "csv-parse/sync";
import { norm } from "./sheet.js";

const COL = { stt: 0, task: 1, freq: 3, who: 4, dd: [5, 6, 7] };
const THU_SO = { 1: "Thứ Hai", 2: "Thứ Ba", 3: "Thứ Tư", 4: "Thứ Năm", 5: "Thứ Sáu", 6: "Thứ Bảy", 0: "Chủ nhật" };

export function parseGrid(csvText) {
  return parse(csvText, { bom: true, relax_column_count: true, skip_empty_lines: false });
}

const cell = (r, i) => String(r?.[i] ?? "").trim();
const shortName = (s) => s.split("\n")[0].split("(")[0].trim();   // "Trực bếp ( lau chùi..." -> "Trực bếp"
const cleanName = (s) => s.replace(/\s*[–-]\s*/g, " – ").replace(/\s+/g, " ").trim();

// Ngày trong tuần (JS: 0=CN..6=T7) -> số "thứ" kiểu VN (2..7, CN=8)
const thuVN = (dow) => (dow === 0 ? 8 : dow + 1);

// Phân tích tần suất -> { type: "days", days:[2,4,6] } | { type: "day", day:3 } | { type: "week" }
function parseFreq(f) {
  const n = norm(f);
  if (/chuanhat|chunhat|^cn$/.test(n)) return { type: "day", day: 8 };
  const one = n.match(/^thu(\d)$/);
  if (one) return { type: "day", day: +one[1] };
  const many = f.match(/th[uứ]\s*([\d,\s]+)/i);
  if (many) return { type: "days", days: many[1].split(/[,\s]+/).filter(Boolean).map(Number) };
  return { type: "week", label: f.replace(/\s+/g, " ") };
}

// Đọc 1 bảng tuần bắt đầu ở dòng `start` (dòng tiêu đề "LỊCH TRỰC VỆ SINH ...")
function readBlock(grid, start) {
  const title = cell(grid[start], 0).replace(/\s+/g, " ");
  const tasks = [];
  let lastTask = "";
  for (let i = start + 2; i < grid.length; i++) {
    const r = grid[i];
    if (norm(cell(r, 0)).startsWith("lichtrucvesinh")) break;
    const taskCell = cell(r, COL.task);
    const freqCell = cell(r, COL.freq);
    if (!taskCell && !freqCell) continue;
    if (taskCell) lastTask = taskCell;           // dòng không có nội dung = nối tiếp việc phía trên (vd đổ rác Thứ 3, 4...)
    tasks.push({
      row: i + 1,
      task: shortName(lastTask),
      detail: lastTask,
      freq: parseFreq(freqCell),
      who: cleanName(cell(r, COL.who)),
      dd: COL.dd.map((c) => cell(r, c).toUpperCase()),
    });
  }
  return { title, tasks, startRow: start + 1 };
}

// Ngày bắt đầu tuần từ tiêu đề: "27 - 03/08" -> 27/07, "31/8 - 7/09" -> 31/08, "5/10 - 12/10" -> 05/10
// Trả về { d, m } hoặc null nếu tiêu đề không ghi ngày.
export function titleStart(title) {
  const t = title.replace(/^.*?V[ỆE]\s*SINH/i, "");
  let m = t.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*[-–]\s*\d{1,2}\s*\/\s*\d{1,2}/);
  if (m) return { d: +m[1], m: +m[2] };
  m = t.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (m) {
    const d1 = +m[1], d2 = +m[2], mon = +m[3];
    return { d: d1, m: d1 > d2 ? (mon === 1 ? 12 : mon - 1) : mon };
  }
  return null;
}

export function allWeeks(grid) {
  const weeks = [];
  grid.forEach((r, i) => { if (norm(cell(r, 0)).startsWith("lichtrucvesinh")) weeks.push(readBlock(grid, i)); });
  if (!weeks.length) throw new Error('Không tìm thấy bảng "LỊCH TRỰC VỆ SINH" trong tab lịch.');
  return weeks;
}

export function latestWeek(grid) {
  const w = allWeeks(grid);
  return w[w.length - 1];
}

// Bảng tuần áp dụng cho 1 ngày (Date ở giờ VN, chỉ dùng năm/tháng/ngày UTC của nó):
// bảng có ngày bắt đầu <= ngày đó < +7 ngày; không có thì bảng mới nhất.
export function weekFor(grid, vnDay) {
  const weeks = allWeeks(grid);
  const y = vnDay.getUTCFullYear();
  const day = Date.UTC(y, vnDay.getUTCMonth(), vnDay.getUTCDate());
  let pick = null;
  for (const w of weeks) {
    const st = titleStart(w.title);
    if (!st) continue;
    let start = Date.UTC(y, st.m - 1, st.d);
    if (start - day > 180 * 864e5) start = Date.UTC(y - 1, st.m - 1, st.d); // tuần cuối năm trước
    if (start <= day && day < start + 7 * 864e5) pick = w;
  }
  return pick || weeks[weeks.length - 1];
}

// Việc hôm nay + lần điểm danh tương ứng
export function tasksForDay(week, dow) {
  const t = thuVN(dow);
  const out = [];
  for (const x of week.tasks) {
    if (x.freq.type === "day" && x.freq.day === t) out.push({ ...x, lan: 1 });
    if (x.freq.type === "days" && x.freq.days.includes(t)) out.push({ ...x, lan: x.freq.days.indexOf(t) + 1 });
  }
  return out.map((x) => ({ ...x, mark: x.dd[x.lan - 1] || "" }));
}

export const weeklyTasks = (week) => week.tasks.filter((x) => x.freq.type === "week");

// Việc tuần: cần bao nhiêu lần V ("Min=3" -> 3, mặc định 1; tối đa 3 vì chỉ có 3 cột điểm danh)
export function weeklyNeed(x) {
  const m = String(x.freq.label || "").match(/min\s*=\s*(\d+)/i);
  return Math.min(3, Math.max(1, m ? +m[1] : 1));
}
export const weeklyCount = (x) => x.dd.filter((m) => m === "V").length;
export const weeklyDone = (x) => weeklyCount(x) >= weeklyNeed(x);
// Lần điểm danh kế tiếp còn trống (1..3)
export const weeklyNextLan = (x) => { const i = x.dd.findIndex((m) => m !== "V"); return i < 0 ? 3 : i + 1; };
const weeklyProgress = (x) => (weeklyNeed(x) > 1 ? ` (${weeklyCount(x)}/${weeklyNeed(x)} lần)` : "");
export const thuName = (dow) => THU_SO[dow];

// Ký hiệu ô Điểm danh: V = đã trực, X = chưa trực, B = xin trực bù (dời sang CN), BV = đã trực bù
export const isDoneMark = (m) => m === "V" || m === "BV";
export const isDeferredMark = (m) => m === "B";

// Thứ (dow JS) của 1 ô điểm danh: việc thứ 2,4,6 lần 2 -> thứ 4; việc "Thứ 5" -> thứ 5
export function cellDow(x, lan) {
  const t = x.freq.type === "days" ? x.freq.days[lan - 1] : x.freq.type === "day" ? x.freq.day : null;
  return t == null ? null : t === 8 ? 0 : t - 1;
}

// Các ô trực bù trong tuần: [{ ...task, lan, col, mark, fromDow }]
export function makeupCells(week) {
  const out = [];
  for (const x of week.tasks) {
    if (x.freq.type === "week") continue;
    x.dd.forEach((m, i) => {
      if (m === "B" || m === "BV") out.push({ ...x, lan: i + 1, col: 6 + i, mark: m, fromDow: cellDow(x, i + 1) });
    });
  }
  return out;
}

// Ghép thành các đoạn văn bản để điền vào mẫu tin nhắn
export function buildBlocks(week, dow) {
  const today = tasksForDay(week, dow);
  const weekly = weeklyTasks(week);
  // Bọc tên người trong ⟦ ⟧ để bot thay bằng @tag khi gửi: "T.Nhân – Bảo" -> "⟦T.Nhân⟧ – ⟦Bảo⟧"
  const tag = (who) => who.split(/(\s*[–+,&]\s*|\s+-\s+)/).map((p, i) => (i % 2 || !p.trim() ? p : `⟦${p.trim()}⟧`)).join("");
  const line = (x) => `• ${x.task}: ${x.who ? tag(x.who) : "(chưa phân công)"}`;
  const notDone = today.filter((x) => !isDoneMark(x.mark) && !isDeferredMark(x.mark));
  const deferredToday = today.filter((x) => isDeferredMark(x.mark));
  const pendingMakeups = makeupCells(week).filter((c) => c.mark === "B");
  let trucBu = "";
  if (dow === 0 && pendingMakeups.length) {
    trucBu = "🔁 Trực bù hôm nay (Chủ nhật):\n" + pendingMakeups.map((c) => `• ${c.task} (dời từ ${THU_SO[c.fromDow] || "?"}): ${tag(c.who)}`).join("\n");
  } else if (dow !== 0 && deferredToday.length) {
    trucBu = "🔁 Đã xin trực bù, dời sang Chủ nhật:\n" + deferredToday.map((x) => `• ${x.task}: ${tag(x.who)}`).join("\n");
  }
  const weeklyLeft = weekly.filter((x) => !weeklyDone(x));
  return {
    tieu_de_tuan: week.title,
    viec_hom_nay: today.map(line).join("\n") || "(Hôm nay không có lịch)",
    viec_tuan: weekly.map(line).join("\n"),
    viec_tuan_chua_xong: weeklyLeft.map((x) => line(x) + weeklyProgress(x)).join("\n") || "(Đã xong hết)",
    so_viec_tuan_chua_xong: String(weeklyLeft.length),
    chua_diem_danh: notDone.map((x) => `${line(x)}${x.mark === "X" ? " ❌" : ""}`).join("\n") || "✅ Tất cả đã trực xong!",
    so_chua_diem_danh: String(notDone.length),
    truc_bu: trucBu,
  };
}
