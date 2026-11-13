// Đọc Google Sheet dạng CSV (sheet cần chia sẻ "Bất kỳ ai có đường liên kết đều xem được").
import { parse } from "csv-parse/sync";

export async function fetchSheet(sheetId, gid = "0") {
  return parseCsv(await fetchCsvText(sheetId, gid));
}

export async function fetchCsvText(sheetId, gid = "0") {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { redirect: "follow" });
  const text = await res.text();
  if (!res.ok || text.trimStart().startsWith("<")) {
    throw new Error(`Không đọc được Google Sheet (HTTP ${res.status}). Kiểm tra SHEET_ID/SHEET_GID và quyền chia sẻ "Bất kỳ ai có đường liên kết".`);
  }
  return text;
}

export function parseCsv(text) {
  const rows = parse(text, { columns: (h) => h.map((c) => c.trim()), skip_empty_lines: true, bom: true, relax_column_count: true });
  return rows.filter((r) => Object.values(r).some((v) => String(v).trim()));
}

// Bỏ dấu + chữ thường, để so khớp tên cột / chữ linh hoạt
export const norm = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d")
    .toLowerCase().replace(/[^a-z0-9]/g, "");

export function getCol(row, name) {
  const n = norm(name);
  for (const [k, v] of Object.entries(row)) if (norm(k) === n) return String(v ?? "").trim();
  return undefined;
}

// "13/11/2026", "3/1/2026", "2026-11-13" -> "13/11/2026"
export function normDate(s) {
  s = String(s ?? "").trim().split(/[ T]/)[0];
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[3].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[1]}`;
  return null;
}
