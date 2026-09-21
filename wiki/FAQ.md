# Frequently Asked Questions

## General

### Is Portal Protocol free?
Yes. Portal Protocol is open-source (MIT License) and free to use.

### Does it work on my operating system?
- **Windows**: Windows 10 and 11 (64-bit)
- **macOS**: macOS 11 (Big Sur) and later
- **Linux**: Ubuntu 20.04+, Fedora 34+, and most modern distros

### Does Portal Protocol modify my ArcDPS logs?
No. Portal Protocol reads `.zevtc` files and uploads them to dps.report. Your original files are never modified.

### Can I use Portal Protocol without a dps.report token?
Yes, but you'll only have local features (log viewing, notes, analytics). Uploads require a token.

### Is my data sent anywhere besides dps.report?
No. Portal Protocol only communicates with:
- **dps.report** — for log uploads
- **Discord** — if you configure webhooks
- **GitHub** — for update checks only

## Discord Webhooks

### Can I have multiple webhooks?
Yes. Create multiple webhooks with different filters. For example:
- One for all kills to #raids
- One for CM wipes to #cm-strats
- One for specific bosses to #boss-discussion

### How do I get a Role ID?
1. Enable Developer Mode in Discord (User Settings → Advanced)
2. Right-click the role → Copy Role ID
3. Paste into Portal Protocol's ping role configuration

### Why aren't my pings working?
- Verify the role ID is correct
- The role must be mentionable in Discord
- The bot must have permission to mention roles

### Can I ping @everyone?
Yes. Enter `@everyone` as the ping token. Use with caution — it notifies everyone in the channel.

## Logs & Uploads

### Where are my logs stored?
Portal Protocol stores uploaded log metadata locally. Your actual `.zevtc` files remain in your ArcDrops logs folder.

### What happens if dps.report is down?
Failed uploads are queued and retried automatically. You'll see a "Resend failed" button in the UI when there are pending uploads.

### Can I upload old logs?
Yes. Place `.zevtc` files in your monitored logs folder and the app will detect and upload them.

### Why does my log show "Duplicate"?
dps.report detects duplicate uploads (same file uploaded twice). Portal Protocol skips these to avoid clutter.

## Troubleshooting

### The app is slow with many logs
Try:
- Reducing the date range in filters
- Deleting very old logs you no longer need
- Closing other memory-intensive applications

### My webhook test fails
- Verify the URL is correct
- Check the webhook hasn't been deleted in Discord
- Ensure your firewall isn't blocking Discord API calls

### Analytics seem incorrect
- Make sure all logs are uploaded (check for failed uploads)
- Verify CM detection is working (some bosses need specific HP thresholds)
- Try re-enriching logs via Settings → Re-process local logs

## Contributing

### How can I report a bug?
Open an [issue](https://github.com/Mestiak/Portal-Protocol/issues) with:
- Your OS and app version
- Steps to reproduce
- Expected vs actual behavior
- Relevant log files

### Can I request features?
Yes! Open a [feature request](https://github.com/Mestiak/Portal-Protocol/issues/new?template=feature_request.md) describing your idea and who it would help.

### How do I contribute code?
See our [Contributing Guide](https://github.com/Mestiak/Portal-Protocol/blob/main/CONTRIBUTING.md).
