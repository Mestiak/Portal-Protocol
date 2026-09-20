# Notes Feature — Implementation Plan

> Card-level notes (add/edit/delete/search) with app-native styling

---

## Current State

- Notes are stored in `UploadRecord.notes[]` as `LogNote { id, text, created_at }`
- `notesPanel` snippet uses **all inline styles** — doesn't match app design system
- Button shows count via inline styled `<span>`, no visual highlight for "has notes"
- No timestamps visible
- No edit, no multiline, no search

---

## Phase 1: CSS Migration + App-Native Styling

**Goal:** Make notes panel look like it belongs in the app, not a bolt-on.

### Changes
1. Create CSS classes in `src/app.css`:
   - `.notes-section` — uses `.settings-card` aesthetic: `color-mix(in srgb, #ffffff 3%, #0f0f14)`, `border-radius: 12px`, subtle shadow
   - `.notes-title` — uses `var(--accent)` for icon + text, not hardcoded `#c084fc`
   - `.note-item` — uses `var(--border)`, `var(--text)`, `var(--bg-card)`
   - `.notes-input` — uses `var(--bg)`, `var(--border)`, `var(--text)`, `var(--text-muted)`
   - `.notes-count` — uses `.badge` class
2. Remove all `style=""` attributes from `notesPanel` snippet
3. Add animation: `transition: opacity 0.2s var(--ease-smooth), transform 0.2s var(--ease-smooth)`

### Files: `src/app.css`, `src/routes/+page.svelte`
### Effort: Low

---

## Phase 2: Highlight "Has Notes" Button ⭐

**Goal:** Logs with notes are instantly scannable.

### Changes
1. Add `.has-notes` class to the Notes button when `log.notes.length > 0`
2. Style:
   - Accent-colored border glow: `border-color: var(--accent)`
   - Subtle background: `color-mix(in srgb, var(--accent) 10%, transparent)`
   - Icon color: `var(--accent)` instead of default muted
3. Tooltip shows count: "Notes (3)"

### Files: `src/routes/+page.svelte`, `src/app.css`
### Effort: Low
### User value: **HIGH** — this is the explicit ask

---

## Phase 3: Timestamps + Inline Edit

**Goal:** Show when notes were written; allow quick edits.

### Changes
1. **Timestamps**
   - Add `{{note.created_at | relativeTime}}` filter ("2h ago", "Sep 18")
   - Use muted text, 10px, secondary to note text
2. **Inline Edit**
   - Click note text → replaces with `<input>` pre-filled with text
   - Enter or ✔ saves; Esc or ✕ cancels
   - Add `updated_at: Option<String>` to `LogNote` struct
   - Add `update_log_note` Rust command (lib.rs)

### Files: `src/routes/+page.svelte`, `src-tauri/src/uploader.rs`, `src-tauri/src/lib.rs`
### Effort: Medium

---

## Phase 4: Multiline Input + Confirm Delete

**Goal:** Longer notes; prevent accidental deletion.

### Changes
1. Replace `<input>` with `<textarea>` for note composition
   - Auto-resize on input (max-height: 120px)
   - Enter = new line; Ctrl+Enter = submit
2. Delete note → trigger `triggerCustomConfirm` (existing modal)
   - Title: "Delete Note"
   - Message: Note text preview (truncated to 80 chars)
3. Keyboard shortcut: `N` toggles notes panel for focused card

### Files: `src/routes/+page.svelte`, `src/app.css`
### Effort: Medium

---

## Phase 5: Notes Search + Cross-Tab Visibility

**Goal:** Find notes across all logs.

### Changes
1. Add notes term to search index (if search exists in app)
2. In Clears/Analytics: small note icon on logs that have notes
3. Filter: "Has Notes" toggle in filter bar

### Files: TBD based on existing search implementation
### Effort: Higher

---

## Execution Order

| Phase | What | Effort | Priority |
|-------|------|--------|----------|
| 1 | CSS migration + app-native styling | Low | Foundation |
| 2 | Highlight "has notes" button | Low | User request |
| 3 | Timestamps + inline edit | Medium | UX |
| 4 | Multiline + confirm delete | Medium | UX |
| 5 | Search + cross-tab | Higher | Nice-to-have |

**Recommended:** Do Phase 1 + Phase 2 together (both low effort, both visual), then Phase 3, then 4, then 5.

---

*Plan written: 2026-09-18*
