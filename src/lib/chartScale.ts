// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

/**
 * chartScale.ts
 * Pure chart geometry for the Analytics tab's SVG charts. No Svelte or DOM
 * dependencies, so the layout maths can be unit-tested directly.
 *
 * Canvas needed a measured pixel width; SVG uses a `viewBox`, so these helpers
 * work in the SVG's own coordinate space and the caller supplies that space.
 */

/** Linear scale mapping `[d0, d1]` onto `[r0, r1]`. A zero-width domain maps
 *  everything to the range start rather than dividing by zero. */
export function lin(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (!span) return () => r0;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

export interface BandScale {
  /** Width of a single band. */
  width: number;
  /** Left edge of band `i`. */
  start: (i: number) => number;
}

/** Band scale: `count` bands of equal width inside `size`, `gap` apart. */
export function bandScale(size: number, count: number, gap: number): BandScale {
  const width = count > 0 ? Math.max(0, (size - gap * (count - 1)) / count) : 0;
  return { width, start: (i: number) => i * (width + gap) };
}

/** `count + 1` tick values from 0 to `max`, endpoints included. A non-positive
 *  max yields `[0]` so a chart never divides by zero. */
export function ticks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const step = max / count;
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(step * i);
  return out;
}

/** Clamp `v` into `[lo, hi]`. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ─── Chart layouts ───────────────────────────────────────────────────────────
// Pure layout for the Analytics tab's SVG charts. Each takes the pixel width the
// component measured and returns coordinates in that same space, so the SVG's
// user units equal CSS pixels and hover hit-testing needs no scaling factor.

export interface ActivityBar {
  x: number; w: number;
  wipeH: number; wipeY: number;
  killH: number; killY: number;
  label: string; showLabel: boolean;
}

export interface ActivityLayout {
  W: number; H: number; PL: number; PR: number; baseY: number;
  grid: { v: number; y: number }[];
  bars: ActivityBar[];
}

/** Stacked kills-over-wipes bars, one per activity bucket. */
export function activityLayout(
  series: { label: string; kills: number; wipes: number; total: number }[],
  W: number,
  H = 200,
): ActivityLayout | null {
  if (!W || series.length === 0) return null;
  const PL = 36, PR = 12, PT = 12, PB = 40;
  const cW = W - PL - PR, cH = H - PT - PB;
  const maxV = Math.max(...series.map(p => p.total), 1);
  const toY = lin(0, maxV, PT + cH, PT);
  const band = bandScale(cW, series.length, 4);
  const step = series.length <= 14 ? 1 : series.length <= 30 ? 3 : 7;
  return {
    W, H, PL, PR, baseY: PT + cH,
    grid: ticks(maxV).map(v => ({ v, y: toY(v) })),
    bars: series.map((p, i) => {
      const hW = (p.wipes / maxV) * cH;
      const hK = (p.kills / maxV) * cH;
      return {
        x: PL + band.start(i), w: band.width,
        wipeH: hW, wipeY: PT + cH - hW,
        killH: hK, killY: PT + cH - hW - hK,
        label: p.label, showLabel: i % step === 0,
      };
    }),
  };
}

export interface WipeRow {
  label: string; count: number; y: number; h: number; w: number;
}

export interface WipeLayout {
  W: number; H: number; PL: number; trackW: number;
  rows: WipeRow[];
}

/** Horizontal bars, one per wipe-depth bucket. */
export function wipeLayout(
  buckets: { label: string; count: number }[],
  W: number,
  H = 200,
): WipeLayout | null {
  if (!W) return null;
  const PL = 52, PR = 12, PT = 12, PB = 16;
  const cW = W - PL - PR, cH = H - PT - PB;
  const maxC = Math.max(...buckets.map(b => b.count), 1);
  const gap = 6;
  const bH = (cH - gap * (buckets.length - 1)) / buckets.length;
  return {
    W, H, PL, trackW: cW,
    rows: buckets.map((b, i) => ({
      label: b.label, count: b.count,
      y: PT + i * (bH + gap), h: bH,
      w: b.count > 0 ? (b.count / maxC) * cW : 0,
    })),
  };
}

export interface ProfRow {
  name: string; pct: number; color: string; barPct: number;
}

/** Ranked rows for the squad-composition list, relative to the largest group. */
export function professionRows(
  professions: { name: string; color: string; count: number; pct: number }[],
  limit = 6,
): ProfRow[] {
  const top = professions.slice(0, limit);
  const maxP = Math.max(...top.map(p => p.count), 1);
  return top.map(p => ({
    name: p.name, pct: p.pct, color: p.color,
    barPct: (p.count / maxP) * 100,
  }));
}

export interface DpsPoint {
  label: string;
  players: Record<string, { value: number }>;
}

export interface DpsDot { x: number; y: number; hot: boolean }
export interface DpsLine { key: string; color: string; points: string; dots: DpsDot[] }

export interface DpsLayout<P> {
  empty: null;
  W: number; H: number; PL: number; PR: number; PB: number; baseY: number;
  showDots: boolean;
  grid: { val: number; y: number }[];
  lines: DpsLine[];
  xLabels: { x: number; label: string }[];
  hitboxes: { x: number; point: P }[];
}

/** One polyline per compared account, on a single shared DPS axis. */
export function dpsLayout<P extends DpsPoint>(
  series: P[],
  W: number,
  opts: { keys: string[]; color: (key: string) => string; hovered: P | null; height?: number },
): DpsLayout<P> | null {
  if (!W) return null;
  const H = opts.height ?? 210;
  const PL = 50, PR = 12, PT = 15, PB = 35;
  const cW = W - PL - PR, cH = H - PT - PB;

  const allValues: number[] = [];
  for (const pt of series) for (const m of Object.values(pt.players)) allValues.push(m.value);
  const minVal = allValues.length ? Math.min(...allValues) * 0.9 : 0;
  const maxVal = allValues.length ? Math.max(...allValues) * 1.1 : 10000;
  const toY = lin(minVal, maxVal, PT + cH, PT);
  const toX = (i: number) => PL + (series.length > 1 ? (i / (series.length - 1)) * cW : cW / 2);
  const xs = series.map((_, i) => toX(i));

  const lines = opts.keys.map((key) => {
    const pts = series.flatMap((pt, i) => {
      const m = pt.players[key];
      return m ? [{ pt, i, m }] : [];
    });
    return {
      key,
      color: opts.color(key),
      points: pts.map((d) => `${xs[d.i].toFixed(1)},${toY(d.m.value).toFixed(1)}`).join(' '),
      dots: pts.map((d) => ({ x: xs[d.i], y: toY(d.m.value), hot: opts.hovered === d.pt })),
    };
  });

  const labelStep = Math.max(1, Math.floor(series.length / 8));
  return {
    empty: null, W, H, PL, PR, PB, baseY: PT + cH,
    showDots: series.length <= 30,
    grid: ticks(maxVal - minVal).map(v => { const val = v + minVal; return { val, y: toY(val) }; }),
    lines,
    xLabels: series
      .map((pt, i) => ({ pt, i }))
      .filter((d) => d.i % labelStep === 0)
      .map((d) => ({ x: xs[d.i], label: d.pt.label })),
    hitboxes: series.map((pt, i) => ({ x: xs[i], point: pt })),
  };
}
