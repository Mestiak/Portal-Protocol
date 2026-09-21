# Getting Started

## System Requirements

| OS | Minimum Version | Disk Space |
|----|-----------------|------------|
| Windows | 10 (64-bit) | ~200 MB |
| macOS | 11 (Big Sur) | ~200 MB |
| Linux | Ubuntu 20.04 / Fedora 34 | ~200 MB |

## Installation

### Windows

1. Download the latest `.exe` installer from [Releases](https://github.com/Mestiak/Portal-Protocol/releases)
2. Run the installer and follow the prompts
3. Launch Portal Protocol from the Start Menu

### macOS

1. Download the latest `.dmg` from [Releases](https://github.com/Mestiak/Portal-Protocol/releases)
2. Open the DMG and drag Portal Protocol to Applications
3. Launch from Applications (right-click → Open for first launch)

### Linux

1. Download the latest `.AppImage` from [Releases](https://github.com/Mestiak/Portal-Protocol/releases)
2. Make it executable: `chmod +x Portal-Protocol-*.AppImage`
3. Run: `./Portal-Protocol-*.AppImage`

## First Launch

### 1. dps.report Token

Portal Protocol needs a dps.report token to upload logs:

1. Go to [dps.report](https://dps.report) and log in
2. Navigate to Settings → API Keys
3. Generate a new token
4. Paste it in Portal Protocol's Settings → dps.report

### 2. ArcDPS Logs Folder

Point Portal Protocol to your ArcDPS logs:

- **Windows**: Usually `C:\Users\<You>\Documents\Guild Wars 2\addons\arcdps\arcdps.cbtlogs\`
- **macOS**: `~/Documents/Guild Wars 2/addons/arcdps/arcdps.cbtlogs/`
- **Linux**: `~/.local/share/Guild Wars 2/addons/arcdps/arcdps.cbtlogs/`

### 3. Discord Webhooks (Optional)

To receive Discord notifications:

1. In Discord, go to Server Settings → Integrations → Webhooks
2. Create a new webhook and copy the URL
3. In Portal Protocol, go to Settings → Discord Webhooks → Add Webhook
4. Paste the URL and configure filters

## Updating

Portal Protocol uses Tauri's built-in updater. When a new version is available:

1. A notification appears in the app
2. Click "Download and Install"
3. The app restarts with the new version

Manual updates: Download the latest installer from Releases and run it over your existing installation.

## Uninstalling

### Windows
Settings → Apps → Portal Protocol → Uninstall

### macOS
Drag Portal Protocol from Applications to Trash

### Linux
Delete the AppImage file. Config is at `~/.config/com.usuario.gw2-log-uploader/`
