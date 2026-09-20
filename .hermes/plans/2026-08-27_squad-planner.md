# Squad Planner (Compositions) Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a new top-level "Squad Planner" tab where users build, save, and view GW2 squad compositions (subgroups of profession slots with role badges + optional player names + notes), with drag-and-drop slot swapping, persisted across restarts via `config.json`.

**Architecture:** A standalone planner (no log linkage, no real-player auto-assignment). Each slot = { professionId?, eliteSpecId?, roles: string[], playerName?: string }. Comps are stored as `squad_plans: SquadPlan[]` on `AppConfig`, hydrated/persisted exactly like the existing `sessions` field. UI: new Svelte modal component (`SquadPlannerModal.svelte`) + new tab content block in `+page.svelte` rendering a grid of `SquadPlanCard.svelte`. Role badges render as corner icons over the profession icon. **Drag-and-drop (CORE):** drag a filled square onto another square to swap their contents (incl. across subgroups). Tab named **"Squad Planner"** to avoid colliding with the existing Analytics "Squad Composition" chart.

**Tech Stack:** Svelte 5 (runes `$state`/`$derived`/`$effect`), Tauri v2 (`invoke("save_config")` / `read_config`), existing `professionData.ts` for profession + elite-spec icons, existing `persistConfig()` round-trip. Static assets in `static/boons/`.

---

## Scope decisions (locked with user)
- Standalone planner, **no** log/History linkage, **no** "planned vs actual" comparison.
- Each slot has an **optional free-text player name** (typed manually, not auto-suggested).
- Roles offered: `alac_heal`, `quick_heal`, `quick_dps`, `alac_dps`, `cele_quick_heal`, `cele_alac_heal`, `dps`, `portal`.
- **5 role icons exist in `static/boons/`** (verified); the rest are text chips:
  - Alac Heal → `static/boons/alacheal.png`
  - Quick Heal → `static/boons/quickheal.png` (currently `.jpg` — **rename to `.png`** in Task 1)
  - Quick DPS → `static/boons/quickness.png` (boon icon; user: "quick dps is in the boons folders")
  - Alac DPS → `static/boons/alacrity.png` (boon icon; user: "alac dps is in the boons folders")
  - Portal → auto from profession (Mesmer → `static/boons/mesmerportal.png`, Thief → `static/boons/thiefportal.png`); Mesmer/Thief slots may also be flagged `portal` explicitly.
  - Cele Quick Heal, Cele Alac Heal, Dps → **text chips** (no dedicated asset; user did not cite icons for these).
- "Wings/Strikes" at top = a **free-text encounter tag** on the plan (e.g. "Harvest Temple"), no registry picker.
- **Drag-and-drop is a core requirement** (user reiterated: swap "alac heal on Sub 1" → Sub 2 by dragging). Implemented in the modal via HTML5 DnD.
- **No patch-notes entry yet** — version/ship decided separately.

---

## Data model

```ts
export type SquadRole =
  | "dps" | "quick_dps" | "alac_dps"
  | "quick_heal" | "alac_heal"
  | "cele_quick_heal" | "cele_alac_heal"
  | "portal";

export interface SquadSlot {
  id: string;            // crypto.randomUUID()
  professionId?: number; // key into PROFESSIONS (1..9) — core
  eliteSpecId?: number;  // key into ELITE_SPEC_ICONS (0 = none)
  roles: SquadRole[];    // may be empty
  playerName?: string;   // optional free-text
}

export interface SquadSubgroup {
  id: string;            // crypto.randomUUID()
  slots: SquadSlot[];    // GW2 subgroup = 5 slots
}

export interface SquadPlan {
  id: string;            // crypto.randomUUID()
  name: string;          // "Squad 1" default, or custom / Raid-Strike name
  encounterTag?: string; // free-text "Wings/Strikes"
  subgroups: SquadSubgroup[];
  notes?: string;        // right-side notes on the card
  createdAt: number;
  updatedAt: number;
}
```

