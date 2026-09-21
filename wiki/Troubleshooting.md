# Troubleshooting

## Common Issues

### App won't start

**Windows**: Ensure WebView2 Runtime is installed (included with Windows 11, downloadable for Windows 10).

**macOS**: If you see "App is damaged", run:
```bash
xattr -cr /Applications/Portal\ Protocol.app
```

**Linux**: Ensure AppImage is executable:
```bash
chmod +x Portal-Protocol-*.AppImage
```

### Logs not appearing in feed

1. Check the logs folder path in Settings
2. Verify ArcDPS is generating `.zevtc` files
3. Check the file extension filter (should include `.zevtc`)

### Uploads failing

| Error | Cause | Solution |
|-------|-------|----------|
| "dps.report token invalid" | Token expired or wrong | Generate new token at dps.report |
| "Upload failed: 500" | dps.report server issue | Wait and retry; logs are queued |
| "Upload failed: 429" | Rate limit hit | App auto-retry after delay |
| "No internet" | Connection down | App will retry when back online |

### Discord webhooks not sending

1. Verify webhook URL starts with `https://discord.com/api/webhooks/`
2. Test with the Test button
3. Check filters match your logs (e.g., CM filter won't match normal mode)
4. Check Discord webhook isn't deleted or revoked

### App not updating

1. Go to Settings → Check for Updates
2. If no update found, your version is current
3. Download latest from Releases page if needed

## Log Files

Portal Protocol stores logs in:

- **Windows**: `%APPDATA%\com.usuario.gw2-log-uploader\logs\`
- **macOS**: `~/Library/Logs/com.usuario.gw2-log-uploader/`
- **Linux**: `~/.local/share/com.usuario.gw2-log-uploader/logs/`

Include these logs when reporting bugs.

## Resetting Configuration

To reset all settings:

1. Close Portal Protocol
2. Delete the config directory:
   - **Windows**: `%APPDATA%\com.usuario.gw2-log-uploader\`
   - **macOS**: `~/Library/Application Support/com.usuario.gw2-log-uploader/`
   - **Linux**: `~/.config/com.usuario.gw2-log-uploader/`
3. Restart the app

Your log data (stored in the logs folder) is preserved.

## Getting Help

1. Check this wiki's [FAQ](FAQ)
2. Search [existing issues](https://github.com/Mestiak/Portal-Protocol/issues)
3. Open a new issue with:
   - Your OS and app version
   - Steps to reproduce
   - Relevant log files
