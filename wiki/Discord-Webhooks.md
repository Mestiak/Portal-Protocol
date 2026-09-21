# Discord Webhooks

Portal Protocol can send formatted Discord notifications for every log upload (success or failure).

## Setup

### 1. Create a Discord Webhook

1. Open your Discord server settings
2. Go to **Integrations** → **Webhooks**
3. Click **New Webhook**
4. Choose the channel and name it (e.g., "Portal Protocol")
5. Copy the webhook URL

### 2. Add to Portal Protocol

1. Open Settings → **Discord Webhooks**
2. Click **+ Add Webhook**
3. Paste the webhook URL
4. Give it a label (e.g., "Raid Pings")

## Configuration

### Enable/Disable
Toggle the webhook on/off with the ON/OFF button. Disabled webhooks won't receive notifications.

### Thread ID (Optional)

To post to a Discord thread instead of the channel root:

1. Enable Developer Mode in Discord (User Settings → Advanced)
2. Right-click the thread → Copy Thread ID
3. Paste the ID in the Thread ID field

### Ping Roles

Add named role pings to notifications:

1. Click **+ Add ping role**
2. Enter a friendly name (e.g., "Raid Lead")
3. Enter the Role ID (right-click role → Copy Role ID with Developer Mode)
4. Save

Multiple roles are joined with spaces, pinging all of them.

### Quick Filters

Use preset buttons for common configurations:

| Preset | Types | Outcome | Mode |
|--------|-------|---------|------|
| All | raid, strike, fractal, convergence, golem | kill + wipe | Any |
| Raids | raid | kill + wipe | Any |
| Strikes | strike | kill + wipe | Any |
| CM | raid, strike, fractal, convergence, golem | kill + wipe | CM only |

### Advanced Filters

Click **More filters** for full control:

- **Type**: Toggle each encounter type on/off
- **Outcome**: Kill, Wipe, or both
- **Mode**: Any, CM only, non-CM, LCM only
- **Boss**: Text substring match (e.g., "cerus" matches all Cerus logs)

### Test Button

Click **Test** to send a sample embed to your webhook. The test uses a fake Harvest Temple CM kill. If the message appears in Discord, your webhook is configured correctly.

The status message next to the Test button shows:
- **Testing...** — Request in progress
- **✓ Test post delivered** — Success
- **✗ Error message** — Something went wrong (check your URL)

## Example Notification

A typical Discord embed looks like:

```
[Harvest Temple] [CM] [✓ Kill]
❤ HP Left: 0.00%
⏱ Duration: 3:03
📅 Date: 2026-09-18
🔗 Link: https://dps.report/abc123
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No notification received | Check webhook URL is correct; check filters match the log |
| "Invalid webhook URL" | URL must start with `https://discord.com/api/webhooks/` |
| Message in channel, not thread | Verify Thread ID is correct |
| Roles not pinging | Verify Role ID; roles must be mentionable |
| Duplicate notifications | Each enabled webhook sends one message per matching log |
