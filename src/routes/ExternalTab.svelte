<!-- External logs: paste a dps.report or Wingman link, analyze it, keep notes. -->
<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";

  interface ExtPlayer { name: string; account: string; profession: string; }
  interface ExtNote { id: string; text: string; createdAt: string; }
  interface ExtLog {
    id: string; source: string; linkId: string; url: string; bossName: string;
    success: boolean | null; isCm: boolean; isLcm: boolean; durationSec: number;
    groupDps: number; hpLeft: number | null; numPlayers: number;
    players: ExtPlayer[]; notes: ExtNote[]; createdAt: string; lastChecked: string;
  }
  interface ServiceStatus { dpsReport: string; wingman: string; }

  let {
    onCheckStats,
    bossIcon,
  }: {
    onCheckStats: (log: ExtLog) => void;
    bossIcon: (name: string | undefined, players?: number) => string;
  } = $props();

  let logs = $state<ExtLog[]>([]);
  let linkInput = $state("");
  let busy = $state(false);
  let checking = $state(false);
  let error = $state("");
  let status = $state<ServiceStatus>({ dpsReport: "unknown", wingman: "unknown" });
  let confirmDelete = $state<string | null>(null);
  let notesOpen = $state<Record<string, boolean>>({});
  let noteDraft = $state<Record<string, string>>({});

  onMount(() => {
    void loadLogs();
    void loadStatus(false);
  });

  async function loadLogs() {
    try {
      logs = await invoke<ExtLog[]>("list_external_logs");
    } catch (e) {
      error = `Could not load saved logs: ${String(e)}`;
    }
  }

  async function loadStatus(probe: boolean) {
    try {
      status = await invoke<ServiceStatus>(probe ? "check_external_services" : "external_service_status");
    } catch {
      // The banner is informational; a failed probe must not block the tab.
    }
  }

  async function addLog() {
    const url = linkInput.trim();
    if (!url || busy) return;
    busy = true;
    error = "";
    try {
      const rec = await invoke<ExtLog>("add_external_log", { url });
      logs = [rec, ...logs.filter((l) => l.id !== rec.id)];
      linkInput = "";
      await loadStatus(false);
    } catch (e) {
      error = String(e);
      await loadStatus(false);
    } finally {
      busy = false;
    }
  }

  async function refreshLog(log: ExtLog) {
    if (busy) return;
    busy = true;
    error = "";
    try {
      const rec = await invoke<ExtLog>("refresh_external_log", { id: log.id });
      logs = logs.map((l) => (l.id === rec.id ? rec : l));
      await loadStatus(false);
    } catch (e) {
      error = String(e);
      await loadStatus(false);
    } finally {
      busy = false;
    }
  }

  async function removeLog(log: ExtLog) {
    try {
      await invoke("delete_external_log", { id: log.id });
      logs = logs.filter((l) => l.id !== log.id);
      confirmDelete = null;
    } catch (e) {
      error = String(e);
    }
  }

  async function addNote(log: ExtLog) {
    const text = (noteDraft[log.id] ?? "").trim();
    if (!text) return;
    try {
      await invoke("add_external_note", { id: log.id, text });
      noteDraft = { ...noteDraft, [log.id]: "" };
      await loadLogs();
    } catch (e) {
      error = String(e);
    }
  }

  async function removeNote(log: ExtLog, note: ExtNote) {
    try {
      await invoke("delete_external_note", { id: log.id, noteId: note.id });
      await loadLogs();
    } catch (e) {
      error = String(e);
    }
  }

  function fmtDuration(sec: number): string {
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function fmtNumber(n: number): string {
    return Math.round(n).toLocaleString();
  }
  function fmtChecked(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }
  function sourceLabel(source: string): string {
    return source === "wingman" ? "GW2 Wingman" : "dps.report";
  }
</script>

<div class="ext-tab">
  <div class="ext-intro">
    <div>
      <h2>External logs</h2>
      <p class="ext-hint">Paste a dps.report or GW2 Wingman link to read its log here. Saved logs stay in this tab with their notes — they are not added to your upload history or analytics.</p>
    </div>
    <button class="ext-status-btn" onclick={() => { checking = true; void loadStatus(true).finally(() => { checking = false; }); }} disabled={checking}>
      <i class="fa-solid {checking ? 'fa-spinner fa-spin' : 'fa-rotate-right'}"></i> Check status
    </button>
  </div>

  {#if status.dpsReport === "offline" || status.wingman === "offline"}
    <div class="ext-outage" role="status">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div>
        {#if status.dpsReport === "offline" && status.wingman === "offline"}
          <strong>Both dps.report and GW2 Wingman appear to be down.</strong> New links cannot be read right now. Logs you already opened still work from the local cache.
        {:else if status.dpsReport === "offline"}
          <strong>dps.report appears to be down.</strong> Wingman links still work; dps.report links will fail until it recovers. Already-cached logs still open.
        {:else}
          <strong>GW2 Wingman appears to be down.</strong> dps.report links still work; Wingman links will fail until it recovers. Already-cached logs still open.
        {/if}
      </div>
    </div>
  {/if}

  <div class="ext-paste card">
    <label class="ext-label" for="ext-link">Log link</label>
    <div class="ext-paste-row">
      <input id="ext-link" class="ext-input" placeholder="https://dps.report/… or https://gw2wingman.nevermindcreations.de/log/…"
             value={linkInput}
             oninput={(e) => { linkInput = e.currentTarget.value; }}
             onkeydown={(e) => { if (e.key === "Enter") void addLog(); }} />
      <button class="ext-btn ext-primary" onclick={() => void addLog()} disabled={busy || !linkInput.trim()}>
        <i class="fa-solid {busy ? 'fa-spinner fa-spin' : 'fa-plus'}"></i> Add log
      </button>
    </div>
    {#if error}<div class="ext-error" role="alert">{error}</div>{/if}
  </div>

  {#if logs.length === 0}
    <div class="ext-empty card">No external logs yet. Paste a link above to analyze one.</div>
  {:else}
    <div class="ext-list">
      {#each logs as log (log.id)}
        <div class="log-card card ext-card">
          <div class="ext-head">
            <img class="ext-icon" src={bossIcon(log.bossName, log.numPlayers)} alt={log.bossName} />
            <div class="ext-body">
              <div class="ext-name">{log.bossName || "Unknown encounter"}</div>
              <div class="ext-badges">
                <span class="ext-chip ext-mode" class:ext-cm={log.isCm || log.isLcm}>{log.isLcm ? "LCM" : log.isCm ? "CM" : "Normal"}</span>
                <span class="ext-chip" class:ext-win={log.success === true} class:ext-loss={log.success === false}>
                  {log.success === true ? "Kill" : log.success === false ? "Wipe" : "Unknown"}
                </span>
                <span class="ext-detail">{fmtDuration(log.durationSec)}</span>
                <span class="ext-detail">{log.numPlayers} players</span>
                <span class="ext-detail">{fmtNumber(log.groupDps)} DPS</span>
              </div>
              <div class="ext-source">
                <span>{sourceLabel(log.source)}</span>
                <span class="ext-dot">·</span>
                <a href={log.url} target="_blank" rel="noopener noreferrer">{log.linkId}</a>
                <span class="ext-dot">·</span>
                <span>checked {fmtChecked(log.lastChecked)}</span>
              </div>
            </div>
          </div>

          <div class="ext-actions">
            <button class="ext-btn ext-primary" onclick={() => onCheckStats(log)}>
              <i class="fa-solid fa-chart-line"></i> Check Stats
            </button>
            <button class="ext-btn" onclick={() => void refreshLog(log)} disabled={busy}>Refresh</button>
            <button class="ext-btn" class:ext-active={notesOpen[log.id]} onclick={() => { notesOpen = { ...notesOpen, [log.id]: !notesOpen[log.id] }; }}>
              Notes ({log.notes.length})
            </button>
            <button class="ext-btn ext-danger" onclick={() => { confirmDelete = confirmDelete === log.id ? null : log.id; }}>Delete</button>
          </div>

          {#if confirmDelete === log.id}
            <div class="ext-confirm">
              Remove this saved log and its notes? The original link is unaffected.
              <button class="ext-btn" onclick={() => { confirmDelete = null; }}>Cancel</button>
              <button class="ext-btn ext-danger" onclick={() => void removeLog(log)}>Remove</button>
            </div>
          {/if}

          {#if notesOpen[log.id]}
            <div class="ext-notes">
              {#each log.notes as note (note.id)}
                <div class="ext-note">
                  <span class="ext-note-text">{note.text}</span>
                  <button class="ext-note-del" aria-label="Delete note" onclick={() => void removeNote(log, note)}><i class="fa-solid fa-xmark"></i></button>
                </div>
              {:else}
                <div class="ext-note-empty">No notes for this log yet.</div>
              {/each}
              <div class="ext-note-row">
                <input class="ext-input" aria-label="New note" placeholder="Add a note…"
                       value={noteDraft[log.id] ?? ""}
                       oninput={(e) => { noteDraft = { ...noteDraft, [log.id]: e.currentTarget.value }; }}
                       onkeydown={(e) => { if (e.key === "Enter") void addNote(log); }} />
                <button class="ext-btn" onclick={() => void addNote(log)}>Add</button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ext-tab { display: flex; flex-direction: column; gap: 14px; padding: 16px; overflow-y: auto; height: 100%; box-sizing: border-box; }
  .ext-intro { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .ext-intro h2 { margin: 0 0 4px; font-size: 16px; font-weight: 800; }
  .ext-hint { margin: 0; max-width: 720px; font-size: 11px; color: var(--text-muted); line-height: 1.5; }
  .ext-status-btn, .ext-btn {
    background: #ffffff0d; color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 10px; font-size: 11px; font-weight: 700;
    cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  }
  .ext-status-btn:hover:not(:disabled), .ext-btn:hover:not(:disabled) { background: #ffffff18; }
  .ext-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .ext-primary { background: color-mix(in srgb, var(--accent) 22%, transparent); border-color: var(--accent); }
  .ext-danger { color: var(--fail); }
  .ext-active { background: #ffffff18; }
  .ext-outage {
    display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px;
    border: 1px solid var(--warn); border-radius: 8px; background: color-mix(in srgb, var(--warn) 12%, transparent);
    font-size: 11px; line-height: 1.5; color: var(--text);
  }
  .ext-outage i { color: var(--warn); margin-top: 2px; }
  .ext-paste { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .ext-label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); font-weight: 800; }
  .ext-paste-row, .ext-note-row { display: flex; gap: 8px; }
  .ext-input {
    flex: 1; min-width: 0; background: #0c0c0f; border: 1px solid var(--border);
    border-radius: 6px; color: var(--text); padding: 7px 9px; font-size: 11px;
  }
  .ext-input::placeholder { color: var(--text-muted); }
  .ext-error { font-size: 11px; color: var(--fail); }
  .ext-empty { padding: 20px; text-align: center; font-size: 12px; color: var(--text-muted); }
  .ext-list { display: flex; flex-direction: column; gap: 10px; }
  .ext-card { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .ext-head { display: flex; align-items: flex-start; gap: 10px; }
  .ext-icon { width: 42px; height: 42px; border-radius: 8px; object-fit: cover; background: #0c0c0f; flex: none; }
  .ext-body { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .ext-name { font-size: 14px; font-weight: 800; color: #fff; }
  .ext-badges { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .ext-chip { font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 999px; background: #ffffff12; color: var(--text-muted); text-transform: uppercase; }
  .ext-chip.ext-cm { background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--accent); }
  .ext-chip.ext-win { background: color-mix(in srgb, var(--success) 20%, transparent); color: var(--success); }
  .ext-chip.ext-loss { background: color-mix(in srgb, var(--fail) 20%, transparent); color: var(--fail); }
  .ext-detail { font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .ext-source { display: flex; flex-wrap: wrap; gap: 5px; font-size: 10px; color: var(--text-muted); }
  .ext-source a { color: var(--accent); text-decoration: none; }
  .ext-source a:hover { text-decoration: underline; }
  .ext-dot { opacity: .5; }
  .ext-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .ext-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 11px; color: var(--text-muted); }
  .ext-notes { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border); padding-top: 8px; }
  .ext-note { display: flex; align-items: center; gap: 8px; font-size: 11px; background: #ffffff08; border-radius: 6px; padding: 5px 8px; }
  .ext-note-text { flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word; }
  .ext-note-del { background: none; border: none; color: var(--text-muted); cursor: pointer; }
  .ext-note-del:hover { color: var(--fail); }
  .ext-note-empty { font-size: 10px; color: var(--text-muted); }
</style>
