<!-- Portal Protocol - Log Uploader & Log Manager Suite -->
<!-- Copyright (C) 2026 Mestiak -->
<!-- Licensed under MIT License -->

<script lang="ts">
  // Shared filter toolbar reused by Uploads Feed, History, and Folders/Subfolders.
  // Pure presentation: it only binds to the `filters` object passed in and emits
  // `onchange` when the user clears all. All filtering logic lives in +page.svelte.

  interface VlRankOption {
    id: string;
    label: string;
    icon: string;
  }

  interface BossOption {
    key: string;
    label: string;
  }

  interface Filters {
    result: "all" | "success" | "failure";
    type: "all" | "raid" | "strike" | "fractal" | "convergence";
    boss: string; // "all" or a normalized boss key
    vlRank: string; // "all" | "none" | "any" | specific id
    cmMode: "all" | "cm" | "lcm" | "normal" | "quickplay";
    search: string;
    datePreset: "all" | "today" | "7d" | "30d" | "month" | "custom";
    dateFrom: string; // "YYYY-MM-DD"
    dateTo: string;   // "YYYY-MM-DD"
    timeFrom: string; // "HH:MM" — optional time-of-day lower bound
    timeTo: string;   // "HH:MM" — optional time-of-day upper bound
    profession: string | number; // "all" or a PROFESSIONS key / elite_spec id
    professionKind: "all" | "core" | "spec"; // distinguishes base-id vs elite-spec-id
    hasNotes: boolean; // true = only show logs with notes attached
  }

  interface ProfessionOption {
    value: number;
    name: string;
    icon: string;
  }

  // A core profession plus the elite specs that branch off it (window 2 content).
  interface ProfessionGroup {
    id: number;        // base profession id (PROFESSIONS key)
    name: string;      // e.g. "Guardian"
    icon: string;      // core icon
    specs: { id: number; name: string; icon: string }[];
  }

  interface Props {
    filters: Filters;
    bosses?: BossOption[];
    vlRanks?: VlRankOption[];
    professions?: ProfessionOption[];
    professionGroups?: ProfessionGroup[];
    showCounts?: boolean;
    resultCount?: number;
    totalCount?: number;
    onchange?: () => void;
  }

  let {
    filters,
    bosses = [],
    vlRanks = [],
    professions = [],
    professionGroups = [],
    showCounts = false,
    resultCount = 0,
    totalCount = 0,
    onchange,
  }: Props = $props();

  let collapsed = $state(true);
  let profOpen = $state(false);
  // Profession picker modal navigation: null = closed, "core" = core list,
  // number = showing that core's elite specs.
  let profStep = $state<null | "core" | number>(null);

  const selectedProf = $derived(
    typeof filters.profession === "number"
      ? professions.find(p => p.value === filters.profession)
      : undefined
  );
  // Active elite spec (selected by id in the modal) — resolved from the groups.
  const selectedSpec = $derived.by(() => {
    if (typeof filters.profession !== "number") return undefined;
    for (const g of professionGroups) {
      const s = g.specs.find(s => s.id === filters.profession);
      if (s) return s;
    }
    return undefined;
  });

  const RESULT_OPTS: { v: Filters["result"]; label: string }[] = [
    { v: "all", label: "All Results" },
    { v: "success", label: "Success" },
    { v: "failure", label: "Failure" },
  ];
  const TYPE_OPTS: { v: Filters["type"]; label: string }[] = [
    { v: "all", label: "All Types" },
    { v: "raid", label: "Raid" },
    { v: "strike", label: "Strike" },
    { v: "fractal", label: "Fractal" },
    { v: "convergence", label: "Convergence" },
  ];
  const CM_OPTS: { v: Filters["cmMode"]; label: string }[] = [
    { v: "all", label: "Any Mode" },
    { v: "cm", label: "CM" },
    { v: "lcm", label: "LCM" },
    { v: "normal", label: "Normal" },
    { v: "quickplay", label: "Quick Play" },
  ];
  const DATE_OPTS: { v: Filters["datePreset"]; label: string }[] = [
    { v: "all", label: "Any Date" },
    { v: "today", label: "Today" },
    { v: "7d", label: "Last 7d" },
    { v: "30d", label: "Last 30d" },
    { v: "month", label: "This Month" },
    { v: "custom", label: "Custom" },
  ];

  const hasActive =
    $derived(
      filters.result !== "all" ||
        filters.type !== "all" ||
        filters.boss !== "all" ||
        filters.vlRank !== "all" ||
        filters.cmMode !== "all" ||
        filters.datePreset !== "all" ||
        filters.dateFrom !== "" ||
        filters.dateTo !== "" ||
        filters.timeFrom !== "" ||
        filters.timeTo !== "" ||
        filters.profession !== "all" ||
        filters.hasNotes
    );

  // Exclude search from drawer-badge to distinguish text search from active category filters
  const activeFiltersCount = $derived.by(() => {
    let count = 0;
    if (filters.result !== "all") count++;
    if (filters.type !== "all") count++;
    if (filters.cmMode !== "all") count++;
    if (filters.datePreset !== "all") count++;
    if (filters.timeFrom || filters.timeTo) count++;
    if (filters.profession !== "all") count++;
    if (filters.boss !== "all") count++;
    if (filters.vlRank !== "all") count++;
    return count;
  });

  function clearAll() {
    filters.result = "all";
    filters.type = "all";
    filters.boss = "all";
    filters.vlRank = "all";
    filters.cmMode = "all";
    filters.search = "";
    filters.datePreset = "all";
    filters.dateFrom = "";
    filters.dateTo = "";
    filters.timeFrom = "";
    filters.timeTo = "";
    filters.profession = "all";
    onchange?.();
  }

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // Individual removable chips summarizing every active filter.
  const activeChips = $derived.by(() => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (filters.result !== "all")
      chips.push({ key: "result", label: cap(filters.result), clear: () => { filters.result = "all"; } });
    if (filters.type !== "all")
      chips.push({ key: "type", label: cap(filters.type), clear: () => { filters.type = "all"; } });
    if (filters.cmMode !== "all")
      chips.push({ key: "cm", label: filters.cmMode.toUpperCase(), clear: () => { filters.cmMode = "all"; } });
    if (filters.datePreset !== "all") {
      const d = DATE_OPTS.find((o) => o.v === filters.datePreset);
      let label = d ? d.label : filters.datePreset;
      if (filters.datePreset === "custom" && (filters.dateFrom || filters.dateTo))
        label = `Custom ${filters.dateFrom || "…"}–${filters.dateTo || "…"}`;
      chips.push({ key: "date", label, clear: () => { filters.datePreset = "all"; filters.dateFrom = ""; filters.dateTo = ""; } });
    }
    if (filters.boss !== "all") {
      const b = bosses.find((x) => x.key === filters.boss);
      chips.push({ key: "boss", label: `Boss: ${b ? b.label : filters.boss}`, clear: () => { filters.boss = "all"; } });
    }
    if (filters.vlRank !== "all") {
      const label =
        filters.vlRank === "none" ? "No Rank" :
        filters.vlRank === "any" ? "Has Rank" :
        (vlRanks.find((r) => r.id === filters.vlRank)?.label ?? filters.vlRank);
      chips.push({ key: "vl", label: `Rank: ${label}`, clear: () => { filters.vlRank = "all"; } });
    }
    if (filters.profession !== "all") {
      const label = selectedSpec?.name ?? selectedProf?.name ?? String(filters.profession);
      chips.push({ key: "prof", label: `Prof: ${label}`, clear: () => { filters.profession = "all"; } });
    }
    if (filters.timeFrom || filters.timeTo) {
      const label = `${filters.timeFrom || "00:00"}–${filters.timeTo || "23:59"}`;
      chips.push({ key: "time", label: `Time ${label}`, clear: () => { filters.timeFrom = ""; filters.timeTo = ""; } });
    }
    if (filters.hasNotes)
      chips.push({ key: "hasNotes", label: "Has Notes", clear: () => { filters.hasNotes = false; } });
    if (filters.search.trim() !== "")
      chips.push({ key: "search", label: `“${filters.search.trim()}”`, clear: () => { filters.search = ""; } });
    return chips;
  });

  function removeChip(c: { clear: () => void }) {
    c.clear();
    onchange?.();
  }
