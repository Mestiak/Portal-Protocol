# Contributing to Portal Protocol

Thank you for your interest in contributing! This document covers how to get started, our development workflow, and what we expect from contributors.

---

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

---

## How You Can Contribute

### Reporting Bugs

Before creating a bug report:
- Check the [existing issues](../../issues) to avoid duplicates
- Try the latest version to confirm the bug still exists
- Collect information about your environment (OS, app version, logs)

Use the [Bug Report template](../../issues/new?template=bug_report.md) when submitting.

### Suggesting Features

- Open a [Feature Request](../../issues/new?template=feature_request.md)
- Explain the problem you're trying to solve
- Describe who would benefit from the feature

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Test locally: `npm run tauri dev`
5. Commit with a clear message
6. Push to your fork
7. Open a Pull Request

---

## Development Setup

### Prerequisites

- **Node.js** 18+ ([nodejs.org](https://nodejs.org))
- **Rust** 1.70+ ([rustup.rs](https://rustup.rs))
- **pnpm** (recommended) or npm

### Platform-Specific Dependencies

#### Windows
- Microsoft Visual Studio C++ Build Tools
- WebView2 Runtime (included with Windows 11)

#### macOS
- Xcode Command Line Tools: `xcode-select --install`

#### Linux (Debian/Ubuntu)
```bash
sudo apt-get install -y \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf \
  libssl-dev
```

### Installation

```bash
# Clone the repository
git clone https://github.com/Mestiak/Portal-Protocol.git
cd Portal-Protocol

# Install Node dependencies
npm install

# Download static assets (boss icons, profession icons)
node scripts/download_icons.cjs
```

### Development Mode

```bash
npm run tauri dev
```

This starts both the frontend (Vite + SvelteKit) and backend (Rust + Tauri) with hot-reload.

### Building

```bash
npm run tauri build
```

Output is in `src-tauri/target/release/bundle/`:
- **Windows**: `.msi` installer
- **macOS**: `.dmg` installer
- **Linux**: `.AppImage` file

---

## Project Structure

```
src/
├── routes/
│   ├── +page.svelte        # Main application (UI + state)
│   ├── +layout.ts          # Root layout
│   ├── AnalyticsDashboard.svelte
│   ├── ApiTracker.svelte
│   ├── CerusDashboard.svelte
│   ├── CerusLeaderboard.svelte
│   ├── FilterBar.svelte
│   ├── MechanicsTab.svelte
│   ├── SquadPlanCard.svelte
│   ├── SquadPlannerModal.svelte
│   └── StatsModal.svelte
├── lib/
│   ├── analyticsEngine.ts  # Analytics calculations
│   ├── encounterData.ts    # Encounter registries
│   ├── format.ts           # Discord formatter
│   ├── mechanicParser.ts   # Mechanic analysis
│   ├── professionData.ts   # Profession data
│   └── squadPlanner.ts     # Squad planner
├── app.css                 # Global styles
└── app.html                # HTML shell

src-tauri/
├── src/
│   ├── main.rs             # Entry point
│   ├── lib.rs              # Tauri commands
│   ├── config.rs           # Config structs
│   ├── uploader.rs         # Discord webhooks
│   ├── ei_runner.rs        # EI parser execution
│   ├── evtc_parser.rs      # EVTC parsing
│   ├── vl_ranks.rs         # VL rank calc
│   └── watcher.rs          # File watcher
├── resources/ei/           # Bundled EI parser
└── icons/                  # App icons

static/                     # Static assets (boss portraits, boons, etc.)
scripts/                    # Build & download scripts
```

---

## Coding Standards

### TypeScript / Svelte

- Use TypeScript for all new code
- Follow the existing code style (2-space indentation)
- Use `$state()`, `$derived()`, `$effect()` for reactivity (Svelte 5 runes)
- Keep components focused and reusable
- Add JSDoc comments for public functions

### Rust

- Follow `rustfmt` formatting (auto-applied on build)
- Use `cargo clippy` to catch common mistakes
- Document public APIs with `///` comments
- Handle errors properly — don't `unwrap()` in production code

### Commits

Use clear, descriptive commit messages:

```
feat: add support for CM-only webhook filters
fix: resolve duplicate log entries in feed
docs: update README with Linux dependencies
refactor: extract formatter logic to separate module
```

Prefixes:
- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation
- `refactor:` — Code restructuring
- `test:` — Tests
- `chore:` — Maintenance

---

## Pull Request Process

1. Update documentation if your change affects user-facing behavior
2. Add tests for new features where applicable
3. Ensure the build passes: `npm run tauri build`
4. Update CHANGELOG.md with your changes
5. Request review from a maintainer

### Review Checklist

- [ ] Code follows project style
- [ ] Tests pass locally
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] No breaking changes (or clearly documented)

---

## Release Process

Releases are triggered by pushing a version tag:

```bash
# Bump version in package.json and tauri.conf.json first
git tag v0.7.0
git push origin v0.7.0
```

GitHub Actions builds installers for all platforms and creates a draft release. A maintainer reviews and publishes it.

---

## Questions?

- Open a [Discussion](../../discussions) for general questions
- Join the community Discord (link coming soon)
- Check the [Wiki](../../wiki) for detailed documentation

---

Thank you for contributing! 🎉
