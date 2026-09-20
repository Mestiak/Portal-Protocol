// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

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
