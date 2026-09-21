# Portal Protocol 0.7.0 — Patch Notes

## ✨ New Features

### Public GitHub Repository
Portal Protocol is now open-source on GitHub. The full source code is available at https://github.com/Mestiak/Portal-Protocol under the MIT License. This enables community contributions, issue tracking, and full transparency of the codebase.

### GitHub Actions CI/CD
Automatic builds for Windows, macOS, and Linux on every tag push. Draft releases are created with signed installers for all platforms.

### Wiki Documentation
Comprehensive documentation published to the GitHub Wiki, covering installation, features, settings, and troubleshooting.

### Auto-Updater Migrated to GitHub Releases
The Tauri auto-updater now queries GitHub Releases directly instead of a custom R2 bucket. Updates are delivered natively through GitHub's infrastructure.

## 📝 Notes Feature

### Notes Reactivity Fixed
Notes added or deleted in the Feed, History, Folders, and Subfolders now update the UI instantly without needing to close and reopen the notes panel or switch tabs.

### Notes Count Badge
The Notes button now displays a badge with the number of notes on a log, so you can see at a glance which logs have notes attached.

### Notes Button Highlight
The Notes button now visually highlights (accent color) when a log has notes, making it easy to spot logs with annotations.

### Keyboard Shortcut
Press Enter in the notes input field to quickly add a note.

### Has Notes Filter
New filter option in the Filter Bar to show only logs that have notes attached. Toggle it via the 📝 Has Notes button in the filter drawer.

## 📦 Dependencies

### Elite Insights Updated to v3.30
Bundled EI parser updated from v3.29 to v3.30. Adds support for Nexus of Eternity raid and convergence, FlyTo events, new buffs and damage modifiers, Mirage Cloak split, Juvenile Ley Vampire Bat, and fixes Compounding Power modifier and Cairn mechanic severities.

## 🐞 Bug Fixes

### Notes State Sync
Fixed an issue where notes created in one view (e.g., Feed) didn't appear in other views (e.g., Folders) until switching tabs. All source arrays are now updated together.

---

*September 20, 2026*
