# Old Lion's Court — Phase + Per-Boss HP Display Plan

## Goal
On a wipe, show **Phase [N]** and each active Watchknight's **HP Left** for
Old Lion's Court, similar to the existing Conjured Amalgamate / Twin Largos
breakdown cards.

## EI Investigation Findings
- EI already emits multi-target `healthPercentBurned` data in `ei["targets"]`.
- The app's existing multi-boss support (`CAArmBreakdown`, `TwinLargosBreakdown`,
  `EyeBreakdown`, `DragonHp`) follows a consistent pattern:
  - **Backend** (`src-tauri/src/ei_runner.rs`): find boss targets by name,
    compute `hp_left = max(0, 100 - healthPercentBurned)`, store in a typed
    breakdown struct on the `UploadRecord`.
  - **Frontend** (`src/routes/+page.svelte`): gate rendering on
    `log.<breakdown> && log.success === false`, then render per-boss chips
    with `Killed` when `hp_left <= 1.0`.

- Old Lion's Court is already recognized in the app's encounter metadata, but
  there is **no** `OldLionsCourtBreakdown` / equivalent struct and no UI.

## Data Model Changes
### Backend (`src-tauri/src/uploader.rs`)
Add a new breakdown struct:
```rust
pub struct OldLionsCourtBreakdown {
    pub vermilion_hp_left: Option<f64>,
    pub indigo_hp_left: Option<f64>,
    pub gold_hp_left: Option<f64>,
}
```
And add it to `UploadRecord`:
```rust
pub old_lions_court: Option<OldLionsCourtBreakdown>,
```

### Backend (`src-tauri/src/ei_runner.rs`)
Add detection logic alongside the existing CA/Twin Largos/Eye blocks:
- Scan `ei["targets"]` for Watchknight names.
- EI target names for the three Watchknights are expected to be:
  - `Prototype Vermilion`
  - `Prototype Indigo`
  - `Prototype Gold`
- For each found target, compute `hp_left = max(0, 100 - healthPercentBurned)`.
- Populate `record.old_lions_court = Some(OldLionsCourtBreakdown { ... })`.
- Use the same “engaged only” rule as Twin Largos: a target with
  `burned == 0` is `None`, so un-engaged Watchknights do not clutter the UI.

### Frontend Type Definitions (`src/routes/+page.svelte`)
Add an interface mirroring the Rust struct:
```ts
export interface OldLionsCourtBreakdown {
  vermilion_hp_left: number | null;
  indigo_hp_left: number | null;
  gold_hp_left: number | null;
}
```
Extend the log record type with:
```ts
old_lions_court?: OldLionsCourtBreakdown | null;
```

## Phase Tracking
- The wipe-phase label should come from `log.bosses_phases`.
- Reuse the existing phase machinery: `bosses_phases` is already populated
  from EI and rendered for Dragonvoid.
- For Old Lion's Court, derive the active phase at wipe by finding the last
  phase that was `reached` / not `cleared`, or by matching known phase keys
  (`vermilion`, `indigo`, `gold` / `prototypevermilion`, etc.).
- Display format: `Phase [N] — <phase name>` above the per-Watchknight HP rows.

## UI Design
### Placement
Add the Old Lion's Court breakdown inside the log card, in the same meta area
where the existing `boss_hp_left`, `twin_largos`, and `eyes` blocks live.

### Layout
```
Phase [2] — Prototype Indigo
  Vermilion  34.12% HP Left
  Indigo     Killed
  Gold      87.50% HP Left
```

### Styling
- Use the existing `.meta-item` pattern.
- Color:
  - Red for HP Left
  - Green for `Killed`
- Show phase header only when `log.bosses_phases` contains an Old Lion's
  Court phase and the log is a wipe (`success === false`).

### Conditional Rendering
```svelte
{#if log.old_lions_court && log.success === false}
  <div class="old-lions-court-breakdown">
    {#if activePhase}
      <div class="phase-header">Phase [{activePhase.index}] — {activePhase.name}</div>
    {/if}
    {#each watchknights as wk}
      <span class="meta-item">
        <i class="fa-solid fa-chess-rook"></i>
        {wk.name}
        {#if wk.hp_left <= 1.0}
          <span style="color:#4ade80; margin-left:6px;">Killed</span>
        {:else}
          <span style="color:#f87171; margin-left:6px;">{wk.hp_left.toFixed(2)}% HP Left</span>
        {/if}
      </span>
    {/each}
  </div>
{/if}
```

## Implementation Order
1. Backend: add `OldLionsCourtBreakdown` struct + field on `UploadRecord`.
2. Backend: add EI target parsing in `ei_runner.rs`.
3. Frontend: add `OldLionsCourtBreakdown` type and extend log typing.
4. Frontend: add phase derivation helper for Old Lion's Court.
## Status
DONE — implemented in backend + frontend.

## What was built
### Backend (`src-tauri/src/`)
- **`OldLionsCourtBreakdown`** struct in `uploader.rs` with:
  - `phase: Option<u32>` — wipe phase number (1-indexed)
  - `vermilion_hp_left`, `indigo_hp_left`, `gold_hp_left: Option<f64>`
- **`UploadRecord.old_lions_court`** field, serialized via `serde(default)`
- **EI parsing** in `ei_runner.rs::enrich_record_from_ei`:
  - Detects EI targets by exact names: `Prototype Vermilion`, `Prototype Indigo`, `Prototype Gold`
  - Phase derived from which Watchknight is engaged:
    - Vermilion present → Phase 1
    - Indigo present → Phase 2
    - Gold present → Phase 3
  - HP values from `healthPercentBurned` → `100 - burned`, clamped to `0..100`
  - Killed Watchknight (`burned >= 100`) → field set to `None` (matching CA/TwinLargos pattern)

### Frontend (`src/routes/+page.svelte`)
- **TypeScript interface** `LogRecord.old_lions_court` with `phase`, `vermilion_hp_left`, `indigo_hp_left`, `gold_hp_left`
- **UI block** in log card meta-line:
  - Only renders on wipe (`log.success === false`)
  - Shows `Phase [N]` header with `fa-tower-observation` icon
  - Per-Watchknight chips: `Killed` (green) or `X.XX% HP Left` (red)
  - Styling matches existing CA/TwinLargos/Eyes chips

### Files changed
- `src-tauri/src/uploader.rs` — struct, field, initializers
- `src-tauri/src/ei_runner.rs` — EI target parsing + phase derivation
- `src/routes/+page.svelte` — TS type + Svelte UI block

## Verification
- `npm run check` → 0 errors
- `npm run build` → passes
- `cd src-tauri && cargo check --release` → passes
- Confirm `bosses_phases` keys for Old Lion's Court so phase naming is stable.
