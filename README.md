# Portal Protocol

<div align="center">

[![Tauri](https://img.shields.io/badge/Tauri-v2-24c8db?logo=tauri&logoColor=fff)](https://tauri.app)
[![Svelte](https://img.shields.io/badge/Svelte-5-ff3e00?logo=svelte&logoColor=fff)](https://svelte.dev)
[![Rust](https://img.shields.io/badge/Rust-1.70+-dea584?logo=rust&logoColor=fff)](https://www.rust-lang.org)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/Mestiak/Portal-Protocol/total?color=green)](https://github.com/Mestiak/Portal-Protocol/releases)

**GW2 combat log uploader, Discord webhook integration, and analytics suite.**

*Upload ArcDPS logs to dps.report, track clears, manage sessions, and notify your Discord — all from one app.*

[Download](https://github.com/Mestiak/Portal-Protocol/releases) · [Wiki](https://github.com/Mestiak/Portal-Protocol/wiki) · [Issues](https://github.com/Mestiak/Portal-Protocol/issues)

---

</div>

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Download](#download)
- [Development](#development)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## Overview

Portal Protocol is a desktop app for Guild Wars 2 raid and strike teams. It watches your ArcDPS logs folder, uploads to dps.report, and sends rich Discord notifications — all automatically.

**Built with Tauri v2 + Svelte 5.**

## Features

### Log Management
| | Feature | Description |
|---|---------|-------------|
| ☁️ | **Auto-Upload** | Watches ArcDPS logs folder, uploads to dps.report automatically |
| 📜 | **Log Feed** | Browse all uploads with boss icons, CM/QP badges, kill/wipe status |
| 📂 | **Sessions & Folders** | Organize logs by raid night or custom folders with drag-and-drop |
| 📝 | **Notes** | Attach notes to individual logs with inline editing |
| 🔍 | **Search & Filter** | Find logs by boss, mode, outcome, or date |

### Discord Integration
| | Feature | Description |
|---|---------|-------------|
| ✈️ | **Rich Embeds** | Post formatted kill/wipe notifications to Discord |
| 🔔 | **Role Pings** | Configurable named role pings per webhook |
| 🧵 | **Thread Targeting** | Post to Discord threads instead of channel root |
| 🎛️ | **Routing Filters** | Filter by encounter type, outcome, mode, and boss name |
| 🧪 | **Test Button** | Send sample embeds to verify webhook configuration |

### Analytics
| | Feature | Description |
|---|---------|-------------|
| 📊 | **Encounter Statistics** | Clear counts, boss breakdowns, mode splits |
| 🏆 | **Personal Records** | Fastest kills, best pulls, CM times |
| 👥 | **Squad Planner** | Plan raid compositions and subgroup assignments |

### Quality of Life
| | Feature | Description |
|---|---------|-------------|
| 🔄 | **Auto-Update** | Built-in Tauri updater fetches new releases automatically |
| 📋 | **Export** | Copy formatted log summaries for Discord or forums |

---

## Download

Get the latest installer from the [Releases](https://github.com/Mestiak/Portal-Protocol/releases) page.

| Platform | File |
|----------|------|
| Windows | `.exe` (NSIS installer) |
| macOS | `.dmg` (Apple Silicon / Intel) |
| Linux | `.AppImage` or `.deb` |

> The app uses Tauri's built-in updater. Once installed, new versions download and install automatically.

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org) 20+
- [Rust](https://rustup.rs) 1.70+
- [pnpm](https://pnpm.io) (recommended) or npm

### Setup

```bash
# Clone the repository
git clone https://github.com/Mestiak/Portal-Protocol.git
cd Portal-Protocol

# Install dependencies
pnpm install

# Download EI parser binaries (required for local EVTC parsing)
node scripts/download_ei.cjs
```

### Development mode

```bash
pnpm run tauri dev
```

This starts both the SvelteKit frontend and Tauri backend with hot-reload.

### Building

```bash
# Build for production
pnpm run tauri build

# Output: src-tauri/target/release/bundle/msi/ or /nsis/
```

### Release

```bash
# Bump version, build, sign, and prepare release files
bash ./scripts/release-update.sh 0.7.0

# Tag and push (triggers GitHub Actions)
git tag v0.7.0
git push origin v0.7.0
```

---

## Architecture

```
Portal Protocol/
├── src/                    # SvelteKit frontend (TypeScript)
│   ├── routes/             # UI components (+page.svelte is the main app)
│   ├── lib/                # Shared logic (formatter, encounter data, etc.)
│   └── app.css             # Global styles and CSS variables
├── src-tauri/              # Tauri backend (Rust)
│   ├── src/
│   │   ├── main.rs         # Entry point, command registration
│   │   ├── lib.rs          # Tauri commands (notes, webhook, etc.)
│   │   ├── uploader.rs     # Discord webhook logic with retry
│   │   ├── config.rs       # App config structs (DiscordWebhook, UploadRecord)
│   │   ├── ei_runner.rs    # EI parser process execution
│   │   ├── evtc_parser.rs  # EVTC file parsing
│   │   └── watcher.rs      # Filesystem watcher for ArcDPS logs
│   ├── resources/ei/       # EI parser binaries (downloaded via script)
│   └── icons/              # App icons for all platforms
├── static/                 # Static assets (boss portraits, boon icons, etc.)
└── scripts/                # Build and release scripts (download_ei.cjs)
```

### Key technologies

| Layer | Technology |
|-------|-----------|
| Frontend | Svelte 5, TypeScript, Vite |
| Backend | Rust, Tauri 2 |
| Log parsing | Elite Insights (downloaded on setup) |
| Styling | CSS custom properties, dark theme |

---

## Configuration

Portal Protocol stores its config in the platform-specific app data directory:

| OS | Path |
|----|------|
| Windows | `%APPDATA%\com.usuario.gw2-log-uploader\` |
| macOS | `~/Library/Application Support/com.usuario.gw2-log-uploader/` |
| Linux | `~/.config/com.usuario.gw2-log-uploader/` |

The config includes: dps.report token, Discord webhooks, watched folders, and UI preferences.

---

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Acknowledgments

- [dps.report](https://dps.report) — Combat log hosting
- [GW2 Elite Insights](https://github.com/baaron4/GW2-Elite-Insights-Parser) — Log parsing engine
- [GW2 Wingman](https://gw2wingman.nevermindcreations.de/) — Wingman integration
- [Tauri](https://tauri.app) — Desktop app framework
- [Svelte](https://svelte.dev) — Reactive UI framework

---

*Built with ❤️ for the GW2 community. Mestiak*
