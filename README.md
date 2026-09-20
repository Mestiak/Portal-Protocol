# Portal Protocol

[![Tauri](https://img.shields.io/badge/Tauri-v2-000?logo=tauri&logoColor=fff)](https://tauri.app)
[![Svelte](https://img.shields.io/badge/Svelte-5-ff3e00?logo=svelte&logoColor=fff)](https://svelte.dev)
[![Rust](https://img.shields.io/badge/Rust-1.70+-dea584?logo=rust&logoColor=fff)](https://www.rust-lang.org)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**GW2 log uploader & log manager suite.** Upload ArcDPS combat logs to dps.report, track raid/strike/fractal clears, manage sessions and folders, send Discord webhooks, and view detailed analytics — all from a single desktop app.

---

## Features

### Log Management
- **Auto-upload** — Watches your ArcDPS logs folder and uploads new logs to dps.report automatically
- **Log feed** — Browse all uploads with boss icons, CM/QP badges, kill/wipe status, duration, and squad composition
- **Folders & sessions** — Organize logs into sessions and subfolders with drag-and-drop
- **Local fallback** — Enrich logs with HP, phases, and squad data from local EVTC when dps.report is unavailable

### Discord Integration
- **Rich embeds** — Post formatted kill/wipe notifications to Discord channels
- **Role pings** — Configurable named role pings per webhook
- **Thread targeting** — Post to Discord threads instead of channel root
- **Routing filters** — Filter by encounter type, outcome, mode (CM/LCM), and boss name
- **Test button** — Send sample embeds to verify webhook configuration

### Analytics
- **Encounter statistics** — View clear counts, boss breakdowns, and mode splits
- **Personal records** — Track best pulls, fastest kills, and CM times
- **Squad planner** — Plan raid compositions and track subgroup assignments

### Quality of Life
- **Notes** — Attach notes to individual logs with inline editing
- **Search & filter** — Find logs by boss, mode, outcome, or date
- **Export** — Copy formatted log summaries for Discord or forums
- **Auto-update** — Tauri v2 built-in updater fetches new releases automatically

---

## Download

Get the latest installer from the [Releases](https://github.com/Mestiak/Portal-Protocol/releases) page.

> The app uses Tauri's built-in updater. Once installed, new versions download and install automatically.

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Rust](https://rustup.rs) 1.70+
- [pnpm](https://pnpm.io) (recommended) or npm

### Setup

```bash
# Clone the repository
git clone https://github.com/Mestiak/Portal-Protocol.git
cd Portal-Protocol

# Install dependencies
pnpm install

# Download static assets (boss icons, profession icons, etc.)
node scripts/download_icons.cjs
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
│   ├── resources/ei/       # Bundled EI parser binaries
│   └── icons/              # App icons for all platforms
├── static/                 # Static assets (boss portraits, boon icons, etc.)
└── scripts/                # Build and release scripts
```

### Key technologies

| Layer | Technology |
|-------|-----------|
| Frontend | Svelte 5, TypeScript, Vite |
| Backend | Rust, Tauri 2 |
| Log parsing | Elite Insights (bundled) |
| Styling | CSS custom properties, dark theme |

---

## Configuration

Portal Protocol stores its config in the platform-specific app data directory:

- **Windows**: `%APPDATA%\com.portal-protocol.app\`
- **macOS**: `~/Library/Application Support/com.portal-protocol.app/`
- **Linux**: `~/.config/com.portal-protocol.app/`

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
- [GW2 Wingman](https://gw2wingman.neveralone.se) — Wingman integration
- [Tauri](https://tauri.app) — Desktop app framework
- [Svelte](https://svelte.dev) — Reactive UI framework

---

*Built with ❤️ for the GW2 raiding community.*
