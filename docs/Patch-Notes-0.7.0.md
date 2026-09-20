# Patch Notes — v0.7.0

> Release date: 2026-09-18
> Focus: Webhook UI overhaul + thread targeting + mention fixes

---

## 🎨 Webhook UI — Complete Overhaul

### Visual Hierarchy
- **Webhook link** — accent-colored left border, larger font, `[Required]` label, Test button below
- **Thread ID** — moved below URL, `[Optional]` badge, same visual style
- **Ping Roles** — amber left border, bold label
- Each section visually separated by colored left border (accent purple, cyan, amber)

### Delete Confirmation
- Delete button now shows inline confirmation bar ("Delete this webhook?" with Cancel/Delete)
- Prevents accidental webhook loss

### Test Button
- Moved from header to URL field area
- Status message shown inline next to button (Testing… / ✓ Test post delivered / ✗ Error)

### ON/OFF Toggle
- Replaced ambiguous dot with labeled pill (green "ON" / muted "OFF")
- Instantly communicates webhook state

### Collapsed Chips
- Replaced unreadable concatenated string with colored chips
- Each chip type has its own color: Thread (blue), Channel (purple), No link (red), Pings (amber), CM (green), non-CM (muted), LCM (purple)
- Capitalized type/outcome chips (Raid, Strike, Kill, etc.)

### Preset Filters
- Quick-select buttons: [All] [Raids] [Strikes] [CM]
- Always visible above advanced filters

### Filter Section
- Filters always visible (no longer hidden behind toggle)
- Fixed-width labels prevent overlap with chips
- Color-coded active chips: Type (cyan), Outcome (amber), Mode (green), LCM (purple)
- Row hover and subtle tinting for visual grouping
- "More filters" button collapses/expands the full filter grid

### Role UI — Simplified
- Default: single "+ Add ping role" link (minimal space)
- Clicking expands inline form (Name + Role ID + Add + Cancel)
- After adding, form collapses back to link
- Each role shown as tag with name + × (delete)
- Click role name to edit inline
- Removed: separate edit form, duplicate button, always-visible inputs

### Visual Polish
- Thread section removed border (cleaner)
- Required/Optional badges use same accent color
- All section labels bold white for consistency

---

## 🐛 Bug Fixes

### Thread ID Not Working
- **Fixed:** `test_webhook` now appends `?thread_id=<id>` to POST URL when thread ID is set
- **Fixed:** `send_discord_with_retry` now respects thread ID (all 3 callers updated)
- Test messages now land in the target thread, not the channel root

### Role Pings Not Working
- **Fixed:** Backend now builds mention string from `mention_roles` tokens
- Added `build_mention_str` helper function
- Both test and production posting paths updated
- Roles are now pinged on upload

---

## 🔧 Technical Changes

### Frontend (`src/routes/+page.svelte`)
- Added `_roleFormOpen` state to track role add form visibility
- `_showAdvanced` state for future Advanced section
- `pendingDeleteWh` state for delete confirmation
- Moved Thread section below URL field
- Added `build_mention_str` inline in `testWebhook` function

### Backend (`src-tauri/src/uploader.rs`)
- Added `build_mention_str` function (joins mention_roles tokens with spaces)
- `send_discord_with_retry` now takes `thread_id: Option<&str>` parameter
- Thread ID appended to webhook URL as `?thread_id=<id>` when set
- Mention string built from mention_roles in both test and production paths

### Styles (`src/app.css`)
- Added `.wh-delete-confirm` with fade-in animation
- Added `.wh-toggle` pill styles (ON/OFF)
- Added `.wh-chip-*` for colored collapsed chips
- Added `.wh-filters-header` button styles
- Added `.wh-filters-body` collapsible section
- Added `.wh-filter-row-*` with category colors
- Added `.wh-chip-type`, `.wh-chip-outcome`, `.wh-chip-mode`, `.wh-chip-lcm`
- Added `.wh-role-tag`, `.wh-role-add-toggle`, `.wh-role-del`, `.wh-role-cancel-btn`
- Added `.wh-status-inline` for test status next to button
- Added `.wh-status-invalid` for URL validation message

---

## 📝 Files Modified

| File | Changes |
|------|---------|
| `src/routes/+page.svelte` | Webhook UI template, state management, role functions |
| `src/styles/app.css` | All webhook visual styles |
| `src-tauri/src/uploader.rs` | Thread targeting, mention handling, role ping support |

---

*Previous version: 0.6.9*
