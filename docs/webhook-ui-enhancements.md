# Webhook UI Enhancements — Implementation Plan

> Settings tab → Discord Webhooks section
> Current file: `src/routes/+page.svelte`
> Current styles: `src/app.css`

---

## What Users See Now

Each webhook is a card with:

```
┌─────────────────────────────────────────────────────────────────┐
│ [▼] [●] [Webhook Name..............] [Test] [⚡] [📋] [✕]     │  ← header
├─────────────────────────────────────────────────────────────────┤
│ Webhook link: [https://discord.com/api/webhooks/...] [📋]      │
│ [All] [Raids] [Strikes] [CM]                                    │  ← presets (new)
│ Ping Roles — named Discord role pings (optional)                │
│   [Name........] [Role ID........] [Add]                        │
│   • RaidLead <@&123456789>        [✎] [⧉] [🗑]                 │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ Routing filters                              [⚡ toggle] │     │
│ │ Type: [Raid ✓] [Strike] [Fractal] [Convergence] [Golem] │     │
│ │ Outcome: [Kill ✓] [Wipe]                                 │     │
│ │ Mode: [Any] [CM only] [LCM only]                         │     │
│ │ Boss: [...........................]                      │     │
│ └─────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

Collapsed state:
```
┌─────────────────────────────────────────────────────────────────┐
│ [▶] [●] Unnamed webhook  Thread · 2 pings · CM  [Test] [📋] [✕]│
└─────────────────────────────────────────────────────────────────┘
```

---

## Issues (Ranked by Severity)

| # | Severity | Issue | Impact |
|---|----------|-------|--------|
| 1 | 🔴 High | Delete with no confirmation | One tap destroys config, no recovery |
| 2 | 🔴 High | Enable "dot" toggle is meaningless at a glance | Users can't tell if webhook is on/off |
| 3 | 🔴 High | Filters hidden behind toggle | Core routing logic invisible on first use |
| 4 | 🔴 High | Collapsed metadata is unreadable concatenated string | Can't scan webhook list |
| 5 | 🟡 Medium | Test button sits in header (structural area) | Confusing context — testing is about URL |
| 6 | 🟡 Medium | Role add UI heavy for a rare action | Disproportionate UI complexity |
| 7 | 🟡 Medium | URL validation conflated with target type | "No link" reads like an error |
| 8 | 🟢 Low | URL field doesn't visually dominate | Most important field gets equal weight |
| 9 | 🟢 Low | No empty state guidance | New users don't know what's required |
| 10 | 🟢 Low | Presets feel bolted-on | Not integrated into design system |

---

## Implementation Plan

Phase order: easiest → most complex, with user-visible value at each step.

---

### Phase 1: Destructive Action Guard (Easy, High Value)

**Fix:** Delete webhook requires confirmation. Accidental taps are the #1 data-loss risk.

**Implementation:**
1. Add `pendingDeleteWh` state: `let pendingDeleteWh = $state<string | null>(null)`
2. Change delete button click: `onclick={() => { pendingDeleteWh = wh.id; }}`
3. Add a small confirm bar inside the card when `pendingDeleteWh === wh.id`:
   ```
   Delete this webhook? [Cancel] [Delete]
   ```
4. Confirm runs the existing filter logic; Cancel clears `pendingDeleteWh`

**Files:** `+page.svelte` (script section + header template)
**Effort:** Low
**Value:** Prevents all accidental data loss

---

### Phase 2: Move Test Button to Body (Easy, Clarity)

**Fix:** Test is a content action (it tests the URL), not a card-structural action.

**Implementation:**
1. Remove `wh-test` button from `wh-head-actions`
2. Add test button inside `wh-field-url`, next to the copy button:
   ```
   [Webhook link..............] [📋] [Test]
   ```
3. Keep existing `testWebhook(wh)` function unchanged

**Files:** `+page.svelte` (header + body template)
**Effort:** Low
**Value:** Clearer action hierarchy, test belongs with URL

---

### Phase 3: Better Enable Toggle (Easy, Clarity)

**Fix:** The "dot" communicates nothing. Replace with a labeled pill.

**Implementation:**
1. Replace `wh-toggle` button with a pill that shows "ON" / "OFF"
2. Color: green text + border when on, muted when off
3. Keep click handler identical
4. Add transition on state change

**CSS changes:**
```css
.wh-toggle {
  padding: 3px 8px;
  font-size: 9px;
  font-weight: 700;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  transition: all 0.15s ease;
}
.wh-toggle.on {
  color: #4ade80;
  border-color: #4ade80;
  background: rgba(74, 222, 128, 0.1);
}
.wh-toggle:not(.on) {
  color: var(--text-muted);
}
```

**Files:** `+page.svelte` (header), `app.css`
**Effort:** Low
**Value:** Instantly communicates on/off state

---

### Phase 4: Redesign Collapsed Summary (Medium, Scanability)

**Fix:** `Thread · 2 pings · CM` is an unreadable concatenated string.

**Implementation:**
1. Replace single `<span class="wh-collapsed-meta">` with individual chips:
   ```svelte
   <span class="wh-collapsed-chips">
     {#if wh.thread_id}<span class="wh-chip wh-chip-thread">Thread</span>{/if}
     {#if !wh.thread_id && wh.url?.trim()}<span class="wh-chip wh-chip-channel">Channel</span>{/if}
     {#if !wh.url?.trim()}<span class="wh-chip wh-chip-empty">No link</span>{/if}
     {#if wh.mention_roles?.length}<span class="wh-chip wh-chip-ping">{wh.mention_roles.length} ping{wh.mention_roles.length > 1 ? 's' : ''}</span>{/if}
     {#if wh.filters?.only_cm === true}<span class="wh-chip wh-chip-cm">CM</span>{/if}
     {#if wh.filters?.only_lcm === true}<span class="wh-chip wh-chip-lcm">LCM</span>{/if}
   </span>
   ```
2. Each chip has a subtle color/icon for quick visual parsing

**Files:** `+page.svelte` (header), `app.css`
**Effort:** Medium
**Value:** At-a-glance webhook identification

---

### Phase 5: Filters Always Visible (Medium, Discoverability)

**Fix:** Routing logic hidden behind a toggle. Users won't find it.

**Implementation:**
1. Remove the `wh-filters-btn` toggle from header
2. Filters section always renders when card is expanded
3. Keep the existing filter chip summary (Type/Outcome/Mode) as a compact header
4. Replace the filter section border with a lighter, collapsible subsection:
   - Default: show preset buttons + compact filter chip summary
   - "▸ More filters" link expands the full filter grid (Type/Outcome/Mode/Boss)
5. This makes presets the primary UI, advanced filters secondary

**Files:** `+page.svelte` (body template), `app.css`
**Effort:** Medium
**Value:** Filters are discoverable, presets are the default path

---

### Phase 6: Visual Hierarchy in Body (Low, Polish)

**Fix:** URL field doesn't dominate. All fields have equal weight.

**Implementation:**
1. Make the URL input larger (font-size: 12px → 13px, padding increase)
2. Add a subtle left border accent on the URL field
3. Ping Roles and Filters get slightly muted labels until hovered
4. Add a small "Required" badge next to Webhook link label
5. Add an empty-state hint when URL is empty: "Paste your Discord webhook URL here"

**Files:** `+page.svelte` (body), `app.css`
**Effort:** Low
**Value:** Eye goes to the most important field first

---

### Phase 7: Simplify Role UI (Medium, Proportionality)

**Fix:** Two inputs + Add button + 3 action buttons per role. Overkill for 0-1 roles typical.

**Implementation:**
1. Default: show "＋ Add ping role" link (not the full add form)
2. Clicking it expands inline into the two inputs + Add button
3. After adding, collapse back to link
4. Each role shows: name + token + ✕ (delete). Edit on click of the name itself.
5. Remove the separate edit form — edit inline on click

**Files:** `+page.svelte` (body), `app.css`, `lib.rs` (if `saveRoleEdit` needs changes)
**Effort:** Medium
**Value:** Less visual clutter for a rarely-used feature

---

### Phase 8: Delivery Status Indicator (Medium, Feedback)

**Fix:** Test button fires but leaves no trace in UI.

**Implementation:**
1. Add `_testStatus` to webhook state: `'idle' | 'sending' | 'ok' | 'err'`
2. Test button shows spinner while sending, then ✓ or ✗ badge next to it
3. Badge persists for 5 seconds, then fades
4. Badge uses same styling as the header chip (colored dot + text)

**Files:** `+page.svelte` (script + body), `app.css`
**Effort:** Medium
**Value:** User knows if their webhook actually works

---

## Summary — Implementation Order

| Phase | Change | Effort | Value | Cumulative |
|-------|--------|--------|-------|------------|
| 1 | Delete confirmation | Low | High | Safety net |
| 2 | Move Test to body | Low | Medium | Clearer hierarchy |
| 3 | Better enable toggle | Low | Medium | Clarity |
| 4 | Collapsed chips | Medium | High | Scanability |
| 5 | Filters always visible | Medium | High | Discoverability |
| 6 | Visual hierarchy | Low | Low | Polish |
| 7 | Simplify role UI | Medium | Medium | Proportionality |
| 8 | Delivery status | Medium | High | Feedback |

**Recommended execution:** Phases 1-3 first (quick wins, each independently shipable), then Phase 4-5 (the big UX improvements), then 6-7-8 (polish).

---

## Files Modified

| File | Change |
|------|--------|
| `src/routes/+page.svelte` | State vars, template restructure, confirm bar |
| `src/app.css` | Toggle pill, collapsed chips, visual hierarchy |

## Files NOT Modified

| File | Reason |
|------|--------|
| `src-tauri/src/lib.rs` | No backend logic changes needed |
| `src-tauri/src/uploader.rs` | No upload flow changes |
| `src/lib/webhook.ts` (if exists) | No webhook logic changes |

---

## Open Questions

- **Phase 1:** Confirm bar should be inside the card, or a global toast? Inside-card is more explicit.
- **Phase 5:** Should filters collapse independently of the card? (Card stays open but filters section collapses)
- **Phase 7:** Is the role list still needed, or can it be a simple comma-separated tag list?
- **Undo for delete:** Should we implement a full undo stack, or is a one-time confirmation sufficient?

---

*Plan written: 2026-09-18*
