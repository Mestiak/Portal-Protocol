<!-- Portal Protocol - Log Uploader & Log Manager Suite -->
<!-- Copyright (C) 2026 Mestiak -->
<!-- Licensed under MIT License -->

<script lang="ts">
  import type { MechanicReport } from '../lib/mechanicParser';
  import type { CerusLeaderboardRow, CerusPerLog } from '../lib/analyticsEngine';
  import { defaultCerusSort, profIcon } from '../lib/analyticsEngine';

  let { report, rows, perLog }: { report: MechanicReport; rows: CerusLeaderboardRow[]; perLog: CerusPerLog } = $props();

  // Sortable columns: click a header to toggle asc/desc. Default = Orbs desc.
  type SortKey = 'orbs' | 'cryRage' | 'envyStrip' | 'maliceDmg' | 'avgDps';
  let sort = $state<{ key: SortKey; dir: 1 | -1 }>({ key: 'orbs', dir: -1 });

  function toggle(key: SortKey) {
    if (sort.key === key) sort = { key, dir: sort.dir === -1 ? 1 : -1 };
    else sort = { key, dir: -1 };
  }

  let sortedRows = $derived.by(() => {
    const copy = [...rows];
    const dir = sort.dir;
    copy.sort((a, b) => {
      const av = a[sort.key] as number;
      const bv = b[sort.key] as number;
      return dir === -1 ? bv - av : av - bv;
    });
    return copy;
  });

  // Cohort cards: aggregate value + label + placeholder dash (encounter-stat style).
  // Color per your spec: Orb Eff (blue), Total Orbs (blue), Rage Hits (yellow),
  // Shadows Reached (purple), Boons Corrupted (red).
  const cards = $derived([
    { label: 'Orb Efficiency', value: `${report.orbEfficiency}%`, cls: 'cl-blue', series: perLog.orbEff },
    { label: 'Total Orbs', value: report.totalOrbs, cls: 'cl-blue', series: perLog.orbs },
    { label: 'Rage Hits', value: report.rageHits, cls: 'cl-yellow', series: perLog.rageHits },
    { label: 'Shadows Reached', value: report.shadowsReached, cls: 'cl-purple', series: perLog.shadows },
    { label: 'Boons Corrupted', value: report.boonStrippedPlayers, cls: 'cl-red', series: perLog.stripped },
    { label: 'Best Pull', value: `${report.bestPull}%`, cls: 'cl-green', series: perLog.bestPull },
  ]);
</script>

<!-- Cohort summary cards (square stat-cards, matching the encounter-stat style) -->
<div class="cl-cards">
  {#each cards as c}
    <div class="an-card cl-card">
      <div class="cl-card-val {c.cls}">{c.value}</div>
      <div class="cl-card-label">{c.label}</div>
      <div class="cl-card-dash" aria-hidden="true"></div>
    </div>
  {/each}
</div>

<!-- Per-player leaderboard table -->
<div class="sm-table">
  <div class="sm-row sm-head">
    <span class="sm-cell sm-player">Player</span>
    <button class="sm-cell sm-num sm-sort" class:active={sort.key === 'avgDps'} onclick={() => toggle('avgDps')}>
      Avg DPS {sort.key === 'avgDps' ? (sort.dir === -1 ? '▼' : '▲') : ''}
    </button>
    <button class="sm-cell sm-num sm-sort" class:active={sort.key === 'orbs'} onclick={() => toggle('orbs')}>
      Orbs {sort.key === 'orbs' ? (sort.dir === -1 ? '▼' : '▲') : ''}
    </button>
    <button class="sm-cell sm-num sm-sort" class:active={sort.key === 'cryRage'} onclick={() => toggle('cryRage')}>
      Cry of Rage {sort.key === 'cryRage' ? (sort.dir === -1 ? '▼' : '▲') : ''}
    </button>
    <button class="sm-cell sm-num sm-sort" class:active={sort.key === 'envyStrip'} onclick={() => toggle('envyStrip')}>
      Envy Strip {sort.key === 'envyStrip' ? (sort.dir === -1 ? '▼' : '▲') : ''}
    </button>
    <button class="sm-cell sm-num sm-sort" class:active={sort.key === 'maliceDmg'} onclick={() => toggle('maliceDmg')}>
      Malice Dmg {sort.key === 'maliceDmg' ? (sort.dir === -1 ? '▼' : '▲') : ''}
    </button>
  </div>
  {#each sortedRows as r}
    <div class="sm-row">
      <span class="sm-cell sm-player">
        <img class="sm-prof" src={profIcon(r.profession)} alt={r.profession} onerror={(e) => ((e.currentTarget as HTMLImageElement).src = '/professions/guardian.png')} />
        <span class="sm-names">
          <span class="sm-toon">{r.name}</span>
          <span class="sm-acct">{r.account}</span>
        </span>
      </span>
      <span class="sm-cell sm-num">{r.avgDps.toLocaleString()}</span>
      <span class="sm-cell sm-num">{r.orbs}</span>
      <span class="sm-cell sm-num">{r.cryRage}</span>
      <span class="sm-cell sm-num">{r.envyStrip}</span>
      <span class="sm-cell sm-num">{r.maliceDmg.toLocaleString()}</span>
    </div>
  {/each}
</div>

<style>
  .cl-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .cl-card { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; }
  .cl-card-val { font-size: 28px; font-weight: 800; line-height: 1; color: var(--text); font-variant-numeric: tabular-nums; letter-spacing: .01em; }
  .cl-card-val.cl-blue { color: var(--accent); }
  .cl-card-val.cl-yellow { color: #f4c542; }
  .cl-card-val.cl-purple { color: #b18cff; }
  .cl-card-val.cl-red { color: #ff5d5d; }
  .cl-card-val.cl-green { color: #3ddc97; }
  .cl-card-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--text); }
  .cl-card-dash { width: 28px; height: 4px; border-radius: 2px; background: color-mix(in srgb, #fff 22%, transparent); margin-top: 2px; }

  .sm-table { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .sm-row { display: grid; grid-template-columns: 2fr 0.9fr 0.9fr 0.9fr 1fr 1fr; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border); }
  .sm-row:last-child { border-bottom: none; }
  .sm-row:not(.sm-head):hover { background: color-mix(in srgb, #fff 4%, transparent); }
  .sm-head { background: color-mix(in srgb, #fff 3%, transparent); }
  .sm-head .sm-cell { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); font-weight: 600; }
  .sm-num { text-align: right; justify-content: flex-end; }
  .sm-num.sm-sort { background: transparent; border: none; cursor: pointer; color: var(--text-muted); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; transition: color .15s; padding-right: 6px; display: inline-flex; align-items: center; justify-content: flex-end; }
  .sm-num.sm-sort:hover { color: var(--text); }
  .sm-num.sm-sort.active { color: var(--accent); }
  .sm-cell { font-size: 12px; color: var(--text); }
  .sm-player { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .sm-prof { width: 22px; height: 22px; border-radius: 5px; flex: 0 0 auto; background: #0c0d12; }
  .sm-names { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
  .sm-toon { font-weight: 600; }
  .sm-acct { font-size: 11px; color: var(--text-muted); }
</style>