Rust mirror (config.rs) — `save_config` takes a typed `AppConfig`. Add parallel structs + field:

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SquadPlanSlot {
    pub id: String,
    #[serde(default)] pub profession_id: Option<u32>,
    #[serde(default)] pub elite_spec_id: Option<u32>,
    #[serde(default)] pub roles: Vec<String>,
    #[serde(default)] pub player_name: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SquadPlanSubgroup { pub id: String, pub slots: Vec<SquadPlanSlot> }
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SquadPlan {
    pub id: String,
    pub name: String,
    #[serde(default)] pub encounter_tag: Option<String>,
    pub subgroups: Vec<SquadPlanSubgroup>,
    #[serde(default)] pub notes: Option<String>,
    #[serde(default)] pub created_at: i64,
    #[serde(default)] pub updated_at: i64,
}
```
Add `pub squad_plans: Vec<SquadPlan>,` to `AppConfig` (after `gw2_accounts`, ~line 170) with `#[serde(default)]`.

---

## Files likely to change
- Create: `src/lib/squadPlanner.ts` (types + role-icon map + helpers)
- Create: `src/routes/SquadPlannerModal.svelte` (the builder modal + drag-and-drop)
- Create: `src/routes/SquadPlanCard.svelte` (grid card)
- Modify: `src/routes/+page.svelte` (nav buttons ×2, `activeTab` branch, hydration, persistConfig, saveConfig, `$effect` touch)
- Modify: `src/routes/+page.svelte` — CSS (append planner styles, or new `src/routes/squadPlanner.css`)
- Modify: `src-tauri/src/config.rs` (structs + `AppConfig.squad_plans` field)
- Asset: `static/boons/quickheal.jpg` → rename to `static/boons/quickheal.png`
- No patch-notes entry until user decides to ship a version for this feature.

---

## Task 1: Normalize the quick-heal asset
**Objective:** Make all five role icons `.png` so the icon map is uniform.
**Files:** Modify `static/boons/quickheal.jpg` → `static/boons/quickheal.png`
**Step 1:** Rename (git-aware):
```bash
cd /c/Users/Usuario/Desktop/gw2-log-uploader
git mv static/boons/quickheal.jpg static/boons/quickheal.png 2>/dev/null || mv static/boons/quickheal.jpg static/boons/quickheal.png
```
**Step 2:** Verify: `ls static/boons/quickheal.png` shows the file.
**Verification:** `ls static/boons/ | grep -E 'alacheal|quickheal|quickness|alacrity|mesmerportal|thiefportal'` shows all six.
**Step 3:** Commit.

---

## Task 2: Add Rust config structs + field
**Objective:** Persist squad plans through the existing `save_config`/`read_config` round-trip.
**Files:** Modify `src-tauri/src/config.rs:91` (near `SavedSession`) and `:170` (`AppConfig`).
**Step 1:** Insert the three `SquadPlan*` structs (code above) just before `pub struct AppConfig` (line 100).
**Step 2:** Add `pub squad_plans: Vec<SquadPlan>,` after line 170 (`gw2_accounts`) with `#[serde(default)]`.
**Step 3:** Verify compile from inside `src-tauri/`:
```bash
cd /c/Users/Usuario/Desktop/gw2-log-uploader/src-tauri && cargo check --release 2>&1 | tail -15
```
Expected: `Finished` with no errors (or only pre-existing unrelated warnings).
**Step 4:** Commit.

---

## Task 3: Create `src/lib/squadPlanner.ts` (types + role map + helpers)
**Objective:** Single source of truth for roles, icons, and slot helpers (DRY with `professionData.ts`).
**Files:** Create `src/lib/squadPlanner.ts`
**Step 1:** Write:
```ts
import { PROFESSIONS, ELITE_SPEC_ICONS } from "./professionData";

export type SquadRole =
  | "dps" | "quick_dps" | "alac_dps"
  | "quick_heal" | "alac_heal"
  | "cele_quick_heal" | "cele_alac_heal" | "portal";

export interface SquadSlot {
  id: string;
  professionId?: number;
  eliteSpecId?: number;
  roles: SquadRole[];
  playerName?: string;
}
export interface SquadSubgroup { id: string; slots: SquadSlot[]; }
export interface SquadPlan {
  id: string; name: string; encounterTag?: string;
  subgroups: SquadSubgroup[]; notes?: string;
  createdAt: number; updatedAt: number;
}

// Roles that have a real icon asset (verified in static/boons/). Others render as text chips.
export const ROLE_ICONS: Partial<Record<SquadRole, string>> = {
  alac_heal: "/boons/alacheal.png",
  quick_heal: "/boons/quickheal.png",
  quick_dps: "/boons/quickness.png",
  alac_dps: "/boons/alacrity.png",
  portal: "/boons/mesmerportal.png", // default portal icon; thief overrides below
};
export const ROLE_LABELS: Record<SquadRole, string> = {
  dps: "DPS", quick_dps: "Quick DPS", alac_dps: "Alac DPS",
  quick_heal: "Quick Heal", alac_heal: "Alac Heal",
  cele_quick_heal: "Cele Quick", cele_alac_heal: "Cele Alac", portal: "Portal",
};

// Profession-driven portal icon (Mesmer=7, Thief=5 per professionData.ts).
export function portalIconFor(professionId?: number): string {
  if (professionId === 7) return "/boons/mesmerportal.png";
  if (professionId === 5) return "/boons/thiefportal.png";
  return "/boons/mesmerportal.png";
}

export function slotIcon(slot: SquadSlot): string | undefined {
  if (slot.eliteSpecId && ELITE_SPEC_ICONS[slot.eliteSpecId]) return ELITE_SPEC_ICONS[slot.eliteSpecId];
  if (slot.professionId && PROFESSIONS[slot.professionId]) return PROFESSIONS[slot.professionId].icon;
  return undefined;
}
export function slotColor(slot: SquadSlot): string {
  return slot.professionId && PROFESSIONS[slot.professionId] ? PROFESSIONS[slot.professionId].color : "#3a3a4a";
}

// Corner badges for a slot: icon roles (alac/quick heal, quick/alac dps) + auto portal if Mesmer/Thief.
export function slotCornerBadges(slot: SquadSlot): { src: string; title: string }[] {
  const out: { src: string; title: string }[] = [];
  if (slot.roles.includes("alac_heal")) out.push({ src: ROLE_ICONS.alac_heal!, title: "Alac Heal" });
  if (slot.roles.includes("quick_heal")) out.push({ src: ROLE_ICONS.quick_heal!, title: "Quick Heal" });
  if (slot.roles.includes("quick_dps")) out.push({ src: ROLE_ICONS.quick_dps!, title: "Quick DPS" });
  if (slot.roles.includes("alac_dps")) out.push({ src: ROLE_ICONS.alac_dps!, title: "Alac DPS" });
  if (slot.roles.includes("portal") || slot.professionId === 7 || slot.professionId === 5)
    out.push({ src: portalIconFor(slot.professionId), title: "Portal" });
  return out;
}

export function newSlot(): SquadSlot { return { id: crypto.randomUUID(), roles: [] }; }
export function newSubgroup(): SquadSubgroup { return { id: crypto.randomUUID(), slots: Array.from({ length: 5 }, newSlot) }; }
export function newPlan(name = "Squad 1"): SquadPlan {
  const now = Date.now();
  return { id: crypto.randomUUID(), name, subgroups: [newSubgroup()], createdAt: now, updatedAt: now };
}

// Swap two slots by id (used by drag-and-drop). Returns new subgroup array.
export function swapSlots(sg: SquadSubgroup, aId: string, bId: string): SquadSubgroup {
  const slots = sg.slots.slice();
  const ia = slots.findIndex(s => s.id === aId);
  const ib = slots.findIndex(s => s.id === bId);
  if (ia < 0 || ib < 0) return sg;
  [slots[ia], slots[ib]] = [slots[ib], slots[ia]];
  return { ...sg, slots };
}

// Boon-coverage sanity check (cheap, high-value). Returns warnings for the card footer.
export function planWarnings(plan: SquadPlan): string[] {
  const w: string[] = [];
  const all = plan.subgroups.flatMap(g => g.slots);
  const filled = all.filter(s => s.professionId);
  const hasQuick = filled.some(s => s.roles.includes("quick_heal") || s.roles.includes("quick_dps"));
  const hasAlac = filled.some(s => s.roles.includes("alac_heal") || s.roles.includes("alac_dps"));
  const hasHeal = filled.some(s => s.roles.includes("quick_heal") || s.roles.includes("alac_heal") || s.roles.includes("cele_quick_heal") || s.roles.includes("cele_alac_heal"));
  const hasPortal = filled.some(s => s.professionId === 7 || s.professionId === 5 || s.roles.includes("portal"));
  if (!hasQuick) w.push("⚠ No Quickness provider");
  if (!hasAlac) w.push("⚠ No Alacrity provider");
  if (!hasHeal) w.push("⚠ No healer");
  if (!hasPortal) w.push("⚠ No portal (Mesmer/Thief)");
  return w;
}
```
**Step 2:** Verify types within the Svelte build later (`npm run check` after Task 5). No standalone run needed.
**Step 3:** Commit.

---

## Task 4: Build `SquadPlannerModal.svelte` (the interactive builder + drag-and-drop)
**Objective:** The "super interactive" creation/edit modal — top name + encounter tag, subgroup rows of 5 squares, "+" to add subgroup, click empty square → two-step profession picker (reuse `professionData.ts`), role toggle chips, optional player-name input, delete slot/subgroup, **drag a square onto another to swap**, Save/Cancel.
**Files:** Create `src/routes/SquadPlannerModal.svelte`
**Props/events:**
```svelte
<script lang="ts">
  import { PROFESSIONS, ELITE_SPEC_ICONS } from "../lib/professionData";
  import { type SquadPlan, type SquadSlot, type SquadRole, ROLE_LABELS, slotIcon, slotColor, slotCornerBadges, newSubgroup, newSlot, swapSlots } from "../lib/squadPlanner";
  let { plan = $bindable(), onSave, onCancel }: {
    plan: SquadPlan; onSave: (p: SquadPlan) => void; onCancel: () => void;
  } = $props();
  let dragSrc: { sg: number; slot: string } | null = null; // subgroup index + slot id
</script>
```
**Layout (markup skeleton):**
- Header: `<input bind:value={plan.name}>` + `<input bind:value={plan.encounterTag} placeholder="Raid / Strike / Custom">`
- Body: `{#each plan.subgroups as sg, gi}` → subgroup header "Subgroup {gi+1}" + delete btn + grid of 5 squares:
  - each square:
    - if empty → `+` plus a faint profession picker trigger;
    - if filled → `<img src={slotIcon(slot)}>` tinted `slotColor`, corner badges (`slotCornerBadges`), player name input (`bind:value={slot.playerName}`), role chips row (`ROLE_LABELS` keys; toggle into `slot.roles`), and a clear (✕) button.
    - **`draggable={!!slot.professionId}`** on the filled square; `ondragstart` stores `dragSrc = { sg: gi, slot: slot.id }`; `ondragover` calls `event.preventDefault()` to allow drop; `ondrop` → swap:
      ```ts
      function onDrop(targetSg: number, targetSlotId: string) {
        if (!dragSrc) return;
        const a = plan.subgroups[dragSrc.sg];
        const b = plan.subgroups[targetSg];
        if (dragSrc.sg === targetSg) {
          plan.subgroups[dragSrc.sg] = swapSlots(a, dragSrc.slot, targetSlotId);
        } else {
          // move slot object from a to b (replace target), and put target's old slot into a's source position
          const aSlots = a.slots.slice(); const bSlots = b.slots.slice();
          const ia = aSlots.findIndex(s => s.id === dragSrc!.slot);
          const ib = bSlots.findIndex(s => s.id === targetSlotId);
          const moving = aSlots[ia]; const replaced = bSlots[ib];
          aSlots[ia] = replaced; bSlots[ib] = moving;
          plan.subgroups[dragSrc.sg] = { ...a, slots: aSlots };
          plan.subgroups[targetSg] = { ...b, slots: bSlots };
        }
        dragSrc = null; plan.updatedAt = Date.now();
      }
      ```
    - profession picker: two-step — first pick core (9 `PROFESSIONS` buttons), then optional elite-spec dropdown (`ELITE_SPEC_ICONS` filtered by profession). On pick, set `slot.professionId` / `slot.eliteSpecId` and auto-append `portal` role if Mesmer/Thief (visual handled by `slotCornerBadges` anyway).
- Footer: "+ Add Subgroup" (`plan.subgroups = [...plan.subgroups, newSubgroup()]`) · Save (`plan.updatedAt = Date.now(); onSave(plan)`) · Cancel.
**Interactivity (the "great UI" part):** modal-centered (mirror `pickerModal` in +page.svelte lines 800–841), focus trap, Esc to cancel, click-backdrop to cancel, animated open (reuse `transition:fade`/`scale` like other modals). Square hover shows picker; selecting a role toggles a visible chip. **Drag-and-drop swap (CORE):** dragging "alac heal on Sub 1" onto an empty/occupied square in Sub 2 swaps their contents across subgroups; drop is only accepted on squares (`preventDefault` on `dragover`). Subgroup-header drag to reorder subgroups is a nice follow-up (not required v1). Keep it CSS-themed (no un-themed default button — class `prof-filter-btn` style already exists per memory).
**Step 1–2:** Write the component with above structure + CSS.
**Step 3:** Verify via `npm run check` (after Task 5 wires import) — expected 0 errors.
**Step 4:** Commit.

---

## Task 5: Build `SquadPlanCard.svelte` (grid card)
**Objective:** Read-only (but editable-on-click) card rendering one plan: name + encounter tag, subgroup grid (compact 5-squares), notes panel on the right, boon-coverage warnings footer, Open/Edit + Delete + Duplicate actions.
**Files:** Create `src/routes/SquadPlanCard.svelte`
**Props:** `let { plan, onEdit, onDelete, onDuplicate } = $props();`
**Layout:** left = subgroup grid (reuse `slotIcon`/`slotColor`/`slotCornerBadges` + text chips for non-icon roles + player name under each square); right column = `<textarea bind:value={plan.notes}>` (autosave on blur via `onEdit`); footer = `planWarnings(plan).map(...)`; header actions = Edit (opens modal), Duplicate (`onDuplicate`), Delete (with confirm).
**Step 1–2:** Write component + CSS.
**Step 3:** commit.

---

## Task 6: Wire tab into `+page.svelte` (nav + state + render)
**Objective:** Add "Squad Planner" to both nav surfaces, a `squadPlans` `$state`, the `activeTab === "squad"` branch rendering a Create button + grid of `SquadPlanCard`, and the create/edit modal.
**Files:** Modify `src/routes/+page.svelte`
**Step 6a — state (near `sessions` declaration, ~line 850+):**
```ts
import SquadPlannerModal from "./SquadPlannerModal.svelte";
import SquadPlanCard from "./SquadPlanCard.svelte";
import { type SquadPlan, newPlan } from "../lib/squadPlanner";
let squadPlans = $state<SquadPlan[]>([]);
let editingPlan = $state<SquadPlan | null>(null);   // null = closed
let creatingPlan = $state(false);
```
**Step 6b — hydration** (in `loadConfig`, after `sessions = ...` line 4506):
```ts
squadPlans = (config.squad_plans ?? []).map((p: any) => ({ ...p, subgroups: p.subgroups ?? [{ id: crypto.randomUUID(), slots: Array.from({length:5},()=>({id:crypto.randomUUID(),roles:[]})) }] }));
```
**Step 6c — nav buttons** (top pills after History line 5516, sidebar after History line 5616): add
```svelte
<button class="tb-tab {activeTab === 'squad' ? 'active' : ''}" onclick={() => activeTab = 'squad'}>
  <i class="fa-solid fa-users"></i><span>Planner</span>
</button>
```
and sidebar equivalent `<button class="nav-btn ..."><span class="nav-icon"><i class="fa-solid fa-users"></i></span> Squad Planner</button>`.
**Step 6d — render branch** (after `{:else if activeTab === "history"}` block ~line 6120):
```svelte
{:else if activeTab === "squad"}
  <div class="squad-planner-view">
    <div class="squad-planner-header">
      <h2>Squad Planner</h2>
      <button class="prof-filter-btn" onclick={() => { editingPlan = newPlan(); creatingPlan = true; }}>＋ New Composition</button>
    </div>
    {#if squadPlans.length === 0}
      <div class="empty-hint">No compositions yet. Click “New Composition” to build your first squad.</div>
    {:else}
      <div class="squad-grid">
        {#each squadPlans as plan (plan.id)}
          <SquadPlanCard {plan}
            onEdit={() => { editingPlan = structuredClone(plan); creatingPlan = false; }}
            onDuplicate={() => duplicatePlan(plan)}
            onDelete={() => deletePlan(plan.id)} />
        {/each}
      </div>
    {/if}
  </div>
{/if}
```
**Step 6e — modal mount** (near other modal mounts, e.g. after `pickerModal` usage):
```svelte
{#if editingPlan}
  <SquadPlannerModal
    plan={editingPlan}
    onSave={(p) => savePlan(p)}
    onCancel={() => { editingPlan = null; creatingPlan = false; }} />
{/if}
```
**Step 6f — handlers** (near `persistConfig`):
```ts
function savePlan(p: SquadPlan) {
  const i = squadPlans.findIndex(x => x.id === p.id);
  if (i >= 0) squadPlans[i] = p; else squadPlans = [...squadPlans, p];
  editingPlan = null; creatingPlan = false;
  persistConfig();
}
function deletePlan(id: string) { squadPlans = squadPlans.filter(x => x.id !== id); persistConfig(); }
function duplicatePlan(p: SquadPlan) {
  const c = structuredClone(p); c.id = crypto.randomUUID(); c.name = p.name + " (copy)"; c.createdAt = c.updatedAt = Date.now();
  squadPlans = [...squadPlans, c]; persistConfig();
}
```
**Step 6g — persistConfig** (line 4141 block): add `squad_plans: $state.snapshot(squadPlans),` to the `save_config` payload (near `sessions`).
**Step 6h — saveConfig** (line 4543 block): add `squad_plans: $state.snapshot(squadPlans),` to the explicit Save payload.
**Step 6i — autosave `$effect`** (line 4522): add `JSON.stringify(squadPlans);` to the touch list so edits autosave.
**Step 1–9:** apply edits.
**Step 10:** Verify: `npm run check 2>&1 | tail -4` → 0 errors/0 warnings; `npm run build 2>&1 | tail -5` → clean.
**Step 11:** commit.

---

## Task 7: CSS theme pass
**Objective:** Ensure planner UI is CSS-themed (no default-styled controls per memory) + responsive + matches app tokens.
**Files:** Modify `src/routes/+page.svelte` (append `<style>` rules) or new `src/routes/squadPlanner.css` imported in both new components.
**Rules needed:** `.squad-planner-view`, `.squad-grid` (responsive `grid-template-columns: repeat(auto-fill, minmax(360px,1fr))`), `.squad-plan-card`, `.slot-square` (square aspect, rounded, profession-tinted border, `draggable` cursor `grab`), `.slot-square.drag-over` (highlight drop target), `.slot-badges` (absolute bottom-right stack), `.role-chip` (active/inactive states), `.prof-picker` (two-step grid), `.squad-notes` textarea. Use `var(--accent)`, `var(--border)`, `var(--text-muted)`. Square must keep `aspect-ratio: 1 / 1`.
**Step 1:** write CSS.
**Step 2:** `npm run check && npm run build` clean.
**Step 3:** commit.

---

## Task 8: Live native-window test + verification
**Objective:** Manual verification in the running Tauri app (user preference: live native-window testing).
**Files:** n/a (runtime)
**Step 1:** `npm run tauri dev` (free port 1420 first if stuck: `fuser -k 1420/tcp` or per memory).
**Step 2:** In app: open Squad Planner tab → New Composition → set name + encounter tag → fill subgroup 1 squares (pick professions, toggle roles, type player names) → add a 2nd subgroup → Save. Confirm card appears with correct icons/badges/notes + boon warnings.
**Step 3:** **Drag-and-drop:** drag the "alac heal" slot from Subgroup 1 onto an empty square in Subgroup 2; confirm the two slots swap (profession + role + player name move together).
**Step 4:** Reload app → confirm plan persisted (config.json `squad_plans` present). Edit + Duplicate + Delete.
**Step 5:** Mesmer slot auto-shows portal icon; Thief too; manual `portal` role also shows it. Quick DPS → quickness.png, Alac DPS → alacrity.png.
**Step 6:** report any visual/UX bug to user (transient vs persistent verdict).

---

## Tests / validation
- `cargo check --release` (from `src-tauri/`) after Task 2 — config compiles.
- `npm run check` + `npm run build` after Tasks 5–7 — 0 errors.
- Live `npm run tauri dev` Task 8 — functional + persistence + drag-and-drop.

## Risks / tradeoffs
- **5 role icons now exist** (alacheal, quickheal, quickness, alacrity, portals). Cele Quick/Alac Heal and Dps remain text chips (no asset, user didn't cite icons). If user later wants icons for all, add assets + extend `ROLE_ICONS`.
- **Square grid fixed at 5 per subgroup** (GW2 standard). Not user-resizable — matches request ("Squad slots … + sign to create more sub groups", implying subgroup count grows, slot count fixed at 5).
- **Drag-and-drop is CORE** (user reiterated swapping alac-heal Sub1→Sub2 by drag). Implemented via HTML5 DnD in the modal; cards may also enable it as a convenience follow-up.
- **quickheal.jpg→.png rename** is safe (asset only referenced after this feature). Confirm no other code references `quickheal.jpg`.

## Open questions (answered)
- Tab name: **Squad Planner** (avoid "Squad Composition" collision with Analytics chart). ✓
- Log linkage: none. ✓
- Player names: optional free-text. ✓
- Role icons: 5 from `static/boons/` (incl. quickness/alacrity for quick/alac dps). ✓
- Drag-and-drop: core, swap slots across subgroups. ✓
- Patch notes: none yet. ✓
