# Squad Planner v2 — Folder-style comps + bug fix + MA-style cards

Date: 2026-08-28
Scope: `src-tauri/src/config.rs`, `src/lib/squadPlanner.ts`, `src/routes/+page.svelte`,
`src/routes/SquadPlanCard.svelte`, `src/routes/SquadPlannerModal.svelte`, `src/app.css`,
new `src/lib/encounterData.ts`, new `src/routes/SquadPlanInside.svelte` (or inline view).

## 0. CRITICAL BUG FIX (do first — gates everything else)
**Profession icons / player names do NOT persist across restart; roles+portals do.**

Root cause: field-name mismatch between Rust `SquadPlanSlot` (snake_case, no rename attr)
and the TS model (camelCase). On save, `$state.snapshot()` emits `professionId`, but Rust
expects `profession_id` → reads `null` → icon dropped. (Roles survive: identical key `roles`.
Portal survives because modal re-derives the portal icon from the `roles` array at render.)

Fix in `src-tauri/src/config.rs`:
- Add `#[serde(rename_all = "camelCase")]` to `SquadPlanSlot`, `SquadPlanSubgroup`, `SquadPlan`.
  (This makes on-disk JSON use camelCase to match the TS model — correct, sustained fix,
  not a data-destroying workaround.)
- `cargo check --release` from INSIDE `src-tauri/`.