</script>

<div class="filter-bar-component">
  <!-- Slim Top Row: Search input + toggle -->
  <div class="filter-top-row">
    <div class="search-container">
      <i class="fa-solid fa-magnifying-glass search-icon-left"></i>
      <input
        type="text"
        class="search-input"
        placeholder="Search boss, player, or spec…"
        bind:value={filters.search}
        oninput={() => onchange?.()}
      />
      {#if filters.search.trim() !== ""}
        <button
          class="search-clear"
          title="Clear search"
          aria-label="Clear search"
          onclick={() => { filters.search = ""; onchange?.(); }}
        >✕</button>
      {/if}
    </div>

    <!-- Toggle Button for Categories/Dropdowns -->
    <button
      class="filter-toggle-btn"
      class:drawer-open={!collapsed}
      class:has-active={activeFiltersCount > 0}
      onclick={() => collapsed = !collapsed}
      title="Filter options"
    >
      <i class="fa-solid fa-sliders"></i>
      <span>Filters</span>
      {#if activeFiltersCount > 0}
        <span class="active-count-badge">{activeFiltersCount}</span>
      {/if}
    </button>

    {#if showCounts}
      <span class="filter-count tabular-nums">
        Showing {resultCount} of {totalCount}
      </span>
    {/if}
  </div>

  <!-- Slide-down categories/options drawer -->
  <div class="filter-drawer" class:collapsed={collapsed}>
    <div class="filter-drawer-inner">
      <div class="drawer-row">
        <!-- Results toggles -->
        <div class="filter-group">
          {#each RESULT_OPTS as o}
            <button
              class="filter-btn"
              class:active={filters.result === o.v}
              onclick={() => {
                filters.result = o.v;
                onchange?.();
              }}>{o.label}</button
            >
          {/each}
        </div>

        <!-- Types toggles -->
        <div class="filter-group">
          {#each TYPE_OPTS as o}
            <button
              class="filter-btn"
              class:active={filters.type === o.v}
              onclick={() => {
                filters.type = o.v;
                onchange?.();
              }}>{o.label}</button
            >
          {/each}
        </div>

        <!-- CM Mode toggles -->
        <div class="filter-group">
          {#each CM_OPTS as o}
            <button
              class="filter-btn"
              class:active={filters.cmMode === o.v}
              onclick={() => {
                filters.cmMode = o.v;
                onchange?.();
              }}>{o.label}</button
            >
          {/each}
        </div>
      </div>

      <div class="drawer-row">
        <!-- Date Presets -->
        <div class="filter-group">
          {#each DATE_OPTS as o}
            <button
              class="filter-btn"
              class:active={filters.datePreset === o.v}
              onclick={() => {
                filters.datePreset = o.v;
                if (o.v !== "custom") {
                  filters.dateFrom = "";
                  filters.dateTo = "";
                }
                onchange?.();
              }}>{o.label}</button
            >
          {/each}
        </div>

        {#if filters.datePreset === "custom"}
          <div class="date-range">
            <input
              type="date"
              class="filter-date"
              value={filters.dateFrom}
              max={filters.dateTo || undefined}
              onchange={(e) => { filters.dateFrom = (e.currentTarget as HTMLInputElement).value; onchange?.(); }}
              aria-label="From date"
            />
            <span class="date-sep">→</span>
            <input
              type="date"
              class="filter-date"
              value={filters.dateTo}
              min={filters.dateFrom || undefined}
              onchange={(e) => { filters.dateTo = (e.currentTarget as HTMLInputElement).value; onchange?.(); }}
              aria-label="To date"
            />
          </div>
          <!-- Time-of-day narrowers: leave both empty for no time restriction. -->
          <div class="time-range">
            <input
              type="time"
              class="filter-time"
              value={filters.timeFrom}
              step="60"
              onchange={(e) => { filters.timeFrom = (e.currentTarget as HTMLInputElement).value; onchange?.(); }}
              aria-label="From time"
            />
            <span class="date-sep">→</span>
            <input
              type="time"
              class="filter-time"
              value={filters.timeTo}
              step="60"
              onchange={(e) => { filters.timeTo = (e.currentTarget as HTMLInputElement).value; onchange?.(); }}
              aria-label="To time"
            />
          </div>
        {/if}
      </div>

      <div class="drawer-row selects-row">
        <select
          class="filter-select"
          value={filters.boss}
          onchange={(e) => {
            filters.boss = (e.currentTarget as HTMLSelectElement).value;
            onchange?.();
          }}
        >
          <option value="all">All Bosses</option>
          {#each bosses as b}
            <option value={b.key}>{b.label}</option>
          {/each}
        </select>

        <select
          class="filter-select"
          value={filters.vlRank}
          onchange={(e) => {
            filters.vlRank = (e.currentTarget as HTMLSelectElement).value;
            onchange?.();
          }}
        >
          <option value="all">Any Rank</option>
          <option value="none">No Rank</option>
          <option value="any">Has Rank</option>
          {#each vlRanks as r}
            <option value={r.id}>{r.icon} {r.label}</option>
          {/each}
        </select>

        <!-- Profession filter: opens a two-step modal (core → elite specs). -->
        <button
          class="prof-filter-btn"
          class:active={filters.profession !== "all"}
          onclick={() => { profStep = "core"; }}
          title="Filter by profession"
        >
          {#if selectedSpec}
            <img src={selectedSpec.icon} alt="" class="pb-icon" />
            {selectedSpec.name}
          {:else if selectedProf}
            <img src={selectedProf.icon} alt="" class="pb-icon" />
            {selectedProf.name}
          {:else}
            All Professions
          {/if}
          <i class="fa-solid fa-chevron-down pb-caret"></i>
        </button>

        {#if profStep !== null}
          <div
            class="prof-modal-overlay"
            role="button"
            tabindex="0"
            aria-label="Close profession picker"
            onclick={(e) => { if (e.target === e.currentTarget) { profStep = null; } }}
            onkeydown={(e) => { if (e.key === "Escape") { profStep = null; } }}
          >
            <div class="prof-modal" role="dialog" aria-modal="true">
              {#if profStep === "core"}
                <div class="prof-modal-head">
                  <span class="prof-modal-title">Filter by Profession</span>
                  <button class="prof-modal-close" onclick={() => profStep = null} aria-label="Close">✕</button>
                </div>
                <div class="prof-grid prof-grid-core">
                  {#each professionGroups as g}
                    <button class="prof-cell" onclick={() => { profStep = g.id; }}>
                      <img src={g.icon} alt="" class="prof-cell-icon" />
                      <span class="prof-cell-name">{g.name}</span>
                      <i class="fa-solid fa-chevron-right prof-cell-arrow"></i>
                    </button>
                  {/each}
                </div>
              {:else}
                {@const grp = professionGroups.find(g => g.id === profStep)}
                <div class="prof-modal-head">
                  <button class="prof-modal-back" onclick={() => profStep = "core"} aria-label="Back to professions">
                    <i class="fa-solid fa-chevron-left"></i> Professions
                  </button>
                  <button class="prof-modal-close" onclick={() => profStep = null} aria-label="Close">✕</button>
                </div>
                {#if grp}
                  <div class="prof-modal-title sub">{grp.name} — Elite Specializations</div>
                  <div class="prof-grid">
                    <button class="prof-cell prof-cell-core" onclick={() => { filters.profession = grp.id; filters.professionKind = "core"; profStep = null; onchange?.(); }}>
                      <img src={grp.icon} alt="" class="prof-cell-icon" />
                      <span class="prof-cell-name">{grp.name} (Core)</span>
                      {#if grp.id === Number(filters.profession) && filters.professionKind === "core"}<i class="fa-solid fa-check prof-cell-check"></i>{/if}
                    </button>
                    {#each grp.specs as s}
                      <button class="prof-cell" onclick={() => { filters.profession = s.id; filters.professionKind = "spec"; profStep = null; onchange?.(); }}>
                        <img src={s.icon} alt="" class="prof-cell-icon" />
                        <span class="prof-cell-name">{s.name}</span>
                        {#if s.id === Number(filters.profession) && filters.professionKind === "spec"}<i class="fa-solid fa-check prof-cell-check"></i>{/if}
                      </button>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          </div>
        {/if}

        {#if hasActive}
          <button class="clear-filters-btn" onclick={clearAll} title="Clear all filters">
            ✕ Clear All Filters
          </button>
        {/if}

        <!-- Has Notes toggle -->
        <button
          class="filter-btn"
          class:active={filters.hasNotes}
          onclick={() => { filters.hasNotes = !filters.hasNotes; onchange?.(); }}
          title="Only show logs with notes"
        >
          <i class="fa-solid fa-note-sticky"></i>
          <span>Has Notes</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Active Chips summaries below -->
  {#if activeChips.length > 0}
    <div class="filter-chips">
      {#each activeChips as c (c.key)}
        <button class="filter-chip" onclick={() => removeChip(c)} title="Remove filter">
          <span>{c.label}</span>
          <span class="chip-x">✕</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .filter-bar-component {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    margin-bottom: 12px;
  }

  .filter-top-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
  }

  /* Search box input styles */
  .search-container {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
  }

  .search-icon-left {
    position: absolute;
    left: 10px;
    font-size: 11px;
    color: var(--text-muted);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 6px 30px 6px 28px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 12px;
    font-weight: 500;
    font-family: var(--font);
    outline: none;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .search-input:focus {
    border-color: var(--accent);
    background: rgba(255, 255, 255, 0.05);
  }

  .search-clear {
    position: absolute;
    right: 8px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 10px;
    padding: 4px;
    transition: color 0.15s ease;
  }
  .search-clear:hover {
    color: var(--text);
  }

  /* Toggle button */
  .filter-toggle-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    user-select: none;
  }
  .filter-toggle-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
    border-color: rgba(255, 255, 255, 0.15);
  }
  .filter-toggle-btn.drawer-open {
    background: rgba(168, 85, 247, 0.12);
    border-color: rgba(168, 85, 247, 0.4);
    color: #c084fc;
  }
  .filter-toggle-btn.has-active:not(.drawer-open) {
    border-color: rgba(168, 85, 247, 0.25);
    background: rgba(168, 85, 247, 0.05);
    color: rgba(255, 255, 255, 0.8);
  }

  .active-count-badge {
    background: #a855f7;
    color: white;
    font-size: 9px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 10px;
    line-height: 1;
    min-width: 8px;
    text-align: center;
  }

  .filter-count {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 500;
    white-space: nowrap;
  }

  /* Slide-down filter drawer */
  .filter-drawer {
    display: grid;
    grid-template-rows: 1fr;
    transition: grid-template-rows 0.25s cubic-bezier(0.32, 0.72, 0, 1),
                opacity 0.2s ease,
                margin-top 0.25s cubic-bezier(0.32, 0.72, 0, 1);
    opacity: 1;
    margin-top: 4px;
    /* Open state must NOT clip — the Profession popover overflows downward
       over the log list. Overflow is only hidden while collapsed (see below). */
    overflow: visible;
    position: relative;
    z-index: 40;
  }
  .filter-drawer.collapsed {
    grid-template-rows: 0fr;
    opacity: 0;
    margin-top: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .filter-drawer-inner {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    background: rgba(15, 15, 25, 0.4);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-sizing: border-box;
  }

  .drawer-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .selects-row {
    margin-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.03);
    padding-top: 8px;
  }

  .filter-group {
    display: flex;
    background: rgba(255, 255, 255, 0.02);
    padding: 2px;
    border-radius: 6px;
    border: 1px solid var(--border);
  }

  .filter-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font);
    transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  .filter-btn:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.04);
  }
  .filter-btn.active {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
  }

  .prof-filter-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font);
    border-radius: 7px;
    padding: 6px 12px;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .prof-filter-btn:hover {
    background: rgba(168, 85, 247, 0.12);
    border-color: rgba(168, 85, 247, 0.4);
    color: var(--text);
  }
  .prof-filter-btn.active {
    background: rgba(168, 85, 247, 0.18);
    border-color: rgba(168, 85, 247, 0.55);
    color: #e9d5ff;
  }
  .prof-filter-btn .pb-icon {
    width: 18px;
    height: 18px;
    object-fit: contain;
  }
  .prof-filter-btn .pb-caret {
    color: var(--text-muted);
    font-size: 11px;
  }

  .filter-select {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 11px;
    font-weight: 500;
    font-family: var(--font);
    border-radius: 6px;
    padding: 5px 8px;
    cursor: pointer;
    min-width: 130px;
    color-scheme: dark;
  }
  .filter-select option {
    background: #12131a;
    color: var(--text);
  }
  .filter-select:focus {
    border-color: var(--accent);
    outline: none;
  }

  .clear-filters-btn {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.25);
    color: #fca5a5;
    font-size: 10px;
    font-weight: 600;
    font-family: var(--font);
    border-radius: 6px;
    padding: 5px 10px;
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
    margin-left: auto;
  }
  .clear-filters-btn:hover {
    background: rgba(239, 68, 68, 0.18);
    color: #ef4444;
  }

  .date-range {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .filter-date {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 11px;
    font-family: var(--font);
    border-radius: 6px;
    padding: 4px 6px;
    cursor: pointer;
    color-scheme: dark;
  }
  .filter-date::-webkit-calendar-picker-indicator {
    filter: invert(0.8);
    cursor: pointer;
  }
  .date-sep {
    color: var(--text-muted);
    font-size: 11px;
  }

  .time-range {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .filter-time {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 11px;
    font-family: var(--font);
    border-radius: 6px;
    padding: 4px 6px;
    cursor: pointer;
    color-scheme: dark;
  }
  .filter-time:focus {
    border-color: var(--accent);
    outline: none;
  }

  /* Profession filter — modal drill-down (core → elite specs) */
  .prof-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }
  .prof-modal {
    background: #16171f;
    border: 1px solid var(--border);
    border-radius: 12px;
    width: min(440px, 100%);
    max-height: 80vh;
    overflow-y: auto;
    padding: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  }
  .prof-modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 12px;
  }
  .prof-modal-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
  }
  .prof-modal-title.sub {
    margin-bottom: 12px;
    color: var(--text-muted);
    font-weight: 600;
    font-size: 12px;
  }
  .prof-modal-close,
  .prof-modal-back {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-family: var(--font);
    padding: 5px 9px;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .prof-modal-close:hover,
  .prof-modal-back:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
  }
  .prof-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .prof-cell {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 8px;
    padding: 10px 12px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    font-family: var(--font);
    text-align: left;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .prof-cell:hover {
    background: rgba(168, 85, 247, 0.12);
    border-color: rgba(168, 85, 247, 0.4);
  }
  .prof-cell-icon {
    width: 40px;
    height: 40px;
    object-fit: contain;
    flex: none;
  }
  /* Core-profession icons (window 1) are a touch larger than elite specs. */
  .prof-grid-core .prof-cell-icon {
    width: 52px;
    height: 52px;
  }
  /* The "(Core)" cell atop window 2's spec list matches window 1 sizing. */
  .prof-cell-core .prof-cell-icon {
    width: 52px;
    height: 52px;
  }
  .prof-cell-name {
    flex: 1;
  }
  .prof-cell-arrow {
    color: var(--text-muted);
    font-size: 11px;
  }
  .prof-cell-check {
    color: #c084fc;
    font-size: 12px;
  }

  /* Removable chips */
  .filter-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 2px 0;
  }

  .filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    background: rgba(168, 85, 247, 0.08);
    border: 1px solid rgba(168, 85, 247, 0.2);
    border-radius: 6px;
    color: #c084fc;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  .filter-chip:hover {
    background: rgba(168, 85, 247, 0.15);
    border-color: rgba(168, 85, 247, 0.3);
  }
  .chip-x {
    font-size: 8px;
    opacity: 0.6;
  }
</style>
