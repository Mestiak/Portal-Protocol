# Portal Protocol 0.8.2 — Patch Notes

This update reworks the Capture Session filing flow — you can now see exactly what will be filed, rename the subfolder, and pick its colour before committing — and overhauls Appearance with a bigger font selection where every font actually applies.

---

## 🎨 Appearance

### More Fonts
Choose from Outfit, Inter, DM Sans, Manrope, Space Grotesk, Fredoka, a terminal-style font, or your system font.

### Font Picker Fixed
Every font in the list now actually applies. The terminal-style option used to fall back to a plain system font, and one option looked identical to the default.

### Quieter Settings
Changing the font saves right away and no longer pops up the "settings saved" message.

---

## 📁 Capture Session

### Easier End-of-Session Filing
When you end a session, the app now shows exactly what will be filed — the boss names, not just a number — and lets you rename the subfolder and pick its colour with a live preview.

### Don't Save
You can end a session without filing it. The logs simply stay in your Uploads Feed.

### Duplicate Name Warning
If a subfolder with that name already exists in the folder, the app warns you instead of quietly creating a second one.

### Keyboard Support
The filing window works without the mouse — it focuses the name field, Enter jumps to the folder list, and the arrow keys move between folders.

---

## 🔧 Under the Hood

- Updated the build toolchain (SvelteKit 3, Vite 8, TypeScript 6) and the Tauri packages.
- Refreshed dependencies to clear the outstanding security advisories.
- Building from source now requires Node.js 22.17 or newer.
