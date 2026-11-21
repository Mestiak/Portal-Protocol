// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak -- Licensed under MIT License

// Shared number/time formatting helpers, used across stats tables, tooltips,
// and timeline labels. Pure functions — no state, safe to import anywhere.

/** Integer with thousands separators, e.g. 12345 -> "12,345". NaN/Inf -> "0". */
export function fmt(n: number): string {
  if (!isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

/** One-decimal percent, e.g. 87.5 -> "87.5". NaN/Inf -> "0". */
export function fmtPct(n: number): string {
  if (!isFinite(n)) return "0";
  return n.toFixed(1);
}

/** Seconds -> m:ss, e.g. 125 -> "2:05". */
export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Standardize GW2 account tag format (e.g. ":User.1234" / "#User.1234" -> "User.1234"). */
export function cleanAccountName(account?: string | null): string {
  if (!account) return "";
  return account.replace(/^[:#]/, "").trim();
}

// Built from char codes rather than a CRLF escape, so the line ending survives
// any editor or patch tool that would turn the escape into a real break.
const CRLF = String.fromCharCode(13, 10);
const CSV_NEEDS_QUOTES = new RegExp(`[",${CRLF}]`);

/**
 * Rows -> CSV. Cells containing a comma, quote or newline are quoted with the
 * quotes doubled; null/undefined become empty cells. Rows join with CRLF, the
 * RFC 4180 line ending that spreadsheet apps expect.
 */
export function toCsv(rows: unknown[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell == null ? "" : String(cell);
          return CSV_NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join(CRLF);
}