## 1. Remove Notes section
- `SquadPlanCard.svelte`: delete `.squad-card-notes` block + `<textarea>` + `saveNotes()`.
  Also remove now-unused ` slotIcon` import if it becomes unused (keep `slotIcon` for the
  square, it's still used). Remove the notes CSS block + the `@media (max-width:560px)` notes rule.
- `SquadPlan`/`SquadPlanSlot`: keep `notes?` on the TS type (Rust already has it) but stop
  editing it. (Leave field in struct; harmless. Optional: remove both — but that's churn; keep.)
- Top-level `+page.svelte` squad render branch: remove the Notes sub-panel (currently none in
  card; the modal has no notes field either, so only the card needs the trim).

## 2. Banner / thumbnail (MA-style card) — like photo 3
Add to `SquadPlan`:
- `banner?: string` — URL/path to a banner image (static asset OR uploaded file OR a preset).
- `subtitle?: string` — the "sub text" line under the title (e.g. "Track players caught in…").
- `accent?: string` — optional accent color for the banner overlay (default to `--accent`).

Banner sources (v1 — keep simple):
- A small set of bundled presets in `static/banners/` (drop a few GW2-ish placeholder images,
  e.g. a generic raid background). User picks from a preset grid in the creator.
- OR a "paste image URL" field (manual). Skip file-upload for v1 (Tauri dialog is more work;
  can add later).
- If no banner chosen → render a tasteful default gradient banner (CSS) so the card still
  looks like photo 3.

Card layout change (`SquadPlanCard.svelte`):
- Top: a banner strip (~120px tall, rounded top) with the raid-wing chip ("RAID WING 4"),
  an Active/dot indicator, the big serif title (`plan.name`), and the subtitle (`plan.subtitle`).
- Below banner: the existing subgroups/squares grid.
- Banner uses `<img>` if `plan.banner` set, else CSS gradient.

## 3. Wing / Strike + boss selector in the creator (photo 3 style)
New `src/lib/encounterData.ts`:
- `export const WINGS: { id: string; label: string; bosses: { id: string; name: string; img?: string }[] }[]`
  covering all GW2 raid wings (1–7) + Strike missions (IBS + EoD + SotO + Janthir).
  (Populate from known GW2 raid/boss list; bosses get `img` later — v1 can use a generic
  icon or the wing's color. We can reuse existing boss-icon assets if any exist in `static/`.)
- In `SquadPlannerModal.svelte` header: add a "Wing / Strike" `<select>` and a dependent
  "Boss" `<select>`. Selecting a boss sets `plan.encounterTag = boss.name` and optionally
  `plan.banner = boss.img` (if we have one) + `plan.subtitle` default.
- Add a "Banner" picker (preset grid + URL field) and a "Subtitle" text input in the modal
  header area (next to name/encounterTag).

## 4. Folder behavior — click card → open inside (nested compositions)
DECISION (2026-08-28): **Two-level auto.**
- Top-level "New Composition" creates a FOLDER: name + wing/boss selector + banner + subtitle,
  NO professions section.
- Inside a folder, "New Composition" creates a ROSTER: name + subgroups + professions (+ account
  names). Rosters are leaves (clicking a roster card opens its editor, not a deeper folder).
- A folder with zero children still renders as a folder card (drill-in shows empty state +
  "New Composition" to add rosters).
- Folder's own edit (pencil) = folder settings (rename/banner/subtitle/delete), NOT roster editor.
Data model:
- Add `children?: SquadPlan[]` to `SquadPlan` (TS + Rust `Vec<SquadPlan>` with
  `#[serde(default)]`).
- Top-level `squadPlans` stays the root list. A card with `children.length > 0` is a folder.

Navigation (in `+page.svelte`):
- Add `let squadFolderStack = $state<SquadPlan[]>([])` (breadcrumb path of opened folders).
- The squad render branch shows `currentLevel = squadFolderStack.length ? squadFolderStack[squadFolderStack.length-1].children! : squadPlans`.
- Clicking a card with children (NOT edit/duplicate/delete buttons) pushes it onto the stack
  → view switches to its `children`. A breadcrumb bar ("Squad Planner / Wing 4 Cairn") with a
  back button pops the stack.
- Inside a folder, "New Composition" creates a child (a roster: name + subgroups + professions).
  The modal's `onSave` must write to the correct level (root vs inside folder).

Editing model:
- Edit within a folder: clicking a child card's edit opens the modal for that child.
- The folder card itself is edited via its own edit (banner/subtitle/children management).
  Keep it simple: folder card edit opens the SAME modal but the modal hides the
  subgroup/profession UI when editing a pure folder? That's complex. SIMPLER v1:
  - Folder card: clicking the card body (not buttons) → drill in.
  - Folder card edit (pencil) → opens a lightweight "Folder settings" inline (rename + banner +
    subtitle + delete-folder). We can reuse the modal with a `mode: "folder" | "roster"` prop.
- Persistence: `savePlan` must locate the plan by id across the nested tree (root + any
  folder's children) and replace in place; `duplicatePlan`/`deletePlan` likewise tree-aware.
  Add `findPlan(list, id)` / `upsertPlan(list, plan)` / `removePlan(list, id)` helpers in
  `squadPlanner.ts` that recurse through `children`.

## 5. Account-name / player field on slots (photo 2)
- `SquadSlot` already has `playerName?: string` (persisted once #0 fix lands).
- In `SquadPlannerModal.svelte`: for each filled slot, show a small text input "Player / account
  name" bound to `slot.playerName` (auto-save on change). Display on the card square
  (already rendered as `.slot-player` / `.cc-player`).
- "If we have logs with that account name": v1 just free-text the name. Auto-matching against
  uploaded logs (by `playerName`/`account`) is a future enhancement — note it in the plan,
  don't build now unless you want it.

## Verification
- `cargo check --release` (inside src-tauri) — after config.rs rename change.
- `npm run check` → 0 errors / 0 warnings.
- `npm run build` → clean.
- Live `npm run tauri dev`:
  1. Create a comp with a profession + role + player name → Save → RESTART app → confirm
     profession icon + player name persist (the #0 bug is fixed).
  2. Remove Notes → confirm gone.
  3. Banner + subtitle + wing/boss selector → confirm card shows MA-style banner.
  4. Create a folder comp (no professions, just name+banner) → click it → drill into children
     → create a roster inside → back out → confirm nesting persists across restart.
  5. Account-name field shows on slot + card.

## Notes / non-goals (v1)
- No file-upload for banners (URL + presets only).
- No auto-link to uploaded logs by account name (manual text only).
- Folder "mode" edit is lightweight (rename/banner/subtitle/delete), not full roster editor.
