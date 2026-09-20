# Squad Planner — Backup / Export / Import (future feature)

## Why
Planner data can be lost if the on-disk config is replaced outside the app
(Windows boot restore, OneDrive sync, corrupted config, manual config edits, etc.).
A portable backup gives the user a way to preserve and restore squad plans
without depending on a single config file path.

## Proposed behavior
- **Export Squad Plans**: writes `squad_plans.json` to a user-chosen location
  with a timestamped filename like `squad-plans-2026-09-04T18-30-00.json`.
- **Import Squad Plans**: opens a file picker; reads `squad_plans.json`,
  validates the structure, and replaces or merges the in-memory `squadPlans`.
- Optionally include a small manifest:
  - exported app version
  - plan count
  - export timestamp
- Keep it separate from the main config so users can back up just Planner data
  without sharing private settings.

## UI placement
- Add **Export / Import** buttons inside the Planner area / modal.
- Keep it behind the existing `SHOW_SQUAD_PLANNER` flag until the feature is ready.

## Notes
- Do not delete any existing Planner code when this is implemented.
- All code changes must continue to pass:
  - `npm run check`
  - `npm run build`
  - `cd src-tauri && cargo check --release`
