# +page.svelte Splitting Plan

## Current State

| Metric | Value |
|--------|-------|
| Total lines | 8,207 |
| Functions | ~207 |
| Tabs | 6 (Feed, History, Folders, Analytics, Settings, Planner) |
| Modals | ~8 (Stats, Replay, VL, Accent Picker, Confirm, etc.) |
| CSS components | ~15 reusable pieces identified |

## Target Structure

```
src/routes/
├── +page.svelte                    # Shell: tab routing + shared state only (~800 lines)
├── components/
│   ├── tabs/
│   │   ├── FeedTab.svelte          # Uploads Feed
│   │   ├── HistoryTab.svelte       # History Log
│   │   ├── FoldersTab.svelte       # Folders / Sessions
│   │   ├── AnalyticsTab.svelte     # Analytics Dashboard wrapper
│   │   ├── SettingsTab.svelte      # Settings panels
│   │   └── PlannerTab.svelte       # Squad Planner wrapper
│   ├── cards/
│   │   ├── LogCard.svelte          # Individual log card (in Feed/History)
│   │   └── FolderCard.svelte       # Folder card in Folders tab
│   ├── toolbars/
│   │   ├── FilterBar.svelte        # Search + Filters
│   │   └── CopyToolbar.svelte      # Multi-select actions
│   ├── badges/
│   │   ├── ModeBadge.svelte        # CM / LCM / Normal
│   │   ├── StatusBadge.svelte      # Uploading / Completed / Failed
│   │   └── AhrBadge.svelte         # AHR (After Health Regeneration)
│   └── modals/
│       ├── ConfirmModal.svelte     # Generic confirm dialog
│       ├── StatsModal.svelte       # Log stats viewer
│       ├── ReplayModal.svelte      # 2D Replay viewer
│       ├── VLModal.svelte          # VL Rank picker
│       └── AccentPickerModal.svelte
```

## Extraction Priority

### Phase 1: Standalone Components (Low Risk)
These are self-contained with clear inputs/outputs.

| Component | Lines | Dependencies |
|-----------|-------|--------------|
| `ConfirmModal.svelte` | ~60 | `title`, `message`, `onConfirm` |
| `FilterBar.svelte` | ~150 | `bosses`, `vlRanks`, `professions` |
| `CopyToolbar.svelte` | ~80 | `selectedLogs`, `logs` |

### Phase 2: Badge Components (Low-Medium Risk)

| Component | Lines | Dependencies |
|-----------|-------|--------------|
| `ModeBadge.svelte` | ~40 | `is_cm`, `is_lcm` |
| `StatusBadge.svelte` | ~40 | `status` |
| `AhrBadge.svelte` | ~30 | `ura_health_regen` |

### Phase 3: Card Components (Medium Risk)

| Component | Lines | Dependencies |
|-----------|-------|--------------|
| `LogCard.svelte` | ~400 | `log`, `isExpanded`, `isSelected` |
| `FolderCard.svelte` | ~200 | `session`, `active` |

### Phase 4: Tab Components (Higher Risk)

| Component | Lines | Dependencies |
|-----------|-------|--------------|
| `FeedTab.svelte` | ~600 | Feed state + uploads |
| `HistoryTab.svelte` | ~500 | History state + filters |
| `FoldersTab.svelte` | ~700 | Sessions + subfolders |
| `SettingsTab.svelte` | ~1200 | All settings state |
| `AnalyticsTab.svelte` | ~100 | Wrapper around AnalyticsDashboard |
| `PlannerTab.svelte` | ~100 | Wrapper around SquadPlanner |

### Phase 5: Modal Components (Medium Risk)

| Component | Lines | Dependencies |
|-----------|-------|--------------|
| `StatsModal.svelte` | ~200 | `log` data |
| `ReplayModal.svelte` | ~150 | `url` |
| `VLModal.svelte` | ~200 | `log`, `vlRanks` |
| `AccentPickerModal.svelte` | ~250 | `accent`, `onSave` |

## Data Flow Pattern

```svelte
<!-- Parent: +page.svelte -->
<script>
  import FeedTab from './components/tabs/FeedTab.svelte';
  let feedState = $state(uploadState);
</script>

<FeedTab bind:state={feedState} />

<!-- Child: FeedTab.svelte -->
<script>
  let { state = $bindable() } = $props();
</script>
```

## Migration Steps

1. **Create directory structure** under `src/routes/components/`
2. **Extract Phase 1 components** (modals, toolbars, filters)
3. **Verify** app still works after each extraction
4. **Extract Phase 2-3** (badges, cards)
5. **Verify** again
6. **Extract Phase 4** (tabs) — biggest change
7. **Thorough testing** of all tabs
8. **Extract Phase 5** (remaining modals)

## Estimated Effort

| Phase | Components | Time |
|-------|------------|------|
| 1 | 3 | ~2 hours |
| 2 | 3 | ~1 hour |
| 3 | 2 | ~3 hours |
| 4 | 6 | ~6 hours |
| 5 | 4 | ~2 hours |
| **Total** | **18** | **~14 hours** |

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing functionality | Extract one component at a time, test after each |
| Losing state bindings | Use `$bindable()` for two-way binding |
| Breaking reactivity | Keep `$derived` chains intact during extraction |
| Scope creep | Follow phases strictly, no new features |

## Benefits After Completion

| Benefit | Description |
|---------|-------------|
| Faster navigation | Find code in 200-line files instead of 8,000 |
| Safer changes | Edit one tab without affecting others |
| Reuse | Use LogCard in both Feed and History |
| Onboarding | Easier for collaborators to understand |
| Testing | Can test components in isolation |

## When to Execute

- After current feature work is stable
- When adding a new feature that would add >200 lines
- When multiple people start working on the codebase
- Before v1.0 release

---

## History Performance & Smoothness Ideas

### Already Implemented
| Idea | Status |
|------|--------|
| `$state.raw()` for `allHistory` | ✅ Done — eliminates proxy overhead |

### Future Improvements

| Priority | Idea | Description | Impact |
|----------|------|-------------|--------|
| **1** | Virtual scrolling | Only render visible cards (~15-20) instead of all 25 in a page. Cards outside viewport are recycled. | High |
| **2** | Lazy-load players array | Store `num_players` in history, fetch full player data only when expanding a log. | Medium |
| **3** | Debounced search | Wait 150ms after user stops typing before filtering, avoiding filter on every keystroke. | Low |
| **4** | Web Worker for filtering | Offload filter logic to a Web Worker so UI never freezes on large datasets. | Medium |
| **5** | IndexedDB for history | Store history in IndexedDB instead of loading all into RAM. Load pages on demand. | High |
| **6** | Rust-side pre-filtering | Send filter criteria to Rust, return only matching records. Reduces data transfer. | Medium |
| **7** | Memoized filter results | Cache filter results for common queries (e.g., "Failed", "CM"). | Low |
| **8** | Reduce inline styles | 78 large inline styles in +page.svelte add parsing overhead. Move to CSS classes. | Low |
| **9** | Batch DOM updates | Instead of `allHistory = [...allHistory]` on every status change, batch updates with `requestAnimationFrame`. | Medium |
| **10** | Separate frozen data from UI state | Keep `allHistory` as raw data, have separate reactive state for expanded/selected states only. | Medium |

### Recommended Order
1. Virtual scrolling (biggest UI smoothness improvement)
2. Lazy-load players (reduces per-record memory)
3. Debounced search (instant-feeling filters)
4. Batch DOM updates (smoother log status updates)
5. Others as needed based on testing
