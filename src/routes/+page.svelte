<!-- Portal Protocol - Log Uploader & Log Manager Suite -->
<!-- Copyright (C) 2026 Mestiak -->
<!-- Licensed under MIT License -->

<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { slide, scale, fly, fade } from "svelte/transition";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { getVersion } from "@tauri-apps/api/app";
  import { check, type Update } from "@tauri-apps/plugin-updater";
  import { relaunch } from "@tauri-apps/plugin-process";
  import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
  import FilterBar from "./FilterBar.svelte";
  import StatsModal from "./StatsModal.svelte";
  import AnalyticsDashboard from "./AnalyticsDashboard.svelte";
  import ApiTracker from "./ApiTracker.svelte";
  import SquadPlannerModal from "./SquadPlannerModal.svelte";
  import SquadPlanCard from "./SquadPlanCard.svelte";
  import { PROFESSIONS, ELITE_SPEC_ICONS, SPEC_CORE, PROFESSION_GROUPS } from "../lib/professionData";
  import { type SquadPlan, newPlan, newFolder, newRoster, findPlan, upsertPlan, removePlan, resolveWingLabel, normalizeSquadPlans } from "../lib/squadPlanner";
  import "../app.css";

  // Preset accent colors for the Appearance palette (click = instant re-skin).
  const ACCENT_PRESETS = [
    "#6366f1", // indigo (default)
    "#10b981", // emerald
    "#f59e0b", // amber
    "#ec4899", // rose
    "#06b6d4", // cyan
    "#8b5cf6", // violet
    "#ef4444", // red
    "#14b8a6", // teal
  ];

  // ─── Runtime / type imports ─────────────────────────────────────────

  interface PlayerInfo {
    display_name: string;
    account: string;
    profession: number;
    elite_spec: number;
    role: string;
    subgroup: number;
    dps?: number;
    cleave_dps?: number;
  }

  interface UploadRecord {
    file_name: string;
    file_path: string;
    timestamp: string;
    status: string;
    stage?: string;
    subfolder_id?: string | null;
    url?: string;
    boss_name?: string;
    success?: boolean;
    duration?: number;
    duration_seconds?: number;
    is_cm?: boolean;
    is_lcm?: boolean;
    is_quick_play?: boolean;
    local_fallback?: boolean;
    num_players?: number;
    players?: PlayerInfo[];
    error_msg?: string;
    boss_hp_left?: number;
    is_convergence?: boolean;
    boss_duration?: number;
    group_dps?: number; // Kitty Golem group DPS (badge, golem-only for now)
    is_story?: boolean; // true => story instance (Personal Story grouping)
    map_id?: number; // story instance map id (stable classification key)
    is_wvw?: boolean; // World vs World log
    notes?: LogNote[];
    wingman_status?: string | null;
    /// Discord webhook delivery state: undefined/null = n/a, true = pending re-send
    /// (last send failed; retried on next successful upload of this log), false = delivered.
    discord_pending?: boolean | null;
    /// Set of VL rank ids awarded to this log (a log can earn more than one rank).
    /// Stored as an array; older data with a single string is migrated on load.
    vl_rank?: string[] | string | null;
    /// Harvest Temple (Dragonvoid) multi-dragon HP breakdown. Present only for
    /// that strike; null for every other encounter. `order` is the canonical
    /// fight sequence (Jormag → Primordus → Kralkatorrik → Zhaitan → → Soo-Won → Mordremoth).
    bosses_hp?: DragonHp[] | null;
    /// Harvest Temple (Dragonvoid) add-species evidence from local EVTC: per-add
    /// `died` flag and last-seen `hp_left`. Present only for Dragonvoid local-fallback
    /// or direct enriched logs; undefined/absent otherwise.
    dragonvoid_add_evidence?: {
      died: Record<string, boolean>;
      hp_left: Record<string, number>;
    } | null;
    cerus_empowered_stacks?: number;
    /// Conjured Amalgamated arm breakdown (Normal + CM). Present only for CA
    /// logs; undefined otherwise. `body_hp_left` is the boss body HP; the arm
    /// fields are each arm's remaining HP. An arm at <=1% is "Killed" (this
    /// covers a near-dead arm that regenerates — 1% is treated as gone).
    ca_arms?: {
      body_hp_left: number;
      right_arm_hp_left: number;
      left_arm_hp_left: number;
    } | null;
    /// Twin Largos individual-twin HP (Normal + CM). Present only for Twin Largos
    /// logs; undefined otherwise. `null` for a twin NOT engaged at wipe
    /// (phase-1/2 single-twin phase). Each field is percent remaining; <=1% is
    /// "Killed".
    twin_largos?: {
      nikare_hp_left: number | null;
      kenut_hp_left: number | null;
    } | null;
    /// Statue of Darkness (Eyes of the Statue) individual-eye HP. Present only
    /// for Statue of Darkness logs; undefined otherwise. `null` for an eye NOT
    /// engaged at wipe. Each field is percent remaining; <=1% is "Killed".
    eyes?: {
      darkness_hp_left: number | null;
      despair_hp_left: number | null;
    } | null;
    /// Voice & Claw of the Fallen individual-entity HP. Present only for Voice
    /// and Claw logs; undefined otherwise. `null` for an entity NOT engaged at
    /// wipe. Each field is percent remaining; <=1% is "Killed".
    voice_claw?: {
      voice_hp_left: number | null;
      claw_hp_left: number | null;
    } | null;
    /// Aetherblade Hideout final-boss HP. Present only for Aetherblade Hideout
    /// logs; undefined otherwise. Shows Mai Trin's HP when the group wiped on
    /// her (phase 1, she stalls at ~10%), else Echo of Scarlet's HP (phase 2).
    /// `null` for an entity NOT engaged. Each field is percent remaining; <=1%
    /// is "Killed".
    aetherblade?: {
      maitrin_hp_left: number | null;
      scarlet_hp_left: number | null;
    } | null;
    /// Old Lion's Court Watchknight HP. Present only for Old Lion's Court logs;
    /// undefined otherwise. `phase` is the wipe phase number (1-indexed). Each
    /// field is a Watchknight's percent remaining; `null` if that Watchknight
    /// was never engaged at wipe. `cc_wipe` is true when the wipe happened
    /// during a Puzzle/CC phase.
    old_lions_court?: {
      phase: number;
      cc_wipe: boolean;
      vermilion_hp_left: number | null;
      indigo_hp_left: number | null;
      arsenite_hp_left: number | null;
    } | null;
    /// Ura CM/LCM health regeneration phase tracking.
    /// "AHR" = After Health Regeneration (Ura has healed past 1%, no more regen).
    ura_health_regen?: string;
  }
  interface DragonHp {
    key: string;        // stable id, e.g. "jormag"
    name: string;       // display name, e.g. "Jormag"
    hp_left: number;    // percent 0..100
    died: boolean;      // true => reached and defeated
    order: number;      // canonical fight index
    icon?: string | null; // optional /bosses icon override (interphase chips)
  }
  // Full Harvest Temple timeline element (dragons + interphases), in left→right
  // fight order. `icon` (when set) resolves to /bosses/{icon}.png; otherwise the
  // default the{key}void.png dragon icon is used. `kind`: "dragon" | "heart" | "miniboss".
  interface DragonPhase {
    key: string;
    name: string;
    icon?: string | null;
    kind: string;
    cleared: boolean;   // false => reached but not cleared (wipe point / in progress)
    order: number;
    raw: string;
  }
  interface LogNote {
    id: string;
    text: string;
    created_at: string;
  }

  interface SavedSession {
    id: string;
    name: string;
    color: string;
    logs: UploadRecord[];
    subfolders?: { id: string; name: string; color: string; logs: UploadRecord[] }[];
  }

  // ─── Settings State ────────────────────────────────────────────────
  let logs_directory = $state("");
  let dps_report_token = $state("");
  let discord_webhook = $state(""); // legacy single-url (kept for compat; UI uses discord_webhooks)
  let discord_webhooks = $state<Array<{ id: string; label: string; url: string; enabled: boolean; mention_roles: Array<{ label: string; token: string }>; mention?: string | null; thread_id: string | null; filters: { kinds: string[]; outcomes: string[]; only_cm: boolean | null; only_lcm: boolean | null; bosses: string[] }; _showFilters?: boolean; _collapsed?: boolean; _showAdvanced?: boolean; _roleFormOpen?: boolean }>>([]);
  // Tier 1 (2026-07-23): transient per-webhook UI state, kept OUT of persisted config.
  let whTest = $state<Record<string, { status: "idle" | "testing" | "ok" | "err"; msg: string }>>({});
  let whThreadHelp = $state<Record<string, boolean>>({});
  let auto_upload = $state(true);
  let autostart = $state(false);
  let wingman_enabled = $state(false);
  let wingman_account = $state("");
  let wvw_enabled = $state(false);
  let use_backup_dps = $state(true);
  let max_concurrent_uploads = $state(2);
  let watch_stability_delay_ms = $state<number>(500);
  let max_upload_retries = $state<number>(3);
  let min_log_seconds = $state<number>(0);
  let log_cache_max_files = $state<number>(50);
  let reduce_motion = $state(false);
  let hide_on_startup = $state(false);
  let compact_mode = $state(false);
  let accent = $state("var(--accent)");
  let app_font = $state("inter-outfit");
  let sidebarOpen = $state(true);
  let activeMenuCard = $state<string | null>(null);
  let gw2_accounts = $state<any[]>([]);
  let logCacheSize = $state<number>(0);
  let logCacheCount = $state<number>(0);
  let showClearCacheModal = $state(false);
  let historyCacheSize = $state<number>(0);
  let historyCacheCount = $state<number>(0);
  let showClearHistoryModal = $state(false);
  // Set true once loadConfig() has finished hydrating state from disk, so the
  // autosave $effect below doesn't fire (and rewrite disk) with empty defaults
  // during startup. Prevents a race where the first computed read re-saves a
  // half-hydrated config.
  let configLoaded = $state(false);
  // Debounce timer for the global settings autosave (persistConfig) so a burst
  // of setting changes (e.g. typing a numeric field) only writes disk once.
  let configSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let activeTab = $state("feed");
  let navLinksEl = $state<HTMLElement | null>(null);
  let footerNavEl = $state<HTMLElement | null>(null);
  let tabIndicator = $state({ left: 0, top: 0, width: 0, height: 0, visible: false });
  let footerIndicator = $state({ left: 0, top: 0, width: 0, height: 0, visible: false });
  function updateTabIndicator() {
    const top = navLinksEl?.querySelector<HTMLElement>(".nav-btn.active") ?? null;
    const foot = footerNavEl?.querySelector<HTMLElement>(".nav-btn.active") ?? null;
    const active = top ?? foot;
    if (!active) {
      tabIndicator = { ...tabIndicator, visible: false };
      footerIndicator = { ...footerIndicator, visible: false };
      return;
    }
    const rect = { left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight, visible: true };
    if (top) { tabIndicator = rect; footerIndicator = { ...footerIndicator, visible: false }; }
    else { footerIndicator = rect; tabIndicator = { ...tabIndicator, visible: false }; }
  }
  // Re-measure whenever the active tab (or sidebar layout) changes.
  $effect(() => { activeTab; queueMicrotask(updateTabIndicator); });
  // Re-measure once on mount (fonts/layout settle).
  onMount(() => requestAnimationFrame(updateTabIndicator));

  // ── Subfolder sliding underline indicator (mirrors nav-tab-indicator motion) ──
  let subfolderTabsEl = $state<HTMLElement | null>(null);
  let subfolderIndicator = $state({ left: 0, top: 0, width: 0, visible: false });
  function toggleArr(arr: string[], v: string) {
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
  }
  function updateSubfolderIndicator() {

    const active = subfolderTabsEl?.querySelector<HTMLElement>(".subfolder-tab.active, .filter-btn.tab.active") ?? null;
    const container = subfolderTabsEl;
    if (!active || !container) { subfolderIndicator = { ...subfolderIndicator, visible: false }; return; }
    // Anchor to the active tab's own row (handles flex-wrap: wrap).
    const top = active.offsetTop + active.offsetHeight - 2;
    subfolderIndicator = {
      left: active.offsetLeft,
      top,
      width: active.offsetWidth,
      visible: true,
    };
  }
  $effect(() => { subFolderId; queueMicrotask(updateSubfolderIndicator); });
  onMount(() => requestAnimationFrame(updateSubfolderIndicator));

  let isSaving = $state(false);
  let saveMessage = $state("");
  let manualFilePath = $state("");
  let manualUploadError = $state("");
  let manualUploadSuccess = $state("");
  let isDragging = $state(false);
  let expanded = $state<Record<string, boolean>>({});
  let notesOpen = $state<Record<string, boolean>>({});
  let kaiPhasesCollapsed = $state(true);
  // Live Wingman retry UI state per log path: null = idle, 'sending' = in-flight.
  // The persistent record.wingman_status drives 'failed'/'done'; this only adds the
  // transient 'sending' phase so the animation can play in every view without polling.
  let wingmanUi = $state<Record<string, "sending" | null>>({});

  // Serial retry queue: drains failed Wingman imports one at a time (with a gap)
  // so N clients recovering simultaneously don't stampede the server. Concurrency 1.
  const WM_SEND_GAP_MS = 2000;
  let wingmanQueue = $state<string[]>([]);
  let wingmanQueueRunning = $state(false);
  let wingmanQueueDone = $state(0);

  // Mirror of the Wingman queue, but for dps.report On Hold logs. Re-uploads parked
  // logs one at a time (gap spacing) so recovery doesn't stampede dps.report. The
  // x/total counter drives the "Re-uploading x/total" line below the dps.report API.
  const DPS_RETRY_GAP_MS = 2000;
  let dpsQueue = $state<string[]>([]);
  let dpsQueueRunning = $state(false);
  let dpsQueueDone = $state(0);

  // ── Global Upload Queue (visible on every tab) ──────────────────────────
  // Mirrors the Rust-side queue snapshot: every pending (queued + active) log,
  // not just the active uploads. Driven by the `queue-status` event so it stays
  // live without polling. `uploadPaused` reflects the Rust pause gate.
  type QueueEntry = { file_path: string; file_name: string; state: "queued" | "active" | "done" | "skipped" };
  let uploadQueue = $state<QueueEntry[]>([]);
  let uploadPaused = $state(false);
  let queueDrawerOpen = $state(false);
  // Drag-in cascade: set true briefly when logs land so the queue bar animates.
  let queuePulse = $state(false);
  let queuePulseTimer: ReturnType<typeof setTimeout> | null = null;
  function pulseQueue() {
    queuePulse = true;
    if (queuePulseTimer) clearTimeout(queuePulseTimer);
    queuePulseTimer = setTimeout(() => { queuePulse = false; }, 600);
  }
  let queuedCount = $derived(uploadQueue.filter((q) => q.state === "queued").length);
  let activeCount = $derived(uploadQueue.filter((q) => q.state === "active").length);
  let doneCount = $derived(uploadQueue.filter((q) => q.state === "done").length);
  let skippedCount = $derived(uploadQueue.filter((q) => q.state === "skipped").length);

  async function togglePauseUploads() {
    try {
      if (uploadPaused) await invoke("resume_uploads");
      else await invoke("pause_uploads");
    } catch (e) { console.error("pause/resume uploads failed", e); }
  }

  function enqueueDpsRetry(file_path: string) {
    if (!dpsQueue.includes(file_path)) {
      const freshBatch = dpsQueue.length === 0 && !dpsQueueRunning;
      dpsQueue = [...dpsQueue, file_path];
      if (freshBatch) dpsQueueDone = 0; // reset progress for a new drain
    }
    processDpsQueue();
  }

  async function processDpsQueue() {
    if (dpsQueueRunning) return;
    if (dpsQueue.length === 0) return;
    const dpsStatus = (dpsReportStatus as string);
    // Pause during any non-online dps.report state; queue persists until recovery.
    if (dpsStatus !== "online") return;
    dpsQueueRunning = true;
    try {
      while (dpsQueue.length > 0) {
        const dpsStatusNow = (dpsReportStatus as string);
        if (dpsStatusNow !== "online") break; // pause; remaining stays queued
        const fp = dpsQueue[0];
        await invoke("trigger_manual_upload", { filePath: fp })
          .catch((e) => console.error("dps.report retry failed:", e));
        // After the upload attempt, inspect the live feed/history record for this path.
        // A terminal/logless state means this queue slot is resolved—drain it so the
        // sidebar counter doesn't persist after success (including 422 duplicate).
        const record = uploads.find((u) => u.file_path === fp) ?? allHistory.find((h) => h.file_path === fp);
        const terminal = !record || ["Completed","Duplicate","Failed","On Hold","Processing","Skipped"].includes(record.status);
        if (terminal) {
          dpsQueueDone += 1;
          dpsQueue = dpsQueue.slice(1);
        } else {
          // Leave it in place for a later recovery retry; avoid counting unfinished logs.
        }
        await new Promise((r) => setTimeout(r, DPS_RETRY_GAP_MS)); // spacing + UI paint
      }
    } finally {
      dpsQueueRunning = false;
    }
  }

  function enqueueWingmanRetry(file_path: string) {
    if (wingmanQueue.includes(file_path)) return;
    const freshBatch = wingmanQueue.length === 0 && !wingmanQueueRunning;
    wingmanQueue = [...wingmanQueue, file_path];
    if (freshBatch) wingmanQueueDone = 0; // reset progress for a new drain
    processWingmanQueue();
  }

  async function processWingmanQueue() {
    if (wingmanQueueRunning) return;
    if (wingmanQueue.length === 0) return;
    wingmanQueueRunning = true;
    try {
      while (wingmanQueue.length > 0) {
        if ((wingmanStatus as string) === "offline") {
          // Wingman is down: sleep briefly and re-check instead of abandoning
          // the queue. When it recovers, draining resumes automatically with
          // normal spacing. Without this, queued items would stall forever.
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        const fp = wingmanQueue[0];
        wingmanUi[fp] = "sending";
        await invoke("retry_wingman_import", { filePath: fp })
          .catch((e) => console.error("Wingman retry failed:", e))
          .finally(() => { wingmanUi[fp] = null; });
        wingmanQueueDone += 1;
        wingmanQueue = wingmanQueue.slice(1);
        await new Promise((r) => setTimeout(r, WM_SEND_GAP_MS)); // spacing + UI paint
      }
    } finally {
      wingmanQueueRunning = false;
    }
  }

  // Manual retry: enqueue instead of firing immediately (subsumes the offline
  // guard — queued items simply wait for recovery).
  function sendToWingman(file_path: string) {
    if (wingmanUi[file_path] === "sending") return;
    enqueueWingmanRetry(file_path);
  }

  // On Wingman recovery, sweep all failed logs into the queue. Jitter spreads
  // client start times so recovery doesn't trigger a synchronized herd.
  function enqueueAllFailedOnRecovery() {
    const failed = allHistory
      .filter((h) => h.wingman_status === "failed")
      .map((h) => h.file_path);
    if (failed.length === 0) return;
    const jitter = Math.floor(Math.random() * 15000);
    setTimeout(() => { for (const fp of failed) enqueueWingmanRetry(fp); }, jitter);
  }

  // Manual "Retry all failed" (sidebar button): enqueue every failed log NOW,
  // no jitter — the user explicitly asked, so no herd-avoidance delay needed.
  // NOTE: failedWingmanCount ($derived on allHistory) is defined after allHistory
  // is declared, further down — it can't live here (used-before-declaration).
  function retryAllFailedWingman() {
    for (const h of allHistory) {
      if (h.wingman_status === "failed") enqueueWingmanRetry(h.file_path);
    }
  }

  // Plain-language failure hints for common backend/network issues.
  function likelyCause(log: UploadRecord): string | null {
    const raw = (log.error_msg ?? "") as string;
    const r = String(raw).toLowerCase();
    if (!raw) return null;
    if (/already upload|422|duplicate|exists/i.test(r)) return "This log was already uploaded to dps.report.";
    if (/wingman|gw2wingman/i.test(r) && /offline|unreachable|5\d\d|connect/i.test(r)) return "GW2 Wingman is unreachable right now.";
    if (/dps\.report|uploadcontent|5\d\d|connect/i.test(r)) return "dps.report is unreachable right now.";
    if (/timeout|timed?\s*out/i.test(r)) return "The upload took too long — likely a temporary network hiccup.";
    if (/eiu|elite\s*insight|pars/i.test(r)) return "Elite Insights couldn’t parse this log.";
    if (/io|enoent|eacces|permission|read/i.test(r)) return "The app couldn’t read the log file.";
    if (/cancel|cancelled/i.test(r)) return "The upload was cancelled before it finished.";
    return raw;
  }

  // ─── Void Lounge (VL) ranks ────────────────────────────────────────────────
  interface VlRankDef {
    id: string;
    label: string;
    icon: string;
    text_color: string;
    bg_color: string;
    description: string;
    auto: string | null;
  }
  interface VlEncounter {
    key: string;
    display: string;
    ranks: VlRankDef[];
    aliases?: string[];
  }
  let vlCatalog = $state<VlEncounter[]>([]);
  invoke("get_vl_rank_catalog").then((c) => { vlCatalog = c as VlEncounter[]; }).catch(() => {});

  // Installed app version (from tauri.conf.json), shown in Settings next to "Check for updates".
  let appVersion = $state<string>("…");
  getVersion().then((v) => { appVersion = v; }).catch(() => {});

  // Update native window title with version when appVersion changes
  $effect(() => {
    if (appVersion && appVersion !== "…") {
      getCurrentWindow().setTitle(`Portal Protocol v${appVersion}`).catch(() => {});
    }
  });

  // Patch notes versions registry (newest first). `image` is an optional
  // screenshot bundled in /static, shown above the notes in the modal + history panel.
  type PatchNoteItem = { title: string; desc: string };
  type PatchNoteCategory = { category: string; items: PatchNoteItem[] };
  type PatchNoteVersion = { version: string; date: string; image?: string; notes: PatchNoteCategory[] };
  const PATCH_NOTES_DATA: PatchNoteVersion[] = [
    {
      version: "0.7.0",
      date: "September 17, 2026",
      notes: [
        {
          category: "🐞 Bug Fixes",
          items: [
            { title: "Xunlai Junkyard Daily Raid Badge", desc: "Fixed a name mismatch that prevented Xunlai Jade Junkyard from being marked as 'DAILY' in the Clears tab. The boss card label now matches the official encounter name from dps.report, so the daily raid rotation badge fires correctly." },
            { title: "Subfolder Deletion Fixed", desc: "Completely redesigned subfolder controls: replaced the buggy kebab menu with a clean X button (appears on hover) for one-click deletion, and double-click on the subfolder name for inline renaming. The old menu had click handlers that silently failed due to Svelte 5 conditional rendering issues." }
          ]
        }
      ]
    },

    {
      version: "0.6.9",
      date: "September 16, 2026",
      notes: [
        {
          category: "✨ New Features",
          items: [
            { title: "Nexus of Eternity in Weekly Clears Tab", desc: "Added Nexus of Eternity (Vloxx) raid encounter to the weekly Clears tracking tab under the Visions of Eternity grouping. Your clears will now be tracked and displayed correctly." },
            { title: "Updated Elite Insights to v3.29", desc: "Updated the bundled Elite Insights parser to version 3.29." }
          ]
        },
        {
          category: "🎨 UI Enhancements",
          items: [
            { title: "Parallel Parsing & Upload", desc: "The app now Parses the log and Uploads it to dps.report simultaneously, so the permalink appears as soon as the upload completes — no need to wait for EI parsing to finish." },
            { title: "Settings Scroll Performance", desc: "Improved the settings code to make the Settings much more smoother while scrolling. Removed redundant array spreading from webhook inputs and added CSS containment for better GPU compositing." },
            { title: "Sticky Pagination Bar", desc: "History tab pagination bar now sticks to the bottom of the viewport, so you can navigate pages without scrolling all the way down." },
            { title: "Settings Button Styling", desc: "Updated the Export Settings, Import Settings, Open Settings Folder, Save Settings, Check for updates, and Reset saved window size/position buttons to use a consistent indigo accent style, while keeping red for destructive actions like Clear Cache and Clear History." },
            { title: "Visual Refinements", desc: "Refined UI animations, hover effects, and visual feedback throughout the app." }
          ]
        },
        {
          category: "🐞 Bug Fixes",
          items: [
            { title: "Boss HP Display Fixed", desc: "Fixed boss name parsing mismatch that caused some encounters with multiple HP bars (Twin Largos, Eyes of Fate/Judgement, Old Lion's Court) to not display all target HP values correctly." }
          ]
        }
      ]
    },
    {
      version: "0.6.8",
      date: "September 15, 2026",
      notes: [
        {
          category: "✨ New Features",
          items: [
            { title: "Quick Play Mode Support", desc: "It now detects QP buffs (77676, 79492) on eligible Fractals and Strikes and properly display a Quick Play badge on log cards" },
            { title: "Kaineng Overlook Multi-Phase Support", desc: "Kaineng Overlook logs now display a full phase timeline when the group wipes. Each phase shows the targets engaged (Minister Li, Enforcer/Mindblade/Ritualist split, Mech Rider/Sniper split), their HP at wipe, and whether the phase was cleared. Only shown on wipe logs — kill logs keep the compact full-fight view." },
            { title: "Ura CM/LCM Health Regeneration Badge", desc: "Added support to Ura CM and LCM logs when the boss health regenerates. The app correctly displays a badge next to the HP% Left if Ura reaches 1% and regenerates its health." },
            { title: "Nexus of Eternity Strike Added", desc: "Added support for the new Nexus of Eternity strike (Vloxx) under the Visions of Eternity grouping. Logs now display the correct boss name, header, and icon." }
          ]
        },
        {
          category: "🐞 Bug Fixes",
          items: [
            { title: "Convergences CM Time Display Fixed", desc: "Convergence CM logs now correctly display both 'Total Convergence Time' (the full instance duration from first pull to final wipe) and 'Total Boss Time' (the specific boss fight duration). Previously, only the boss time was shown as the total time, making it appear shorter than the actual convergence run." }
          ]
        },
        {
          category: "✨ UI Polish & Visual Enhancements",
          items: [
            { title: "Smooth Entrance Animations", desc: "Log cards now slide up with a staggered entrance animation when they appear in the feed. Mode badges (CM, LCM, QP, AHR) pop into view with a spring effect." },
            { title: "Button Press Feedback", desc: "All buttons now scale down and fade slightly when pressed, giving instant tactile feedback that your action registered." },
            { title: "Upload Stage Transitions", desc: "The upload stepper stages now transition smoothly between states instead of hard-cutting." },
            { title: "Success/Error State Animations", desc: "Status indicators now animate — a pop effect for successes and a shake for errors." },
            { title: "AHR Badge Pulse", desc: "The AHR (After Health Regeneration) badge pulses with a subtle glow ring when it first appears on a log card." },
            { title: "Kaineng Phase Accordion", desc: "Kaineng Overlook phases now slide in with a staggered animation and the toggle button has press feedback." },
            { title: "Focus Ring Animation", desc: "Input fields and textareas now show an animated accent-colored focus ring when selected." },
            { title: "Checkbox Spring", desc: "Checkboxes now have a subtle bounce animation when toggled." }
          ]
        }
      ]
    },
    {
      version: "0.6.7",
      date: "August 23, 2026",
      notes: [
        {
          category: "📊 Analytics",
          items: [
            { title: "Cerus Leaderboard", desc: "Filter the Analytics tab to a Cerus fight (CM, LCM, or Normal) and a new Cerus Leaderboard appears with a Load button. Click it to aggregate every matching log in your history into one per-player ranking — Orbs collected, Cry of Rage hits, Envy Wall strips, Malice damage, and Avg DPS (the same Avg DPS source as the Top Players chart) — plus cohort cards with mini per-log sparklines (Orb Efficiency, Total Orbs, Empowered Gained, Rage Hits, Shadows Reached, Players Stripped, Boons Corrupted, and a new Best Pull = the lowest boss HP% left across your selected logs). It builds only when you click Load, so changing filters never lags the app, and the numbers stay put until you reload. Built on demand from your logs (dps.report / local EI); no new uploads needed." },
            { title: "Profession Filter on Analytics", desc: "The Analytics tab now has its own Professions filter (the same two-step core → elite-spec picker used in Feed/History). Picking a core profession or a specific elite spec narrows every aggregate — Total Encounters, Kill Rate, Squad Composition, Wipe Depth, Boss Breakdown, and the comparison DPS series — to logs containing that profession." },
            { title: "Profession Icons in Comparison Chart", desc: "Hovering a point in the Player Performance Comparison chart now shows a row per player ordered as colored dot → profession icon → toon name → account name, with the DPS value on the right. The profession icon is the player's elite-spec icon when they run one, otherwise their core profession icon, so you can tell specs apart at a glance." },
            { title: "Elite Specs in Squad Composition", desc: "The Squad Composition chart now breaks the squad down by elite specialization (e.g. Scourge, Dragonhunter, Firebrand) instead of only core professions, so you can see exactly which specs your group brings. Core players still appear under their core profession name, and each spec keeps its core profession color." }
          ]
        },
        {
          category: "✨ Enhancements",
          items: [
            { title: "Boon Uptime & Mechanics Tabs Moved to the Top", desc: "Inside the Combat Stats modal, the Boon Uptime tab (and the Statistics / Revealed / Shadows / Orbs / Empowered tabs on Cerus) now live in a horizontal tab strip across the top of the modal instead of a left sidebar. The table gets the full width, so more boon columns fit without crowding." },
            { title: "Golem DPS Badge", desc: "Kitty Golem log cards now show a Damage Dealt badge next to the fight duration — the full, un-abbreviated squad DPS for that log (e.g. 35,257, not 35k). It's accent-outlined with a rounded-square shape and a profession icon, and only appears on golem logs." }
          ]
        },
        {
          category: "🐞 Bug Fixes",
          items: [
            { title: "Close-Spawn vs Walk-in Now Split Correctly on the Shadow Timeline", desc: "On the Cerus Statistics fight-timeline chart, every shadow that reached the boss was being labelled a 'Close Spawn' with a player name — even ones that actually spawned far away by the door and walked in. The chart now distinguishes the two by where the malice was DROPPED: if it spawned within 250u of Cerus (a real placement mistake) the dot is orange and reads 'Malice Dropped Near Boss — Player' (showing the player's toon name); if it spawned far and the squad failed to stop it, the dot is purple and reads 'Shadow Reached Boss' with no player blamed. Verified against the replay: a shadow that reached Cerus at 5:56 was a walk-in, not a close spawn, and now shows correctly without naming anyone." },
            { title: "Boon Uptime Now Matches dps.report", desc: "The Boon Uptime tab was dividing uptime by the whole fight length (dps.report's 'Phase Duration' — which counts time you were dead or downed), so a player who died showed a falsely low % (e.g. 93% instead of 94%). It now uses 'Phase Active Duration' — only the time you were alive and in combat — which is the fair measure of boon-keeping and the number dps.report quotes as its headline. Both denominators exist in the data: Phase Duration = % of the entire log the boon was up; Phase Active = % of your alive/in-combat time the boon was up. We switched to Phase Active because deaths shouldn't punish your boon keepers' numbers." },
            { title: "Rage Hits Now Show Per Player", desc: "On the Cerus Stats → Squad Mechanics table, the Cry of Rage Hits column was stuck at 0 even when the 'Squad Rage Hits' card said someone failed the dome. It was reading each player's damage taken and dropping any hit under 20k — but on CM the Cry of Rage tick is ~11k, so real failures vanished. The column now reads the same dome-failure event the card uses, so they always agree (e.g. a player who actually failed the dome now correctly shows 1)." },
            { title: "Late Shadows No Longer Counted as Orbs", desc: "On Cerus, Malicious Shadows that reached the boss near the end of the fight were being mis-counted as 'Orbs +5 stacks' instead of Shadows Reached. The shadow detector only looked 20s after each shadow spawned, but end-of-fight shadows walk in and consume orbs 40–60s later, so their empowered gains fell outside the window and landed in the orb pile. The window now reaches the end of the fight, so late shadows are correctly counted as Shadows Reached (e.g. a log that showed 1 shadow now correctly shows 3)." }
          ]
        }
      ]
    },
    {
      version: "0.6.6",
      date: "August 22, 2026",
      notes: [
        {
          category: "🐞 Bug Fixes",
          items: [
            { title: "Cerus Petrified Rank Fixed", desc: "On Cerus CM logs, the Petrified rank was wrongly awarded even when the fight ended above 50% HP. You now only earn it if the boss actually drops to 50% or below with 10 or fewer Empowered stacks. Any logs already in your history that got it by mistake are automatically corrected on next launch." }
          ]
        }
      ]
    },
    {
      version: "0.6.5",
      date: "August 22, 2026",
      image: "/patch_notes/uploadviewer.png",
      notes: [
        {
          category: "🐞 Bug Fixes",
          items: [
            { title: "Upload Queue Shows Every Log You Drag", desc: "When you dragged several logs at once, any that were already in your Uploads History vanished from the queue drawer — only the new ones showed. The drawer now registers every dropped file the moment it arrives, so the whole batch is visible. Logs you've already uploaded stay in the drawer as a 'Skipped' row (amber) for a few seconds so you can see they were caught by the dedupe, and finished logs linger briefly as 'Done' before clearing." },
            { title: "Qadim the Peerless No Longer Tagged as Daily", desc: "In the Raid Tracker, Qadim the Peerless was wrongly showing a 'DAILY' badge on days when only the regular Qadim is the daily raid bounty. The badge now matches the boss exactly by name, so a boss only gets the DAILY tag when it's actually the daily — Qadim the Peerless is no longer confused with Qadim." }
          ]
        },
        {
          category: "✨ Enhancements",
          items: [
            { title: "Configurable Log Cache Cap (Storage Settings)", desc: "The dps.report Log Cache used to silently cap at a hard-coded 50 files. Storage & Cache Maintenance now has a 'Max Cached Logs to Keep' slider (0–200, default 50) so you control how many parsed logs stay on disk for instant Stats re-opening. A hover tooltip (the ⓘ next to the label) explains what it does: higher keeps more history ready, lower saves disk, and 0 = keep everything (unbounded). Moving the slider prunes older cached logs immediately, and the live count updates right away." }
          ]
        }
      ]
    },
    {
      version: "0.6.4",
      date: "August 22, 2026",
      notes: [
        {
          category: "🐞 Bug Fixes",
          items: [
            { title: "Player Deselect Now Sticks", desc: "In the Player Performance Comparison, removing a player with the ✕ on the chip or unchecking them in the 'Compare Players' dropdown used to get silently undone by the auto-fill — so the name snapped right back. The auto-fill now only re-seeds when you change the boss/mode/date scope, never on a manual add/remove, so a player you drop stays dropped until you pick a new filter." },
            { title: "Comparison Auto-Fills on Date Range", desc: "The chart only auto-populated when you selected a specific Boss. Picking a custom date range (with boss left on 'All') stayed empty. It now seeds the top-DPS players for any meaningful scope — a specific boss, a specific mode, or a custom date window — and re-seeds when you change that scope." },
            { title: "Compare Players Menu No Longer Clips Off-Screen", desc: "On a narrow window the 'Compare Players' dropdown opened leftward and got cut off at the left edge. It now flips to grow rightward from the button when there isn't room, and re-positions live as you resize the window with the menu open." }
          ]
        },
        {
          category: "✨ Enhancements",
          items: [
            { title: "Color-Coded Boon Uptime", desc: "The Boon Uptime table in the Combat Stats modal now tints each uptime cell by how well the boon was kept up — green (≥90%), yellow-green (80–89%), amber (50–79%), and red (below 50%) — so you can spot under-covered boons at a glance. Might is shown by stack count and isn't color-graded." },
            { title: "Filter Boon Uptime by Subgroup", desc: "Subgroup chips (All | 1 | 2 …) sit above the Boon Uptime table — click one to show only that subgroup's players, and use each subgroup row's chevron to collapse it. Sorting still mirrors the DPS/Cleave columns." }
          ]
        }
      ]
    },
    {
      version: "0.6.3",
      date: "August 20, 2026",
      notes: [
        {
          category: "🐞 Bug Fixes",
          items: [
            { title: "Whisper of Jormag No Longer Shows Dragon Council", desc: "The Harvest Temple 'Dragon Council' strip was wrongly appearing on Whisper of Jormag (and other Icebrood Saga strikes whose phases contain a dragon fragment). It's now gated to The Dragonvoid only, on both the backend and frontend — so already-uploaded logs stop showing it without needing a re-import." },
            { title: "Uploads Feed Delete No Longer Says 'From History'", desc: "The 'Remove group' confirmation in the Uploads Feed said the logs would be deleted 'from history'. The Feed and History Log are separate lists, so the text now correctly says the group is removed from the Uploads Feed view and stays in Uploads History." },
            { title: "Conjured Amalgamated Shows Real HP Left on a Fail", desc: "On a failed Conjured Amalgamated log the card always showed 100% HP Left. Elite Insights reports HP per fight-form, and the app was only reading the first form — which is the un-reached one on a wipe. It now reads the last form the group actually fought, so the HP Left matches the phase you wiped on." },
            { title: "Removed HP Left on Pre-Events", desc: "The card and Discord formatter were showing a '% HP Left' on encounters that have no boss. This is now hidden for the non-boss pre-events — Spirit Run (W1), Twisted Castle, River of Souls, Gate Wing 7, and Personal Story — so they show success/fail only, with no misleading HP percentage." }
          ]
        },
        {
          category: "✨ Enhancements",
          items: [
            { title: "Added Support for Conjured Amalgamated", desc: "Conjured Amalgamated is now fully supported in Portal Protocol (both Normal and Challenge Mode). On a wipe the card shows the boss's real HP Left, and it now also displays each arm's health — Right Arm and Left Arm HP Left, each with a fist icon — so you can see exactly which arm you were engaging when you wiped. A destroyed arm (or one down to ~0%) shows as 'Killed Right/Left Arm'." },
            { title: "Added Individual HP Left for Twin Largos", desc: "Twin Largos (Normal and Challenge Mode) now shows each twin's HP individually on a wipe instead of a single combined percentage. During the one-at-a-time phases, only the twin you were actually fighting appears; once the fight splits into both twins, the card shows both Nikare and Kenut HP Left (or 'Killed' when a twin is at ~0%)." },
            { title: "Added Individual HP Left for Statue of Darkness (Eyes)", desc: "Statue of Darkness now shows each eye's HP individually on a wipe — the Eye of Fate and the Eye of Judgment each get their own HP Left line (or 'Killed' at ~0%). They weren't being detected before, so the card showed nothing." },
            { title: "Added Individual HP Left for Voice & Claw", desc: "Voice & Claw now shows each of the two Fallen keepers' HP separately on a wipe — the Voice and the Claw each get their own HP Left line (or 'Killed' at ~0%)." },
            { title: "Added HP Left for Aetherblade Hideout", desc: "Aetherblade Hideout now shows the right boss's HP Left on a wipe. The fight has two phases, so it shows Captain Mai Trin's HP Left when you wipe on phase 1 (she stalls around 10% and never reaches 0), and Echo of Scarlet's HP Left once you push into phase 2 — so the card matches the boss you actually fell to." },
            { title: "Local Parsing Now Prompts for .NET 8", desc: "Portal Protocol runs Elite Insights locally for richer log cards. EI is framework-dependent and needs the free .NET 8 Desktop Runtime. If it's missing, uploads still work (they fall back to dps.report) — and now the app shows a one-time notice with a direct download link so you can enable full local parsing. Dismiss it once and it stays gone." }
          ]
        }
      ]
    },
    {
      version: "0.6.2",
      date: "August 19, 2026",
      notes: [
        {
          category: "📊 Analytics Improvements",
          items: [
            { title: "Auto Top-4 DPS Comparison", desc: "The Player Performance chart now auto-selects your top 4 players by Avg DPS for the current filter, and re-selects them whenever you change the encounter or range — so it always opens with your best performers instead of one stale name. Picks you make manually are kept until you change them." },
            { title: "KPI Trend Arrows", desc: "The summary cards (Total / Kills / Wipes / Kill Rate / Avg Duration / Fastest Kill) now show a ▲/▼ vs the previous equal-length window (last 7/30/90 days). Green means good (more kills, faster, higher rate), red means bad (more wipes, slower)." },
            { title: "Richer Export Report", desc: "The exported Markdown report now includes a full Player Performance table with Avg DPS and Max DPS for every player in the filtered logs, plus the profession breakdown." },
            { title: "Insight Cards", desc: "Plain-language takeaways now appear above the summary cards: who leads Avg DPS, whether kill rate is up or down vs the previous window, and which boss you wiped on most." }
          ]
        },
        {
          category: "🕒 Filters & Comparison",
          items: [
            { title: "Time Range Filter", desc: "Filtering by date/time now respects Custom date ranges with optional Start/End time, and the Mode (CM/LCM) filter is applied correctly — so counts and charts match the logs you actually selected." },
            { title: "Comparison Only Shows Filtered Players", desc: "The Player Performance Comparison now only appears once a boss is selected, and its 'Compare Players' dropdown lists only the players present in the current filter's logs — no more names from unrelated runs." }
          ]
        },
        {
          category: "🕒 Custom Date Time Range",
          items: [
            { title: "Filter by Time, Not Just Day", desc: "Custom date ranges now include optional Start/End time inputs. Useful when you run the same boss with the same CM/LCM badge multiple times in one day — you can isolate a single run's window instead of the whole day." }
          ]
        },
        {
          category: "🐞 Bug Fixes",
          items: [
            { title: "Analytics Hover Tooltip No Longer Cut Off", desc: "In the Player Performance Comparison chart, the hover tooltip (player names, DPS, and character names) could get clipped at the left/right edges of the chart, hiding part of the text. The tooltip now measures its own width and clamps itself inside the chart, and flips below the dot when you hover near the top — so the full information always stays on screen." }
          ]
        }
      ]
    },
    {
      version: "0.6.1",
      date: "August 18, 2026",
      notes: [
        {
          category: "🐉 Challenge Mode Detection Fixes",
          items: [
            { title: "Minister Li, Keep Construct & Harvest Temple Marked Normal", desc: "These End-of-Dragons raid bosses were always detected as Normal even on CM clears. Fixed via each fight's own signal: Minister Li (CM species 24266), Keep Construct (CM HP vs Normal), Harvest Temple (CM-only add in the agent table)." },
            { title: "Old Logs Auto-Repaired", desc: "Already-uploaded logs wrongly flagged Normal are now fixed automatically on next launch — no delete/re-upload needed." }
          ]
        },
        {
          category: "🛠️ History Self-Heal",
          items: [
            { title: "Old Logs Repaired Automatically", desc: "If an already-uploaded log had the wrong Mode badge (Challenge vs Normal), the app now re-checks those logs against dps.report on launch and fixes the ones that are wrong — no need to delete and re-upload." },
            { title: "Why We Added It", desc: "Our Challenge Mode detection fixes only apply to brand-new uploads. The self-heal was added so your existing history gets corrected too, without any manual cleanup. It runs once, marks every record as verified, then stays quiet — it won't pop up again unless a new wrong badge appears." }
          ]
        },
        {
          category: "🔄 Automatic Update Notifications",
          items: [
            { title: "Update Toasts Without Restarting", desc: "The app now checks for new updates from the server once every hour while it's open." },
            { title: "No More Nagging", desc: "The hourly check toasts a version once, then relies on the persistent banner; it pauses during an in-progress install and never auto-downloads." }
          ]
        },
        {
          category: "♿ Accessibility & UI Polish",
          items: [
            { title: "Log Card Menus Now Speak", desc: "The 'More actions' (⋯) button on each log card now has a proper accessible name and announces whether the menu is open or closed — screen readers no longer just hear a silent 'button'." },
            { title: "ApiTracker & Analytics Are Keyboard-Friendly", desc: "Account tabs are now real tabs (announce the selected account), the remove-account ✕ and copy buttons have spoken labels, and live status (connected account, backfill progress) is announced as it changes." },
            { title: "Consistent Colors Under the Hood", desc: "Hard-coded colors in the main screen were swapped for the app's named design tokens. No visual change for you — but it keeps the UI consistent and makes future theming cleaner." },
            { title: "Large Histories Stay Snappy", desc: "We confirmed the upload feed and history lists are already capped and paginated, so a long upload history won't slow the app down." }
          ]
        },
        {
          category: "🐞 Appearance Fixes",
          items: [
            { title: "Color Dots Now Apply Correctly", desc: "Four of the preset accent dots (indigo, emerald, amber, red) were wired to CSS variable names instead of real colors, so picking them broke the app's accent. They're now proper colors and every dot in the palette works." },
            { title: "Custom Color Picker Is Now a Smooth Modal", desc: "The old native color picker was laggy because the browser rendered its popup on the same thread as the app and repainted everything while you dragged. It's now a custom modal (🎨 Accent Color) with preset dots, a hue slider, and a saturation/lightness square. While you drag, only the little preview chip inside the modal updates — the app and feed stay frozen — and your color is committed to the whole app in one shot when you hit Apply. No more lag." }
          ]
        }
      ]
    },
    {
      version: "0.6.0",
      date: "August 15, 2026",
      notes: [
        {
          category: "⚠️ Failed Logs Marked as Success — Global Fix",
          items: [
            { title: "Wrong Success on Every Failed Log", desc: "Fixed a bug where a failed run of ANY encounter was incorrectly marked as a successful kill. The local parser was double-converting the boss HP percentage (dividing an already-percentage value by 100 again), which pushed the remaining-HP check below the kill threshold on every wipe log and reported them as kills. The HP value is now used as-is (0–100%), so failed runs of all bosses correctly show as wipes and cleared runs as kills." },
            { title: "Re-Processing Already-Uploaded Logs", desc: "Logs uploaded before this update may still show the old incorrect 'Success' verdict. To fix them: delete the log from the Upload Feed, delete it from History, and delete the file from your saved Logs folder/subfolder (if you have log saving enabled). Then re-upload the log file — the fixed parser will mark it correctly." }
          ]
        }
      ]
    },
    {
      version: "0.5.9",
      date: "August 14, 2026",
      notes: [
        {
          category: "🛠️ Local Parser Enhancements",
          items: [
            { title: "Success Check & Qadim Kills", desc: "Added detection for server-side Reward events (CBTEVT_REWARD, statechange 22). Bosses like Qadim that transition to friendly NPCs at the end of the fight (e.g. leaving the boss at 0.20% HP) are now correctly evaluated as successful kills (0.00% HP) instead of being flagged as close wipes." },
            { title: "Cairn CM Detection", desc: "Added specialized buff scanning for Cairn CM. Because Cairn does not change health pools in CM (20M in both) and does not emit the generic CM statechange event, we now scan for the presence of Countdown (buff 38098) or Petrified (buff 38235) to identify Challenge Mode." },
            { title: "Deimos & Multi-Agent CM Checks", desc: "Fixed a bug where the parser stopped scanning at the first matching boss agent. For encounters with multiple addresses (like Deimos), the parser now checks all matching agents and selects the maximum health value, ensuring CM/LCM HP thresholds are correctly met." },
            { title: "Trimmed Fight Duration", desc: "Modified the local parser's fight duration estimation to identify the first actual combat event (is_statechange == 0) involving the boss, rather than using the generic log start timestamp. This trims pre-combat spawn delay and aligns the local estimate under 0.1 seconds of Elite Insights' combat duration, eliminating duration jumping between the upload phase and the resolved card." }
          ]
        },
        {
          category: "📊 Stepper & Active Uploads UI",
          items: [
            { title: "Real-time Metadata", desc: "Modified Svelte cards to display the actual boss icon, display name (e.g. Cardinal Adina Challenge Mode), and mode badges immediately after the local parse finishes (during the Parsing and Uploading stages). Previously, these details were hidden behind a generic cloud icon and the raw filename until dps.report resolved." }
          ]
        },
        {
          category: "⏱️ Fight Time Precision",
          items: [
            { title: "Duration Formatting", desc: "Changed duration rounding from nearest-second (Math.round) to truncation (Math.floor). This matches Elite Insights' duration reporting exactly (e.g. a fight lasting 05m 48s 628ms correctly shows as 5:48 instead of rounding up to 5:49)." }
          ]
        },
        {
          category: "🔁 Auto-Retry Queue Resumption",
          items: [
            { title: "Outage Recovery", desc: "Fixed a bug in the retry queue where paused manual retry uploads remained stuck after dps.report returned online. The app now restarts processing the upload queue immediately upon status recovery." }
          ]
        },
        {
          category: "🔄 Duplicate Upload Handling",
          items: [
            { title: "Stuck in Resolving State", desc: "Fixed a bug where duplicate uploads (422 status) from concurrent uploader programs got permanently stuck in the Duplicate — resolving... state. If dps.report detects a duplicate but the file is still actively processing (returning no permalink), the app now automatically retries the upload after a short backoff until the permalink becomes available." }
          ]
        },
        {
          category: "🧹 UI & Clears Tab Tweaks",
          items: [
            { title: "Clears Tab Dhuum Label", desc: "Renamed the label for Dhuum in the Clears tracking tab from Voice in the Void (Dhuum) to Dhuum for cleaner layout alignment." },
            { title: "Clears Tab Typography", desc: "Increased the font size of the boss names in the Clears tracking tab from 10px to 12px to improve scannability and legibility." }
          ]
        },
        {
          category: "🐉 Harvest Temple (The Dragonvoid) Dragon Council Fix",
          items: [
            { title: "Wrong Cleared Status on Failed Runs", desc: "Fixed a critical bug where dragons that were never actually defeated (e.g. Zhaitan and Giants on a failed run) were incorrectly displayed as Cleared with a checkmark in the Dragon Council timeline. The root cause was that dps.report often omits the failed field entirely (null) for phases on wipe logs, and the parser was treating a missing failed flag as false (= not failed = cleared). Since every dragon was marked as cleared from the start, the wipe-point detection logic could never find the failure point — so no correction was ever applied. The fix changes the initial state to a conservative false (not cleared) when failed is null or absent, allowing the wipe-policy block to correctly identify which dragons were cleared before the wipe and which were not." }
          ]
        }
      ]
    },
    {
      version: "0.5.8",
      date: "August 13, 2026",
      notes: [
        {
          category: "🔧 Bug Fixes",
          items: [
            { title: "Challenge Mode Parser Adjustment", desc: "Adjusted the Portal Protocol local log parser to read the active state of Challenge Mode and Legendary CM events. This resolves a bug where Normal Mode runs (like Keep Construct or Soulless Horror) were incorrectly flagged as CM. To fix any logs already showing incorrect badges, delete them from both the Uploads feed and History, and then re-upload them." }
          ]
        }
      ]
    },
    {
      version: "0.5.7",
      date: "August 12, 2026",
      notes: [
        {
          category: "🚀 New Features",
          items: [
            { title: "Clears Tracker Dashboard", desc: "Track your weekly Guild Wars 2 Raid and Strike Mission boss clears in real-time. Input your API key with progression permission under Clears tab to start tracking." },
            { title: "Cerus CM Empowered Stacks", desc: "Logs now display a dynamic stack count badge (showing 0-2 stacks) representing how many stacks Cerus had at the 50% HP split phase. Powered by local EVTC buff parsing." },
            { title: "Automatic Log History Repair", desc: "A background service checks older history entries on startup and auto-calculates stack counts for preexisting logs." }
          ]
        },
        {
          category: "🎨 UI/UX Redesign",
          items: [
            { title: "Sleek Inline Manual Upload Toolbar", desc: "Replaced the heavy card design for manual file queuing with a clean, low-profile inline toolbar. Press Enter or click Upload to queue a log." },
            { title: "Responsive Icon-Only Mode", desc: "The titlebar navigation tabs automatically collapse into clean icons at narrow window sizes (under 465px) instead of getting cut off." },
            { title: "Improved Vertical Alignment", desc: "Tightened the spacing gap on the uploads page and properly aligned status and timer badges inside wing headers." }
          ]
        },
        {
          category: "🔧 Bug Fixes & Improvements",
          items: [
            { title: "Sidebar State Memory", desc: "Your choice to hide or show the left sidebar is now permanently remembered across restarts." },
            { title: "Window State Restoration", desc: "Window coordinates, size, and maximize state are preserved correctly next time the app opens." },
            { title: "Clears Icon Visibility", desc: "Updated Clears tracker tab to use the universally supported FontAwesome checklist icon." }
          ]
        }
      ]
    },
    {
      version: "0.5.6",
      date: "August 8, 2026",
      notes: [
        {
          category: "🚀 New Features",
          items: [
            { title: "Filters Revamp", desc: "Completely redesigned search and filtering dropdowns for boss encounters." }
          ]
        },
        {
          category: "🔧 Improvements",
          items: [
            { title: "Card Action Buttons Revamp", desc: "Optimized click areas and hover micro-animations on log cards." }
          ]
        }
      ]
    }
  ];

  let showPatchNotesModal = $state(false);
  let selectedPatchNotesVersion = $state("0.5.8");
  let currentAppVersion = $state(""); // real running version, set at startup via getVersion()

  function normalizeBoss(name?: string): string {
    return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function vlEncounterFor(log: UploadRecord): VlEncounter | undefined {
    const key = normalizeBoss(log.boss_name);
    return vlCatalog.find((e) => e.key === key || (e.aliases ?? []).includes(key));
  }
  // VL ranks only apply to CM / LCM kills.
  function vlAvailableFor(log: UploadRecord): boolean {
    const enc = vlEncounterFor(log);
    if (!enc) return false;
    return log.is_cm === true || log.is_lcm === true;
  }
  // Returns the list of awarded VL rank defs for a log (multi-rank aware).
  // `log.vl_rank` may be a single string (old data) or a string[] (new).
  function vlCurrentRanks(log: UploadRecord): VlRankDef[] {
    const enc = vlEncounterFor(log);
    if (!enc || !log.vl_rank) return [];
    const ids = Array.isArray(log.vl_rank) ? log.vl_rank : [log.vl_rank];
    return enc.ranks.filter((r) => ids.includes(r.id));
  }

  // ── Unified folder-target picker (replaces all Move/Save dropdowns) ──
  // A single centered modal avoids every overflow/clip/positioning problem of
  // dropdowns nested inside `.content-area` (overflow-y:auto). One surface,
  // all three flows: folder Move (per-log + group), folder Save (per-log +
  // group), Feed Save to Session.
  type PickerModal = {
    title: string;
    logs: UploadRecord[];
    sessionId: string | null;   // owning session for Move (subfolder list); null for Save
    excludeSubFolderId: string | null;
    onPick: (targetSubFolderId: string | null) => void;
  } | null;
  let pickerModal = $state<PickerModal>(null);

  function openMovePicker(log: UploadRecord, sessionId: string, excludeSubFolderId: string | null, onPick: (targetSubFolderId: string | null) => void) {
    pickerModal = {
      title: "Move Log To…",
      logs: [log],
      sessionId,
      excludeSubFolderId,
      onPick: (target) => { onPick(target); pickerModal = null; },
    };
  }

  function openMoveGroupPicker(logs: UploadRecord[], excludeSubFolderId: string | null, onPick: (targetSubFolderId: string | null) => void) {
    pickerModal = {
      title: "Move Group To…",
      logs,
      sessionId: activeSessionId,
      excludeSubFolderId,
      onPick: (target) => { onPick(target); pickerModal = null; },
    };
  }

  function openSavePicker(logs: UploadRecord[], onPick: (sessionId: string) => void) {
    pickerModal = {
      title: logs.length > 1 ? "Save Logs To…" : "Save Log To…",
      logs,
      sessionId: null,
      excludeSubFolderId: null,
      onPick: (target) => {
        // `target` here is the chosen *session id* (Save flow).
        onPick(target as unknown as string);
        pickerModal = null;
      },
    };
  }

  // VL rank modal (multi-select)
  let vlModal = $state<{ log: UploadRecord; encounter: VlEncounter } | null>(null);
  function openVlModal(log: UploadRecord) {
    const enc = vlEncounterFor(log);
    if (!enc) return;
    vlModal = { log, encounter: enc };
  }
  // Stats modal (per-player damage + boon breakdown from dps.report)
  let statsModal = $state<{ permalink: string; bossName: string; localPath?: string } | null>(null);
  function openStats(log: UploadRecord) {
    if (!log.url && !log.local_fallback) return;
    statsModal = {
      permalink: log.url ?? "",
      bossName: log.boss_name ?? "",
      localPath: log.file_path || undefined,
    };
  }
  function vlRanksOf(log: UploadRecord | undefined): string[] {
    if (!log?.vl_rank) return [];
    return Array.isArray(log.vl_rank) ? log.vl_rank : [log.vl_rank];
  }
  async function setVlRanks(rankId: string, add: boolean) {
    if (!vlModal) return;
    const path = vlModal.log.file_path;
    vlModal = null;
    try {
      await invoke("set_vl_ranks", { filePath: path, rankId, add });
      // Refresh the badge in-place across every store the log can live in.
      // We must NOT rely on the `upload-status` event here: that channel adds
      // logs back into the Uploads Feed, which would re-surface a Folders/
      // Subfolder log (and then it couldn't be removed). So we patch the rank
      // directly wherever the log currently lives.
      const apply = (log: any) => {
        if (log && log.file_path === path) {
          const set = new Set(vlRanksOf(log as UploadRecord));
          if (add) set.add(rankId);
          else set.delete(rankId);
          (log as any).vl_rank = set.size ? Array.from(set) : null;
        }
      };
      uploads = uploads.map((u) => { const c = { ...u }; apply(c); return c; });
      allHistory = allHistory.map((h) => { const c = { ...h }; apply(c); return c; });
      sessions = sessions.map((s) => {
        const logs = s.logs.map((l) => { const c = { ...l }; apply(c); return c; });
        const subfolders = (s.subfolders ?? []).map((sf: any) => ({
          ...sf,
          logs: sf.logs.map((l: any) => { const c = { ...l }; apply(c); return c; }),
        }));
        return { ...s, logs, subfolders };
      });
      // Folder/Subfolder logs live in config.json (not history.json, which
      // set_vl_ranks persists). Persist the patched sessions so the rank survives
      // a restart. Feed/History ranks are covered by set_vl_ranks's own save.
      await persistConfig();
    } catch (e) {
      console.error("set_vl_ranks failed:", e);
    }
  }

  let playerIconsLoaded = $state<Record<string, boolean>>({});

  // ─── Shared filter model (Feed / History / Folders) ───────────────────────
  // Single source of truth so all three views behave identically. `FilterBar.svelte`
  // binds to this object directly.
  let filters = $state({
    result: "all" as "all" | "success" | "failure",
    type: "all" as "all" | "raid" | "strike" | "fractal" | "convergence",
    boss: "all" as string,        // "all" or normalized boss key
    vlRank: "all" as string,      // "all" | "none" | "any" | specific id
    cmMode: "all" as "all" | "cm" | "lcm" | "normal" | "quickplay",
    search: "" as string,
    datePreset: "all" as "all" | "today" | "7d" | "30d" | "month" | "custom",
    dateFrom: "" as string,       // "YYYY-MM-DD" (from custom range)
    dateTo: "" as string,         // "YYYY-MM-DD" (from custom range)
    timeFrom: "" as string,       // "HH:MM" optional time-of-day lower bound
    timeTo: "" as string,         // "HH:MM" optional time-of-day upper bound
    profession: "all" as string | number, // "all" or a PROFESSIONS key / elite_spec id
    professionKind: "all" as "all" | "core" | "spec",
    hasNotes: false as boolean, // true = only show logs with notes attached
  });
  let sound_notifications = $state(true);
  let desktop_notifications = $state(true);
  let prefersReducedMotion = $state(false);
  onMount(() => {
    prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  const CONVERGENCE_BOSSES = new Set([
    "sorrow", "demonknight", "dreadwing", "hellsister", "umbriel",
    "greer", "greerthebightbringer", "greertheblightbringer", "decima", "decimathestormsinger", "ura", "urathesteamshrieker",
    "convergenceouternayos", "convergencemountbalrior"
  ]);

  const RAID_BOSSES = new Set([
    // Wing 1 – Spirit Vale
    "valeguardian",
    "spiritrun", "spiritrace", "spiritwoods",          // pre-event variants
    "gorsevalthemultifarious", "gorseval",
    "sabethathesaboteur", "sabetha",
    // Wing 2 – Salvation Pass
    "slothasor",
    "bandittrio", "banditescort", "escort",             // Bandit Trio + pre-event name variants
    "matthiasgabrel", "matthias",
    // Wing 3 – Stronghold of the Faithful
    "siegethestronghold", "escorttw", "mcleod", "mcleodthesilent", // Escort/Siege pre-event/boss variants
    "keepconstruct",
    "twistedcastle",                                    // pre-event
    "xera",
    // Wing 4 – Bastion of the Penitent
    "cairntheindomitable", "cairn",
    "mursaatoverseer",
    "samarog",
    "deimos",
    // Wing 5 – Hall of Chains
    "soullesshorror", "desmina",
    "riverofsouls",                                     // pre-event
    "statuegrenth", "statueofgrenth", "statues",        // Statues of Grenth pre-event
    "eyeoffate", "eyesoffate", "eyesofjudgment", "eyesofjudgement", "eyes", // Statue of Darkness
    "brokenking", "statueofice",                        // Statue of Ice
    "souleater", "eaterofsouls", "statueofdeath",       // Statue of Death
    "dhuum",
    // Wing 6 – Mythwright Gambit
    "conjuredamalgamate",
    "largostwins", "twinlargos", "nikare", "nikarerenut", "nikareandkenut",
    "qadim",
    // Wing 7 – The Key of Ahdashim
    "cardinalsabir",
    "cardinaladina",
    "qadimthepeerless",
    "gate", "keyofahdashimgate", "keyofahdashim",       // Gate pre-event/escort
    // Wing 8 – Mount Balrior
    "greer", "greerthebightbringer", "greertheblightbringer",
    "decima", "decimathestormsinger",
    "ura", "urathesteamshrieker",
  ]);

  // Pre-events / non-boss encounters: no boss, so a "% HP Left" is meaningless.
  // Hide it on the card and in the Discord formatter (Success/Fail only). Keys
  // are clean(boss_name) — these already match the RAID_BOSSES entries above.
  const HPLESS_ENCOUNTERS = new Set([
    "spiritrun", "spiritrace", "spiritwoods",    // W1 — Spirit Run pre-event
    "twistedcastle",                             // W3 — Twisted Castle pre-event
    "riverofsouls",                             // W5 — River of Souls pre-event
    "gate", "keyofahdashimgate", "keyofahdashim" // W7 — Key of Ahdashim Gate pre-event/escort
  ]);
  // Personal Story instances (is_story flag or STRIKE_REGISTRY expansion) also
  // have no boss HP, so they're HP-less too.
  function shouldShowHpLeft(log: any): boolean {
    if (isStoryBoss(log.boss_name, log)) return false;
    return !HPLESS_ENCOUNTERS.has(clean(log.boss_name));
  }

  const FRACTAL_BOSSES = new Set([
    "mama", "siaxthecorrupted", "ensolyssoftheendlesstorment", "ensolyssofendlesstorment",
    "skorvaldtheshattered", "artsariiv", "arkk",
    "aikeeperofthepeak", "ai",
    "kanaxaiscytheofsouls", "kanaxai",
    "eparchthelonelyking", "eparch",
    "captainmaitrin", "maitrin", "horrik",
    "aetherbladelet", "frizz",
    "jellyfishbeast", "jellyfish",
    "archdiviner",
    "thevoice", "deepstonevoice",
    "moltenberserker", "moltenfirestorm", "moltenboss",
    "moltenfirestormberserker",
      "chaosanomaly",
      "captaincrowe",
      "crowe",
      "shamanlornarr",
      "elementalsource",
      "jademaw",
      "bloomhunger",
      "mossman",
      "thaumanovaanomaly",
      "thaumanovaboss",
      "highpriestessamala",
      "amala",
      "ravingasura",
      "giganicus",
      "imbuedshaman",
      "siegemasterdulfy",
      "dulfy",
      "rampagingiceelemental",
      "dredgepowersuit",
      "rabidiceelemental",
      "whisperingshadow",
      "solitarythrone"
    ]);
  // Authoritative set of boss icon keys = every PNG actually present in /static/bosses
  // (minus unknown.png). This guarantees getBossIcon resolves correctly for any boss that
  // has an asset, independent of which encounter-type Set it lives in.
  const BOSS_ICONS = new Set([
    "aetherbladehideout","bandittrio","boneskinner","brokenking","cairntheindomitable",
    "cardinaladina","cardinalsabir","conjuredamalgamate","cosmicobservatory","decima",
    "deimos","dhuum","dragonvoid","eaterofsouls","eyeoffate","eyes","eyesoffate",
    "fraenirofjormag","gorseval","gorsevalthemultifarious","greer","harvesttemple",
    "icebroodconstruct","kainengoverlook","keepconstruct","kela","largostwins",
    "maitrin","matthiasgabrel","mcleodthesilent","ministerli","mursaatoverseer",
    "oldlionscourt","prototypevermilion","qadim","qadimthepeerless","riverofsouls",
    "sabethathesaboteur","samarog","slothasor","souleater","soullesshorror","spiritrace",
    "standardkittygolem","templeoffebe","twinlargos","twistedcastle","ura","valeguardian",
    "variniastormsounder","voiceandclaw","whisperingshadow","whisperofjormag","xera",
    "xunlaijadejunkyard",
    "nexusofeternity",
    "solitarythrone"
  ]);
  interface WingDef { name: string; bosses: string[]; }
  const WINGS: WingDef[] = [
    { name: "Wing 1 · Spirit Vale",
      bosses: ["valeguardian","spiritrun","spiritrace","spiritwoods","gorsevalthemultifarious","gorseval","sabethathesaboteur","sabetha"] },
    { name: "Wing 2 · Salvation Pass",
      bosses: ["slothasor","bandittrio","banditescort","escort","matthiasgabrel","matthias"] },
    { name: "Wing 3 · Stronghold of the Faithful",
      bosses: ["siegethestronghold","escorttw","mcleod","mcleodthesilent","keepconstruct","twistedcastle","xera"] },
    { name: "Wing 4 · Bastion of the Penitent",
      bosses: ["cairntheindomitable","cairn","mursaatoverseer","samarog","deimos"] },
    { name: "Wing 5 · Hall of Chains",
      bosses: ["soullesshorror","desmina","riverofsouls","statuegrenth","statueofgrenth","statues","eyeoffate","eyesoffate","eyesofjudgment","eyesofjudgement","eyes","brokenking","statueofice","souleater","eaterofsouls","statueofdeath","dhuum"] },
    { name: "Wing 6 · Mythwright Gambit",
      bosses: ["conjuredamalgamate","largostwins","twinlargos","nikare","nikarekenut","nikareandkenut","qadim"] },
    { name: "Wing 7 · The Key of Ahdashim",
      bosses: ["gate","keyofahdashimgate","keyofahdashim","cardinalsabir","cardinaladina","qadimthepeerless"] },
    { name: "Wing 8 · Mount Balrior",
      bosses: ["greer","greerthebightbringer","greertheblightbringer","decima","decimathestormsinger","ura","urathesteamshrieker"] },
  ];

  const BOSS_CATEGORIES: Record<string, string> = {
    // IBS Strikes
    "shiverpeakspass": "Icebrood Saga Strikes",
    "icebroodconstruct": "Icebrood Saga Strikes",
    "voiceofthefallen": "Icebrood Saga Strikes",
    "clawofthefallen": "Icebrood Saga Strikes",
    "voiceandclaw": "Icebrood Saga Strikes",
    "kodanbrothers": "Icebrood Saga Strikes",
    "fraenirofjormag": "Icebrood Saga Strikes",
    "fraenir": "Icebrood Saga Strikes",
    "boneskinner": "Icebrood Saga Strikes",
    "whisperofjormag": "Icebrood Saga Strikes",
    "whisper": "Icebrood Saga Strikes",
    "coldwar": "Icebrood Saga Strikes",
    "variniastormsounder": "Icebrood Saga Strikes",

    // EoD Strikes
    "maitrin": "End of Dragons Strikes",
    "aetherbladehideout": "End of Dragons Strikes",
    "ankka": "End of Dragons Strikes",
    "xunlaijadejunkyard": "End of Dragons Strikes",
    "ministerli": "End of Dragons Strikes",
    "kainengoverlook": "End of Dragons Strikes",
    "dragonvoid": "End of Dragons Strikes",
    "harvesttemple": "End of Dragons Strikes",
    "oldlionscourt": "End of Dragons Strikes",
    "prototypevermilion": "End of Dragons Strikes",

    // SotO Strikes
    "dagda": "Secrets of the Obscure Strikes",
    "cosmicobservatory": "Secrets of the Obscure Strikes",
    "cerus": "Secrets of the Obscure Strikes",
    "templeoffebe": "Secrets of the Obscure Strikes",

    // Janthir Wilds Strikes
    "kela": "Guardian's Glade",

    // Fractals
    "mama": "Fractals",
    "siaxthecorrupted": "Fractals",
    "ensolyssoftheendlesstorment": "Fractals",
    "ensolyssofendlesstorment": "Fractals",
    "skorvaldtheshattered": "Fractals",
    "artsariiv": "Fractals",
    "arkk": "Fractals",
    "aikeeperofthepeak": "Fractals",
    "ai": "Fractals",
    "kanaxaiscytheofsouls": "Fractals",
    "kanaxai": "Fractals",
    "eparchthelonelyking": "Fractals",
    "eparch": "Fractals",
    "captainmaitrin": "Fractals",
    "horrik": "Fractals",
    "aetherbladelet": "Fractals",
    "frizz": "Fractals",
    "jellyfishbeast": "Fractals",
    "jellyfish": "Fractals",
    "archdiviner": "Fractals",
    "thevoice": "Fractals",
    "deepstonevoice": "Fractals",
    "moltenberserker": "Fractals",
    "moltenfirestorm": "Fractals",
    "moltenboss": "Fractals",
    "moltenfirestormberserker": "Fractals",
    "chaosanomaly": "Fractals",
    "captaincrowe": "Fractals",
    "crowe": "Fractals",
    "shamanlornarr": "Fractals",
    "elementalsource": "Fractals",
    "jademaw": "Fractals",
    "bloomhunger": "Fractals",
    "mossman": "Fractals",
    "thaumanovaanomaly": "Fractals",
    "thaumanovaboss": "Fractals",
    "highpriestessamala": "Fractals",
    "amala": "Fractals",
    "ravingasura": "Fractals",
    "giganicus": "Fractals",
    "imbuedshaman": "Fractals",
    "siegemasterdulfy": "Fractals",
    "dulfy": "Fractals",
    "rampagingiceelemental": "Fractals",
    "dredgepowersuit": "Fractals",
    "rabidiceelemental": "Fractals",
    "whisperingshadow": "Fractals"
  };

  // Map clean-boss → wing index for O(1) lookup
  const BOSS_TO_WING: Record<string, number> = {};
  WINGS.forEach((w, i) => w.bosses.forEach(b => { BOSS_TO_WING[b] = i; }));


  // Map clean-boss → wing index for O(1) lookup

  function getFractalName(bossName: string | undefined, numPlayers?: number): string {
    if (!bossName) return "";
    const c = clean(bossName);
    if (c === "mama" || c === "siaxthecorrupted" || c === "ensolyssoftheendlesstorment" || c === "ensolyssofendlesstorment") return "Nightmare";
    if (c === "skorvaldtheshattered" || c === "artsariiv" || c === "arkk") return "Shattered Observatory";
    if (c === "aikeeperofthepeak" || c === "ai") return "Sunqua Peak";
    if (c === "kanaxaiscytheofsouls" || c === "kanaxai") return "Silent Surf";
    if (c === "eparchthelonelyking" || c === "eparch") return "Lonely Tower";
    if (c === "captainmaitrin" || c === "maitrin" || c === "horrik") {
      if (numPlayers && numPlayers > 5) return "";
      return "Mai Trin Boss";
    }
    if (c === "aetherbladelet" || c === "frizz") return "Aetherblade";
    if (c === "jellyfishbeast" || c === "jellyfish") return "Aquatic Ruins";
    if (c === "archdiviner") return "Cliffside";
    if (c === "thevoice" || c === "deepstonevoice") return "Deepstone";
    if (c === "moltenberserker" || c === "moltenfirestorm" || c === "moltenboss" || c === "moltenfirestormberserker") return "Molten Boss / Molten Furnace";
    if (c === "chaosanomaly") return "Chaos";
    if (c === "captaincrowe" || c === "crowe") return "Siren's Reef";
    if (c === "shamanlornarr" || c === "elementalsource") return "Snowblind";
    if (c === "jademaw") return "Solid Ocean";
    if (c === "bloomhunger" || c === "mossman") return "Swampland";
    if (c === "thaumanovaanomaly" || c === "thaumanovaboss") return "Thaumanova Reactor";
    if (c === "highpriestessamala" || c === "amala") return "Twilight Oasis";
    if (c === "ravingasura") return "Urban Battleground";
    if (c === "giganicus" || c === "imbuedshaman") return "Volcanic";
    if (c === "siegemasterdulfy" || c === "dulfy") return "Uncategorized";
    if (c === "rampagingiceelemental" || c === "dredgepowersuit" || c === "rabidiceelemental") return "Dredgehaunt Cliffs";
    if (c === "whisperingshadow") return "Kinfall Fractal";
    return "";
  }

  function getDiscordBossName(bossName: string | undefined, numPlayers?: number): string {
    if (!bossName) return "Unknown";
    const frac = getFractalName(bossName, numPlayers);
    if (frac) return `${frac} (Fractal)`;
    return getBossDisplayName(bossName);
  }

  function getLabelName(bossName: string | undefined): string {
    if (!bossName) return "Unknown";
    return getBossDisplayName(bossName);
  }

  function getEncounterType(bossName: string | undefined, numPlayers?: number, isConvergence?: boolean): "raid" | "strike" | "fractal" | "convergence" {
    if (!bossName) return "raid";
    if (isConvergence === true) return "convergence";
    const c = clean(bossName);
    if (["sorrow", "demonknight", "dreadwing", "hellsister", "umbriel", "convergenceouternayos"].includes(c)) {
      return "convergence";
    }
    if (["greer", "greerthebightbringer", "greertheblightbringer", "decima", "decimathestormsinger", "ura", "urathesteamshrieker", "convergencemountbalrior"].includes(c)) {
      if (c === "convergencemountbalrior" || (numPlayers ?? 0) > 10) {
        return "convergence";
      }
      return "raid";
    }
    if (RAID_BOSSES.has(c)) return "raid";
    if (["captainmaitrin", "maitrin", "horrik"].includes(c) && (numPlayers ?? 0) > 5) {
      return "strike";
    }
    if (FRACTAL_BOSSES.has(c)) return "fractal";
    return "strike";
  }

  // ─── Selection State ─────────────────────────────────────────────────
  let selectedLogs = $state<Set<string>>(new Set());
  let wingCollapsed = $state<Record<number, boolean>>({});
  let categoryCollapsed = $state<Record<string, boolean>>({});
  let copyFeedback = $state("");
  let formatterCopyFeedback = $state(false);
  let isOnline = $state(true);
  let uploads = $state<UploadRecord[]>([]);
  // Hard cap on in-memory Feed entries so the array can't grow unbounded

  // `filteredUploads`; this keeps the underlying source bounded too.
  const MAX_FEED_LOGS = 500;
  let deletedPaths = $state<Set<string>>(new Set()); // paths the user deleted from the feed (hidden, race-proof)
  let confirmTitle = $state("");
  let confirmMessage = $state("");
  let confirmCallback = $state<(() => void) | null>(null);
  let showConfirmModal = $state(false);

  function clean(s: string | undefined): string {
    let name = (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (name.includes("umbriel")) return "umbriel";
    if (name.includes("greer")) return "greer";
    if (name.includes("decima")) return "decima";
    if (name.includes("ura")) return "ura";
    if (name === "oldlion" || name === "oldlionscourt") return "oldlionscourt";
    if (name === "samaroq" || name === "samarog") return "samarog";
    if (name === "captainmaitrin" || name === "maitrin") return "captainmaitrin";
    if (name === "aetherbladehideout") return "aetherbladehideout";
    if (name === "ministerli" || name === "kainengoverlook") return "kainengoverlook";
    if (name === "ankka" || name === "xunlaijadejunkyard") return "xunlaijadejunkyard";
    if (name === "dragonvoid" || name === "harvesttemple") return "harvesttemple";
    if (name === "thevoiceandtheclaw" || name === "voiceandclaw" || name === "voiceandclawofthefallen" || name === "voiceofthefallen" || name === "clawofthefallen") return "voiceandclaw";
    if (name === "dagda" || name === "cosmicobservatory") return "cosmicobservatory";
    if (name === "cerus" || name === "templeoffebe") return "templeoffebe";
    if (name === "desminaescort" || name === "riverofsouls") return "riverofsouls";
    return name;
  }

  // The Dragon Council timeline is ONLY valid for The Dragonvoid (Harvest
  // Temple). dps.report sends `phases[]` for every fight, and several contain a
  // dragon fragment ("jormag" appears in Whisper of Jormag / Fraenir of Jormag
  // too), so we must explicitly gate on the canonical Dragonvoid boss keys both
  // here and in the backend — otherwise non-Dragonvoid bosses render a spurious
  // Dragon Council strip (observed by a tester on Whisper of Jormag).
  function isDragonvoid(bossName: string | undefined): boolean {
    const c = (bossName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return c === "dragonvoid" || c === "harvesttemple" || c === "thedragonvoid";
  }
  function isKainengOverlook(bossName: string | undefined): boolean {
    if (!bossName) return false;
    const c = clean(bossName);
    return c === "kainengoverlook" || c === "ministerli";
  }

  // Canonical strike registry. dps.report sends EITHER the strike/map name
  // (e.g. "Temple of Febe") OR the boss NPC name (e.g. "Cerus") for the same
  // fight, so we key by cleaned boss_name and derive all three display strings
  // (expansion / strike / boss) from one source — they can never disagree.
  interface StrikeInfo { expansion: string; strike: string; boss: string; }
  const STRIKE_REGISTRY: Record<string, StrikeInfo> = {
    // Icebrood Saga
    shiverpeakspass: { expansion: "Icebrood Saga", strike: "Shiverpeak Pass", boss: "Whisper of Jormag" },
    variniastormsounder: { expansion: "Icebrood Saga", strike: "Cold War", boss: "Varinia Stormsounder" },
    icebroodconstruct: { expansion: "Icebrood Saga", strike: "Icebrood Construct", boss: "Icebrood Construct" },
    voiceofthefallen: { expansion: "Icebrood Saga", strike: "Voice of the Fallen", boss: "Voice and Claw of the Fallen" },
    clawofthefallen: { expansion: "Icebrood Saga", strike: "Claw of the Fallen", boss: "Voice and Claw of the Fallen" },
    voiceandclaw: { expansion: "Icebrood Saga", strike: "Voice and Claw of the Fallen", boss: "Voice and Claw of the Fallen" },
    kodanbrothers: { expansion: "Icebrood Saga", strike: "Kodan Brothers", boss: "Kodan Brothers" },
    fraenirofjormag: { expansion: "Icebrood Saga", strike: "Fraenir of Jormag", boss: "Fraenir of Jormag" },
    fraenir: { expansion: "Icebrood Saga", strike: "Fraenir of Jormag", boss: "Fraenir of Jormag" },
    boneskinner: { expansion: "Icebrood Saga", strike: "Boneskinner", boss: "Boneskinner" },
    whisperofjormag: { expansion: "Icebrood Saga", strike: "Whisper of Jormag", boss: "Whisper of Jormag" },
    whisper: { expansion: "Icebrood Saga", strike: "Whisper of Jormag", boss: "Whisper of Jormag" },
    coldwar: { expansion: "Icebrood Saga", strike: "Cold War", boss: "Cold War" },
    // End of Dragons
    captainmaitrin: { expansion: "End of Dragons", strike: "Aetherblade Hideout", boss: "Captain Mai Trin" },
    maitrin: { expansion: "End of Dragons", strike: "Aetherblade Hideout", boss: "Captain Mai Trin" },
    aetherbladehideout: { expansion: "End of Dragons", strike: "Aetherblade Hideout", boss: "Captain Mai Trin" },
    xunlaijadejunkyard: { expansion: "End of Dragons", strike: "Xunlai Jade Junkyard", boss: "Ankka" },
    ankka: { expansion: "End of Dragons", strike: "Xunlai Jade Junkyard", boss: "Ankka" },
    kainengoverlook: { expansion: "End of Dragons", strike: "Kaineng Overlook", boss: "Minister Li" },
    ministerli: { expansion: "End of Dragons", strike: "Kaineng Overlook", boss: "Minister Li" },
    thedragonvoid: { expansion: "End of Dragons", strike: "Harvest Temple", boss: "The Dragonvoid" },
    dragonvoid: { expansion: "End of Dragons", strike: "Harvest Temple", boss: "The Dragonvoid" },
    harvesttemple: { expansion: "End of Dragons", strike: "Harvest Temple", boss: "The Dragonvoid" },
    oldlionscourt: { expansion: "End of Dragons", strike: "Old Lion's Court", boss: "Prototype Watchknights" },
    oldlion: { expansion: "End of Dragons", strike: "Old Lion's Court", boss: "Prototype Watchknights" },
    prototypevermilion: { expansion: "End of Dragons", strike: "Old Lion's Court", boss: "Prototype Watchknights" },
    prototypeindigo: { expansion: "End of Dragons", strike: "Old Lion's Court", boss: "Prototype Watchknights" },
    prototypegold: { expansion: "End of Dragons", strike: "Old Lion's Court", boss: "Prototype Watchknights" },
    // Secrets of the Obscure
    cosmicobservatory: { expansion: "Secrets of the Obscure", strike: "Cosmic Observatory", boss: "Dagda" },
    dagda: { expansion: "Secrets of the Obscure", strike: "Cosmic Observatory", boss: "Dagda" },
    templeoffebe: { expansion: "Secrets of the Obscure", strike: "Temple of Febe", boss: "Cerus" },
    cerus: { expansion: "Secrets of the Obscure", strike: "Temple of Febe", boss: "Cerus" },
    // Visions of Eternity (Janthir-era strike rebrand; Kela lives here per user)
    kela: { expansion: "Visions of Eternity", strike: "Guardian's Glade", boss: "Kela, Seneschal of Waves" },
    kelaseneschalofwaves: { expansion: "Visions of Eternity", strike: "Guardian's Glade", boss: "Kela, Seneschal of Waves" },
    // Visions of Eternity: Nexus of Eternity (new strike encounter)
    vloxx: { expansion: "Visions of Eternity", strike: "Nexus of Eternity", boss: "Vloxx" },
    // Special Forces Training Area (golem / training dummies)
    standardkittygolem: { expansion: "Special Forces Training Area", strike: "Kitty Golem", boss: "Standard Kitty Golem" },
    kittygolem:        { expansion: "Special Forces Training Area", strike: "Kitty Golem", boss: "Kitty Golem" },
    golem:             { expansion: "Special Forces Training Area", strike: "Kitty Golem", boss: "Kitty Golem" },
    // Personal Story (asura lvl-10 arc). dps.report labels these by INSTANCE name.
    // Keyed on instance keywords so any boss-NPC name dps.report sends maps to the right
    // instance. Map IDs kept for future-proofing (option to parse map_id from EVTC later).
    //   The Snaff Prize (map 579), Taking Credit Back (584), A Sparkling Rescue (581),
    //   Stand By Your Krewe (594), Here/There/Everywhere (587)
    snaffprize:       { expansion: "Personal Story", strike: "The Snaff Prize", boss: "The Snaff Prize" },
    thesnaffprize:    { expansion: "Personal Story", strike: "The Snaff Prize", boss: "The Snaff Prize" },
    takingcreditback: { expansion: "Personal Story", strike: "Taking Credit Back", boss: "Taking Credit Back" },
    sparklingrescue:  { expansion: "Personal Story", strike: "A Sparkling Rescue", boss: "A Sparkling Rescue" },
    asparklingrescue: { expansion: "Personal Story", strike: "A Sparkling Rescue", boss: "A Sparkling Rescue" },
    standbyyourkrewe: { expansion: "Personal Story", strike: "Stand By Your Krewe", boss: "Stand By Your Krewe" },
    herethere:        { expansion: "Personal Story", strike: "Here, There, Everywhere", boss: "Here, There, Everywhere" },
    herethereeverywhere: { expansion: "Personal Story", strike: "Here, There, Everywhere", boss: "Here, There, Everywhere" },
  };
  function getStrikeInfo(bossName: string | undefined): StrikeInfo | undefined {
    if (!bossName) return undefined;
    return STRIKE_REGISTRY[clean(bossName)];
  }
  function getStrikeBossName(bossName: string | undefined): string {
    const si = getStrikeInfo(bossName);
    if (si) return si.boss;
    return getBossDisplayName(bossName);
  }


  function getStoryInstance(bossName: string | undefined, log?: any): string | undefined {
    // Prefer the authoritative flag the backend sets from the story map id.
    if (log?.is_story) return log.boss_name ?? (bossName ? STRIKE_REGISTRY[clean(bossName)]?.strike : undefined);
    if (!bossName) return undefined;
    const c = clean(bossName);
    // Only Personal Story instances belong under that header — a generic strike
    // (e.g. Cerus / Temple of Febe) must NOT be captured here or it gets bucketed
    // into Personal Story by the callers' `storyInst ? "Personal Story" : ...`.
    const si = STRIKE_REGISTRY[c];
    return si && si.expansion === "Personal Story" ? si.strike : undefined;
  }
  function isStoryBoss(bossName: string | undefined, log?: any): boolean {
    if (log?.is_story) return true;
    if (!bossName) return false;
    return clean(bossName) in STRIKE_REGISTRY && STRIKE_REGISTRY[clean(bossName)]?.expansion === "Personal Story";
  }
  // Story instances have no boss icon in /bosses — use the chapter art the user
  // dropped in /static/story_icons (filenames are clean(boss_name) stems).
  function getStoryIcon(bossName: string | undefined, log?: any): string | undefined {
    if (!isStoryBoss(bossName, log)) return undefined;
    return `/story_icons/${clean(bossName)}.png`;
  }
  function getBossDisplayName(bossName: string | undefined): string {
    if (!bossName) return "Unknown Encounter";
    const si = getStrikeInfo(bossName);
    if (si) return si.boss;
    const c = clean(bossName);
    if (c === "mama") return "M.A.M.A";
    if (c === "siaxthecorrupted") return "Siax the Corrupted";
    if (c === "ensolyssoftheendlesstorment" || c === "ensolyssofendlesstorment") return "Ensolyss of the Endless Torment";
    if (c === "skorvaldtheshattered") return "Skorvald the Shattered";
    if (c === "artsariiv") return "Artsariiv";
    if (c === "arkk") return "Arkk";
    if (c === "aikeeperofthepeak" || c === "ai") return "Ai, Keeper of the Peak";
    if (c === "kanaxaiscytheofsouls" || c === "kanaxai") return "Kanaxai, Scythe of Souls";
    if (c === "eparchthelonelyking" || c === "eparch") return "Eparch, The Lonely King";
    if (c === "captainmaitrin" || c === "maitrin") return "Captain Mai Trin";
    if (c === "horrik") return "Horrik";
    if (c === "aetherbladelet" || c === "frizz") return "Frizz (Aetherblade)";
    if (c === "jellyfishbeast" || c === "jellyfish") return "Jellyfish Beast";
    if (c === "archdiviner") return "Archdiviner";
    if (c === "thevoice" || c === "deepstonevoice") return "The Voice";
    if (c === "moltenberserker" || c === "moltenfirestorm" || c === "moltenboss" || c === "moltenfirestormberserker") return "Molten Alliance";
    if (c === "chaosanomaly") return "Chaos Anomaly";
    if (c === "captaincrowe" || c === "crowe") return "Captain Crowe";
    if (c === "shamanlornarr" || c === "elementalsource") return "Shaman Lornarr";
    if (c === "jademaw") return "Jade Maw";
    if (c === "bloomhunger") return "Bloomhunger";
    if (c === "mossman") return "Mossman";
    if (c === "thaumanovaanomaly" || c === "thaumanovaboss") return "Thaumanova Anomaly";
    if (c === "highpriestessamala" || c === "amala") return "High Priestess Amala";
    if (c === "ravingasura") return "Raving Asura";
    if (c === "giganicus" || c === "imbuedshaman") return "Imbued Shaman";
    if (c === "siegemasterdulfy" || c === "dulfy") return "Siege Master Dulfy";
    if (c === "rampagingiceelemental" || c === "dredgepowersuit" || c === "rabidiceelemental") return "Dredge Powersuit / Ice Elemental";
    if (c === "sorrow") return "Sorrow";
    if (c === "demonknight") return "Demon Knight";
    if (c === "dreadwing") return "Dreadwing";
    if (c === "hellsister") return "Hell Sister";
    if (c === "umbriel") return "Umbriel, Halberd of House Aurkus";
    if (c === "greer" || c === "greertheblightbringer" || c === "greerthebightbringer") return "Greer, the Blightbringer";
    if (c === "decima" || c === "decimathestormsinger") return "Decima, the Stormsinger";
    if (c === "ura" || c === "urathesteamshrieker") return "Ura, the Steamshrieker";
    if (c === "convergenceouternayos") return "Convergence: Outer Nayos";
    if (c === "convergencemountbalrior") return "Convergence: Mount Balrior";
    if (c === "mcleod" || c === "mcleodthesilent") return "McLeod the Silent";
    if (c === "gate" || c === "keyofahdashimgate" || c === "keyofahdashim") return "Key of Ahdashim Gate";
    if (c === "voiceandclaw") return "Voice and Claw of the Fallen";
    if (c === "oldlion" || c === "oldlionscourt" || c === "prototypevermilion" || c === "prototypeindigo" || c === "prototypegold") return "Old Lion's Court";
    if (c === "aetherbladehideout") return "Aetherblade Hideout";
    if (c === "kainengoverlook") return "Kaineng Overlook";
    if (c === "xunlaijadejunkyard") return "Xunlai Jade Junkyard";
    if (c === "harvesttemple") return "Harvest Temple";
    if (c === "cosmicobservatory") return "Cosmic Observatory";
    if (c === "templeoffebe") return "Temple of Febe";
    if (c === "riverofsouls") return "River of Souls";
    if (c === "brokenking" || c === "statueofice") return "Statue of Ice (Broken King)";
    if (c === "souleater" || c === "eaterofsouls" || c === "statueofdeath") return "Statue of Death (Eater of Souls)";
    if (c === "eyeoffate" || c === "eyesoffate" || c === "eyes" || c === "eyesofjudgment" || c === "eyesofjudgement") return "Statue of Darkness (Eyes)";
    if (c === "dhuum") return "Dhuum";
    if (c === "conjuredamalgamate") return "Conjured Amalgamate";
    if (c === "largostwins" || c === "twinlargos" || c === "nikare" || c === "nikarekenut") return "Twin Largos";
    if (c === "qadim") return "Qadim";
    if (c === "cardinalsabir") return "Cardinal Sabir";
    if (c === "cardinaladina") return "Cardinal Adina";
    if (c === "qadimthepeerless") return "Qadim the Peerless";
    if (c === "kela" || c === "kelaseneschalofwaves") return "Kela, Seneschal of Waves";
    return bossName;
  }

  function getModeBossDisplayName(bossName: string | undefined, log?: UploadRecord): string {
    const base = getBossDisplayName(bossName);
    if (!bossName || !log) return base;
    const c = clean(bossName);
    if ((c === "greer" || c === "greertheblightbringer" || c === "greerthebightbringer") && showChallengeMode(log)) {
      return "Godspoil Greer";
    }
    if ((c === "decima" || c === "decimathestormsinger") && showChallengeMode(log)) {
      return "Godsquall Decima";
    }
    if ((c === "ura" || c === "urathesteamshrieker") && (showChallengeMode(log) || showLegendaryCm(log))) {
      return "Godscream Ura";
    }
    return base;
  }

  function formatDuration(seconds?: number | null): string {
    if (seconds == null || Number.isNaN(seconds)) return "0:00";
    const total = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  // Kitty Golem (Special Forces Training Area) test — reuse the same key the
  // Training badge uses so the DMG badge only shows for golem logs (for now).
  function isGolemLog(log: UploadRecord): boolean {
    return clean(log.boss_name).includes("golem");
  }

  // Honest pipeline stepper for in-flight cards (Queued -> Resolved).
  // `stage` is emitted on every upload-status event; `status` fills the tail.
  function uploadStageList(log: any): { label: string; state: "done" | "active" | "pending" }[] {
    const order = ["Queued", "Reading", "Parsing", "Uploading"];
    const idx = order.indexOf(log.stage ?? "");
    const stages =
      idx >= 0
        ? order.map((s, i) => ({
            label: s,
            state: (i < idx ? "done" : i === idx ? "active" : "pending") as "done" | "active" | "pending",
          }))
        : order.map((s) => ({ label: s, state: "pending" as "done" | "active" | "pending" }));
    const activeLabel = idx >= 0 ? order[idx] : log.stage ?? "";
    stages.forEach((s) => {
      const i = order.indexOf(s.label);
      if (i >= 0) s.state = i < order.indexOf(activeLabel) ? "done" : i === order.indexOf(activeLabel) ? "active" : "pending";
    });
    // "Resolved" is only done at a TERMINAL status — never mid-pipeline, even
    // though local metadata (and local_fallback) can be present earlier. This
    // prevents the stepper from showing a green Resolved check while still
    // Uploading/Parsing.
    const TERMINAL = ["Processing", "Completed", "Duplicate", "Failed", "On Hold", "Off Hold"];
    // Parallel pipeline: Parsing and Uploading can both be active simultaneously
    if (log.ei_done != null && log.upload_done != null) {
      if (log.ei_done === false && log.upload_done === false) {
        const parsingIdx = order.indexOf("Parsing");
        const uploadIdx = order.indexOf("Uploading");
        if (parsingIdx >= 0) stages[parsingIdx].state = "active";
        if (uploadIdx >= 0) stages[uploadIdx].state = "active";
      } else if (log.ei_done === true && log.upload_done === false) {
        const parsingIdx = order.indexOf("Parsing");
        const uploadIdx = order.indexOf("Uploading");
        if (parsingIdx >= 0) stages[parsingIdx].state = "done";
        if (uploadIdx >= 0) stages[uploadIdx].state = "active";
      } else if (log.ei_done === false && log.upload_done === true) {
        const parsingIdx = order.indexOf("Parsing");
        const uploadIdx = order.indexOf("Uploading");
        if (parsingIdx >= 0) stages[parsingIdx].state = "active";
        if (uploadIdx >= 0) stages[uploadIdx].state = "done";
      }
    }
    stages.push({ label: "Resolved", state: TERMINAL.includes(log.status) ? "done" : "pending" });
    return stages;
  }

  // Show the cloud placeholder only while the EVTC hasn't been parsed yet
  // (i.e. boss_name is absent). Once the local parser emits boss_name at the
  // "Parsing" stage, switch to the real boss icon so the full card context
  // (icon + name + HP% + mode badge) is visible during the upload pipeline.
  function isReadingLog(log: any): boolean {
    return !log.boss_name;
  }

  // True kill: dps.report verdict OR local dead-boss scrape (0% boundary).
  function isKillParse(log: any): boolean {
    return log.success === true || (typeof log.boss_hp_left === "number" && log.boss_hp_left <= 0.005);
  }

  // Canonical Harvest Temple dragon order. The EVTC may only contain the dragons
  // actually spawned, so we fill the full council and mark unseen ones "not reached".
  const DRAGON_SEQUENCE = [
    { key: "jormag", name: "Jormag" },
    { key: "primordus", name: "Primordus" },
    { key: "kralkatorrik", name: "Kralkatorrik" },
    { key: "mordremoth", name: "Mordremoth" },
    { key: "zhaitan", name: "Zhaitan" },
    { key: "soowon", name: "Soo-Won" },
  ];
  // The Dragon Council is driven by dps.report phases (the EVTC has no per-dragon
  // HP). A dragon is `dead` when its phase came back cleared (failed:false); `alive`
  // when it was reached but the run wiped on it (failed:true); `unreached` when the
  // group never got that far (absent from phases[]). We mark a dragon "reached" as
  // soon as any earlier dragon in canonical order is dead/alive, so the council lays
  // out left→right as the fight actually progressed (this is a presentation cue only;
  // dps.report owns the authoritative per-dragon verdict).
  function dragonCouncil(hp: DragonHp[]): Array<{ key: string; name: string; state: "dead" | "alive" | "unreached"; pct: number; reached: boolean; hp_left: number }> {
    const byKey = new Map(hp.map((d) => [d.key, d]));
    let reachedAny = false;
    return DRAGON_SEQUENCE.map((seq) => {
      const d = byKey.get(seq.key);
      let state: "dead" | "alive" | "unreached";
      let pct = d && d.died ? 0 : 100;
      let reached = false;
      if (d) {
        reached = true;
        state = d.died ? "dead" : "alive";
      } else if (reachedAny) {
        // An earlier dragon was reached in this log: the fight progressed to this
        // one, but its phase never came back — treat as reached-but-not-cleared.
        reached = true;
        state = "alive";
      } else {
        state = "unreached";
      }
      if (d) reachedAny = true;
      return { key: seq.key, name: seq.name, state, pct, reached, hp_left: d ? d.hp_left : 100 };
    });
  }

  // Single merged Dragon Council for The Dragonvoid: one left→right row of
  // every fight element (dragons + Purification hearts + Void mini-bosses),
  // driven by `log.bosses_phases`. Each chip carries its clear/x mark AND — for
  // the 6 elder dragons — the HP bar/state pulled from `bosses_hp` (by key).
  // `kind` ("dragon" | "heart" | "miniboss") tints the chip; icons resolve to
  // /bosses/{icon}.png when present, else the default the{key}void.png.
  function orderForAdd(name: string): number {
    const orderMap: Record<string, number> = {
      timecaster: 0,
      giants: 1,
      saltspray: 2,
      obliterator: 3,
      goliath: 4,
    };
    return orderMap[name] ?? 99;
  }
  function dragonCouncilMerged(
    phases: DragonPhase[],
    hpByKey: Map<string, DragonHp>,
  ): Array<{
    key: string; name: string; icon: string; kind: string;
    cleared: boolean; hp: number | null; died: boolean; hpState: string;
  }> {
    const purification2 = phases.find((p) => p.key === "purification2");
    return phases.map((p) => {
      const hp = hpByKey.get(p.key);
      const hasHp = hp != null;
      // Time Caster is subordinate to Purification 2 — only show cleared when
      // Purification 2 itself was cleared, matching EI instance semantics.
      const effectiveCleared =
        p.key === "timecaster" && purification2 != null
          ? purification2.cleared
          : p.cleared;
      // For the 6 elder dragons the timeline `cleared` flag is the authoritative
      // source of truth for hover HP: cleared → 0% / Defeated; not cleared → 100%
      // HP left. dps.report can leave `failed=null` on wiped dragons, which makes
      // `bosses_hp` show 100% even for dragons that were killed before the wipe.
      const isDragon = p.kind === "dragon";
      const died = isDragon ? effectiveCleared : hasHp ? hp!.died : false;
      const hpLeft = isDragon
        ? effectiveCleared
          ? 0
          : 100
        : hasHp
          ? hp!.hp_left
          : null;
      const hpState = isDragon
        ? effectiveCleared
          ? "dead"
          : "alive"
        : hasHp
          ? hp!.died
            ? "dead"
            : "alive"
          : "dead";
      return {
        key: p.key,
        name: p.name,
        icon: p.icon ? `/bosses/${p.icon}.png` : `/bosses/the${p.key}void.png`,
        kind: p.kind,
        cleared: effectiveCleared,
        hp: hpLeft,
        died,
        hpState,
      };
    });
  }

  // Compact DPS formatting: 33163 -> "33.2k", 1234567 -> "1.23M".
  function formatDps(dps?: number | null): string {
    if (dps == null || Number.isNaN(dps)) return "";
    if (dps >= 1_000_000) return (dps / 1_000_000).toFixed(2) + "M";
    if (dps >= 1_000) return (dps / 1_000).toFixed(1) + "k";
    return Math.round(dps).toString();
  }

  // Complete (un-abbreviated) number with thousands separators: 31456 -> "31,456".
  // Used for the golem Damage Dealt badge so the full value is shown, not "31k".
  function formatComplete(dmg?: number | null): string {
    if (dmg == null || Number.isNaN(dmg)) return "";
    return Math.round(dmg).toLocaleString("en-US");
  }

  function formatTotalTime(seconds?: number | null): string {
    return formatDuration(seconds);
  }

  // Compact "Xh Ym" for the per-view stat strip (Total Time).

  function getBossIcon(bossName: string | undefined, numPlayers?: number): string {
    const c = clean(bossName);
    if (!c) return "/bosses/unknown.png";
    // dps.report sends EITHER the strike/map name (e.g. "Temple of Febe") OR the
    // boss NPC name (e.g. "Cerus") for the same encounter. Map both to the icon key.
    const key = BOSS_ICON_ALIASES[c] ?? c;
    // Convergences have their own subfolder (assets added separately)
    if (getEncounterType(bossName, numPlayers, undefined) === "convergence") {
      // Canonicalize the variant convergence names (arcDPS reports long forms like
      // "Ura, the Steamshriker" or "Decima, the Stormsinger") to their asset key so
      // each metrix shows its OWN icon — not Greer's.
      const CONV_ICON_KEY: Record<string, string> = {
        greer: "greer", greerthebightbringer: "greer", greertheblightbringer: "greer",
        decima: "decima", decimathestormsinger: "decima",
        ura: "ura", urathesteamshrieker: "ura",
        // Mount Balrior metrix has no dedicated asset; reuse Greer as before.
        convergencemountbalrior: "greer",
      };
      const base = CONV_ICON_KEY[c] ?? (c === "convergenceouternayos" ? null : c);
      if (!base) return "/bosses/unknown.png"; // map-name guard with no asset -> catch-all
      return `/convergences/${base}.png`;
    }
    // Fractals have their own subfolder (assets added separately)
    if (FRACTAL_BOSSES.has(key)) return `/fractals/${key}.png`;
    // Authoritative: any boss that has an icon PNG in /static/bosses resolves here
    if (BOSS_ICONS.has(key)) return `/bosses/${key}.png`;
    return "/bosses/unknown.png";
  }

  // cleaned local parser name -> icon asset key (resolves to a real PNG)
  const BOSS_ICON_ALIASES: Record<string, string> = {
    // Strikes / raids where arcDPS uses a long or alternate name
    kelaseneschalofwaves: "kela",
    vloxx: "nexusofeternity",
    cerus: "templeoffebe",
    greerthebightbringer: "greer",
    greertheblightbringer: "greer",
    decimathestormsinger: "decima",
    captainmaitrin: "maitrin",
    voiceofthefallen: "voiceandclaw",
    desmina: "riverofsouls",
    // Fractals: arcDPS name -> fractal asset key
    arkk: "arkk",
    artsariiv: "artsariiv",
    mama: "mama",
    skorvaldtheshattered: "skorvaldtheshattered",
    nightmareoratuss: "siaxthecorrupted",
    kanaxaiscytheofhouseaurkus: "kanaxai",
    ensolyssoftheendlesstorment: "ensolyssoftheendlesstorment",
    ensolyssofendlesstorment: "ensolyssoftheendlesstorment", // typo variant -> real asset
    aikeeperofthepeak: "ai", // arcdps name -> ai.png
    kanaxaiscytheofsouls: "kanaxai", // arcdps name -> kanaxai.png
    eparchthelonelyking: "eparch", // arcdps name -> eparch.png
    eparch: "eparch",
    sorrowfulspellcaster: "ai",
    whisperingshadow: "whisperingshadow",
    // Old Lion's Court watchknights: dps.report may report the individual
    // Prototype (Vermilion/Indigo/Gold) rather than the strike name. Only
    // Vermilion has its own asset; Indigo & Gold fall back to the court icon.
    prototypeindigo: "oldlionscourt",
    prototypegold: "oldlionscourt",
  };

  /** Return an external (dps.report / imgur / GW2 render) icon URL as-is.
   *  External URLs are handed directly to the <img> src attribute so the browser
   *  loads them from their origin — never re-routed through /bosses/ and never
   *  re-appended with ".png" (which creates broken /bosses/<url>.png.png requests). */
  function iconForExternal(url: string): string {
    return url;
  }

  /** Resolve the boss card icon with the correct priority:
   *    1. story-icon asset (if this is a story boss)
   *    2. LOCAL /static asset via getBossIcon (preferred — we ship these)
   *    3. external dps.report fightIcon URL (last-resort fallback only)
   *    4. /bosses/unknown.png
   *  The local folder wins over boss_icon because we intentionally ship our own
   *  icon set; the external URL is only used when no local asset matches. */
  function resolveBossIconSrc(log: any): string {
    const story = getStoryIcon(log.boss_name, log);
    if (story) return story;
    const local = getBossIcon(log.boss_name, log.num_players);
    if (local !== "/bosses/unknown.png") return local;
    if (log.boss_icon) return iconForExternal(log.boss_icon);
    return "/bosses/unknown.png";
  }

  // Per-boss Challenge Mode / Legendary CM eligibility, per GW2 raid & strike design
  // (authoritative: GW2 Wiki). Keyed by cleaned boss name.
  const RAID_CM_INFO: Record<string, { cm: boolean; lcm: boolean }> = {
    // Wing 1-3: Normal mode only, except Keep Construct (Wing 3) which has CM
    "keepconstruct": { cm: true, lcm: false }, "kc": { cm: true, lcm: false },
    // xera / mcleod (escort) / stronghold → no CM
    // Wing 4: all bosses have CM
    "cairn": { cm: true, lcm: false }, "cairntheindomitable": { cm: true, lcm: false },
    "mursaatoverseer": { cm: true, lcm: false }, "samarog": { cm: true, lcm: false }, "deimos": { cm: true, lcm: false },
    // Wing 5: Soulless Horror + Dhuum have CM; River of Souls (pre-event) & Statues do not
    "soullesshorror": { cm: true, lcm: false }, "riverofsouls": { cm: false, lcm: false }, "dhuum": { cm: true, lcm: false },
    // Wing 6: all bosses have CM
    "conjuredamalgamate": { cm: true, lcm: false }, "largostwins": { cm: true, lcm: false }, "twinlargos": { cm: true, lcm: false }, "qadim": { cm: true, lcm: false },
    // Wing 7: all bosses have CM
    "cardinaladina": { cm: true, lcm: false }, "cardinalsabir": { cm: true, lcm: false }, "qadimthepeerless": { cm: true, lcm: false },
    // Wing 8: all bosses have CM; only Ura has LCM
    "greer": { cm: true, lcm: false }, "greertheblightbringer": { cm: true, lcm: false },
    "decima": { cm: true, lcm: false }, "decimathestormsinger": { cm: true, lcm: false },
    "ura": { cm: true, lcm: true }, "urathesteamshrieker": { cm: true, lcm: true },
    // Strikes with CM; only Temple of Febe has LCM
    "cosmicobservatory": { cm: true, lcm: false },
    // dps.report reports Temple of Febe as "Cerus" (boss in-game name); treat as same LCM fight
    "cerus": { cm: true, lcm: true }, "templeoffebe": { cm: true, lcm: true },
    "aetherbladehideout": { cm: true, lcm: false }, "xunlaijadejunkyard": { cm: true, lcm: false },
    "kainengoverlook": { cm: true, lcm: false }, "harvesttemple": { cm: true, lcm: false },
    "oldlionscourt": { cm: true, lcm: false }, "dagda": { cm: true, lcm: false },
    // Janthir Wilds strikes
    "kela": { cm: true, lcm: false }, "kelaseneschalofwaves": { cm: true, lcm: false },
  };
  function bossCmEligible(cleanName: string): boolean {
    if (FRACTAL_BOSSES.has(cleanName)) return true;
    return !!RAID_CM_INFO[cleanName]?.cm;
  }
  function bossLcmEligible(cleanName: string): boolean {
    if (FRACTAL_BOSSES.has(cleanName)) return false;
    return !!RAID_CM_INFO[cleanName]?.lcm;
  }
  function showChallengeMode(log: UploadRecord): boolean {
    if (log.is_convergence) return !!log.is_cm;
    const c = clean(log.boss_name);
    const enc = getEncounterType(log.boss_name, log.num_players, log.is_convergence);
    // Raids & strikes are gated by per-boss eligibility; fractals keep prior behavior.
    if (enc === "raid" || enc === "strike") return bossCmEligible(c) && !!log.is_cm;
    return !!log.is_cm;
  }
  function showLegendaryCm(log: UploadRecord): boolean {
    if (log.is_convergence) return !!log.is_lcm;
    const c = clean(log.boss_name);
    const enc = getEncounterType(log.boss_name, log.num_players, log.is_convergence);
    if (enc === "raid" || enc === "strike") return bossLcmEligible(c) && !!log.is_lcm;
    return false;
  }

  // Profession data (PROFESSIONS, ELITE_SPEC_ICONS, SPEC_CORE, PROFESSION_GROUPS)
  // is now imported from ../lib/professionData so there is a single source of truth
  // shared with AnalyticsDashboard.svelte and analyticsEngine.ts.
  // Base-profession choices for the shared Profession filter (icon + name).
  const PROFESSION_OPTIONS: { value: number; name: string; icon: string }[] = Object.entries(PROFESSIONS).map(
    ([id, p]) => ({ value: Number(id), name: p.name, icon: p.icon })
  );

  function getProfIcon(player: PlayerInfo): string {
    if (player.elite_spec && ELITE_SPEC_ICONS[player.elite_spec]) {
      return ELITE_SPEC_ICONS[player.elite_spec];
    }
    return PROFESSIONS[player.profession]?.icon ?? "/professions/guardian.png";
  }

  function getSpecName(player: PlayerInfo): string {
    const base = PROFESSIONS[player.profession]?.name ?? "Unknown";
    if (!player.elite_spec) return base;
    const fn = ELITE_SPEC_ICONS[player.elite_spec]?.split("/").pop()?.replace(".png", "");
    return fn ? fn.charAt(0).toUpperCase() + fn.slice(1) : base;
  }

  function getSpecAbbr(player: PlayerInfo): string {
    if (player.elite_spec && ELITE_SPEC_ICONS[player.elite_spec]) {
      const fn = ELITE_SPEC_ICONS[player.elite_spec].split("/").pop()!.replace(".png", "");
      return fn.slice(0, 2).charAt(0).toUpperCase() + fn.slice(1, 2);
    }
    return PROFESSIONS[player.profession]?.abbr ?? "??";
  }

  function getProfColor(profession: number): string {
    return PROFESSIONS[profession]?.color ?? "#64748b";
  }

  function getEliteSpecName(elite: number | undefined, prof: number | undefined): string {
    const base = PROFESSIONS[prof ?? 0]?.name ?? "Unknown";
    if (!elite) return base;
    const fn = ELITE_SPEC_ICONS[elite]?.split("/").pop()?.replace(".png", "");
    return fn ? fn.charAt(0).toUpperCase() + fn.slice(1) : base;
  }

  function groupBySubgroup(players: PlayerInfo[]): Record<number, PlayerInfo[]> {
    const grouped: Record<number, PlayerInfo[]> = {};
    for (const p of players) {
      const sg = p.subgroup || 1;
      if (!grouped[sg]) grouped[sg] = [];
      grouped[sg].push(p);
    }
    return grouped;
  }

  function sortedSubgroups(players: PlayerInfo[]): number[] {
    return Object.keys(groupBySubgroup(players)).map(Number).sort((a, b) => a - b);
  }

  function isCommander(player: PlayerInfo): boolean {
    return player.role?.toLowerCase() === "tank" || player.role?.toLowerCase() === "commander";
  }

  // ─── Discord Formatter ───────────────────────────────────────────────
  function getExpansionNameForWing(wingIndex: number): string {
    if (wingIndex >= 0 && wingIndex <= 3) return "Heart of Thorns";
    if (wingIndex >= 4 && wingIndex <= 6) return "Path of Fire";
    if (wingIndex === 7) return "Janthir Wilds";
    return "";
  }

  function getNonRaidCategory(bossName: string, isConvergence?: boolean, isCm?: boolean): { exp: string, cat: string } {
    const c = clean(bossName);
    if (isConvergence === true) {
      const isJanthir = ["greer", "greertheblightbringer", "greerthebightbringer", "decima", "decimathestormsinger", "ura", "urathesteamshrieker", "convergencemountbalrior"].includes(c);
      const mapPart = isJanthir ? "Janthir Wild" : "SoTo";
      const modePart = isCm ? "CM" : "NM";
      return {
        exp: `${mapPart} ${modePart} Convergences`,
        cat: `${mapPart} ${modePart} Convergences`
      };
    }
    // Strikes: derive expansion header from the canonical registry so the
    // grouping header is consistent regardless of dps.report's raw boss string.
    const si = STRIKE_REGISTRY[c];
    if (si) return { exp: si.expansion, cat: si.expansion };
    if (["shiverpeakspass", "icebroodconstruct", "voiceofthefallen", "clawofthefallen", "voiceandclaw", "kodanbrothers", "fraenirofjormag", "fraenir", "boneskinner", "whisperofjormag", "whisper", "coldwar", "variniastormsounder"].includes(c)) {
      return { exp: "Icebrood Saga Strikes", cat: "Icebrood Saga Strikes" };
    }
    // EoD Strikes
    if (["maitrin", "captainmaitrin", "aetherbladehideout", "ankka", "xunlaijadejunkyard", "ministerli", "kainengoverlook", "dragonvoid", "harvesttemple", "oldlionscourt", "prototypevermilion", "prototypeindigo", "prototypegold"].includes(c)) {
      return { exp: "End of Dragons Strikes", cat: "End of Dragons Strikes" };
    }
    // SotO Strikes
    if (["dagda", "cosmicobservatory", "cerus", "templeoffebe"].includes(c)) {
      return { exp: "Secrets of the Obscure Strikes", cat: "Secrets of the Obscure Strikes" };
    }
    return { exp: "Other Encounters", cat: "Miscellaneous Logs" };
  }

  // Human label for a VL rank id within an encounter (catalog keyed by normalized boss name).
  function vlRankLabel(bossName: string | undefined, rankId: string[] | string | null | undefined): string | null {
    if (!rankId) return null;
    const ids = Array.isArray(rankId) ? rankId : [rankId];
    const key = (bossName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const enc = vlCatalog.find((e) => e.key === key || (e.aliases ?? []).includes(key));
    const labels = ids.map((id) => enc?.ranks.find((r) => r.id === id)?.label).filter(Boolean) as string[];
    return labels.length ? labels.join(" + ") : null;
  }

  // Resolve a strike's canonical instance (strike) name from the registry, used to
  // render the 3-tier formatter header (Expansion / Instance / Boss) for non-raids.
  function strikeInstanceFor(bossName: string | undefined): string | null {
    const key = (bossName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return STRIKE_REGISTRY[key]?.strike ?? null;
  }

  // Copies every available upload URL in `logs` (the current view's scope),
  // newline-joined. Used by the per-view "Copy All Links" buttons.
  async function copyAllLinks(logs: UploadRecord[]) {
    const urls = logs.map(l => l.url).filter((u): u is string => !!u);
    if (urls.length === 0) { showToast("No upload links in this view yet."); return; }
    try {
      await navigator.clipboard.writeText(urls.join("\n"));
      showToast(`Copied ${urls.length} link${urls.length > 1 ? "s" : ""} to clipboard`, "success");
    } catch {
      showToast("⚠ Failed to copy links to clipboard.");
    }
  }

  // ── Harvest Temple (The Dragonvoid) wipe-tally ──────────────────────────
  // The phase where an attempt ended: the highest-order phase that was reached
  // but not cleared (the wipe point). If every phase is cleared the attempt was
  // a full clear (grouped under Soo-Won ✅). Returns null when the log carries
  // no Dragon Council data (e.g. pre-feature EVTC-only uploads).
  function dragonvoidWipePoint(log: any): { name: string; order: number; key: string } | null {
    const phases: any[] = log?.bosses_phases;
    if (!phases || phases.length === 0) return null;
    const uncleared = phases.filter((p) => p.cleared === false);
    if (uncleared.length === 0) {
      return { name: "Soo-Won", order: 9999, key: "kill" };
    }
    uncleared.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const wp = uncleared[uncleared.length - 1];
    return { name: wp.name ?? wp.key ?? "Unknown", order: wp.order ?? 0, key: wp.key ?? "unknown" };
  }

  async function copyToDiscord() {
    const selected = filteredUploads.filter(l => selectedLogs.has(l.file_path));
    if (selected.length === 0) return;

    const lines: string[] = [];
    let lastExpansion = "";

    // Group raid logs by wing, preserve wing + boss order
    const raidSelected = selected.filter(l => getEncounterType(l.boss_name, l.num_players, l.is_convergence) === "raid");
    const nonRaidSelected = selected.filter(l => getEncounterType(l.boss_name, l.num_players, l.is_convergence) !== "raid");

    // Build wing → boss → logs map (only for selected)
    const wingMap = new Map<number, Map<string, UploadRecord[]>>();
    for (const log of raidSelected) {
      const c = clean(log.boss_name);
      const wingIdx = BOSS_TO_WING[c] ?? -1;
      if (!wingMap.has(wingIdx)) wingMap.set(wingIdx, new Map());
      const bm = wingMap.get(wingIdx)!;
      if (!bm.has(c)) bm.set(c, []);
      bm.get(c)!.push(log);
    }

    // Emit wings in order
    for (let wi = 0; wi < WINGS.length; wi++) {
      if (!wingMap.has(wi)) continue;
      const bossMap = wingMap.get(wi)!;
      
      const expName = getExpansionNameForWing(wi);
      if (expName && expName !== lastExpansion) {
        if (lines.length > 0) lines.push("");
        lines.push(`# **${expName}**`);
        lines.push("");
        lastExpansion = expName;
      }
      
      const formattedWing = WINGS[wi].name.replace("·", "-");
      lines.push(`**Raid ${formattedWing}**`);
      lines.push("");

      for (const bossKey of WINGS[wi].bosses) {
        if (!bossMap.has(bossKey)) continue;
        const bosslogs = [...bossMap.get(bossKey)!].sort((a, b) => {
          const aSuccess = a.success === true;
          const bSuccess = b.success === true;
          if (aSuccess && !bSuccess) return 1;
          if (!aSuccess && bSuccess) return -1;
          return 0;
        });
        
        lines.push(`__**${getDiscordBossName(bosslogs[0].boss_name, bosslogs[0].num_players)}**__`);
        for (const l of bosslogs) {
          if (l.url) {
            if (l.success === true) {
              lines.push(`> **Kill Log** → ${l.url}`);
            } else {
              lines.push(`> ${l.url}`);
            }
          }
        }
      }
      lines.push("");
    }

    // Non-raid: group by category and expansion
    // (Dragonvoid logs are intercepted above into the wipe-tally block)
    const dragonvoidSelected = nonRaidSelected.filter((l) => dragonvoidWipePoint(l) !== null);
    const otherNonRaidSelected = nonRaidSelected.filter((l) => dragonvoidWipePoint(l) === null);
    if (otherNonRaidSelected.length > 0) {
      const nonRaidMap = new Map<string, Map<string, Map<string, UploadRecord[]>>>();
      for (const log of otherNonRaidSelected) {
        const { exp, cat } = getNonRaidCategory(log.boss_name ?? "", log.is_convergence, log.is_cm);
        if (!nonRaidMap.has(exp)) nonRaidMap.set(exp, new Map());
        const catMap = nonRaidMap.get(exp)!;
        if (!catMap.has(cat)) catMap.set(cat, new Map());
        const bossMap = catMap.get(cat)!;
        const bKey = log.boss_name ?? "Unknown";
        if (!bossMap.has(bKey)) bossMap.set(bKey, []);
        bossMap.get(bKey)!.push(log);
      }
      
      for (const [exp, catMap] of nonRaidMap) {
        if (exp !== lastExpansion) {
          if (lines.length > 0) lines.push("");
          lines.push(`# **${exp}**`);
          lines.push("");
          lastExpansion = exp;
        }
        for (const [cat, bossMap] of catMap) {
          lines.push(`**${cat}**`);
          lines.push("");
          for (const [bossName, logs] of bossMap) {
            lines.push(`__**${getDiscordBossName(bossName, logs[0].num_players)}**__`);
            const sortedLogs = [...logs].sort((a, b) => {
              const aSuccess = a.success === true;
              const bSuccess = b.success === true;
              if (aSuccess && !bSuccess) return 1;
              if (!aSuccess && bSuccess) return -1;
              return 0;
            });
            for (const l of sortedLogs) {
              if (l.url) {
                if (l.success === true) {
                  lines.push(`> **Kill Log** → ${l.url}`);
                } else {
                  lines.push(`> ${l.url}`);
                }
              }
            }
          }
          lines.push("");
        }
      }
    }

    // ── Harvest Temple (The Dragonvoid) wipe-tally ──────────────────────
    // Group every selected Dragonvoid attempt by the phase where it ended, then
    // emit `**{phase}** ({count})` followed by one bullet per log URL, ordered
    // by fight progression (kills sort last under Soo-Won ✅).
    if (dragonvoidSelected.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push(`# **End of Dragons Strikes**`);
      lines.push("");
      lines.push("**Harvest Temple**");
      lines.push("__**The Dragonvoid**__");
      lines.push("");

      const byWipe = new Map<string, { label: string; order: number; logs: UploadRecord[] }>();
      for (const log of dragonvoidSelected) {
        const wp = dragonvoidWipePoint(log)!;
        const key = wp.key;
        if (!byWipe.has(key)) byWipe.set(key, { label: wp.name, order: wp.order, logs: [] });
        byWipe.get(key)!.logs.push(log);
      }

      const groups = [...byWipe.values()].sort((a, b) => b.order - a.order);
      for (const g of groups) {
        const count = g.logs.length;
        const label = g.order >= 9999 ? `${g.label} ✅` : g.label;
        lines.push(`**${label}** (${count})`);
        for (const l of g.logs) {
          if (l.url) lines.push(`- ${l.url}`);
        }
        lines.push("");
      }
    }

    let text = "";
    if (showFormatterPanel) {
      text = editableFormattedText;
    } else {
      text = lines.join("\n").trim();
    }

    try {
      await navigator.clipboard.writeText(text);
      copyFeedback = `✓ Copied ${selectedLogs.size} log${selectedLogs.size > 1 ? "s" : ""} to clipboard!`;
      setTimeout(() => { copyFeedback = ""; }, 3000);
    } catch {
      copyFeedback = "⚠ Failed to copy to clipboard.";
      setTimeout(() => { copyFeedback = ""; }, 3000);
    }
  }

  // ─── Feed Grouping ───────────────────────────────────────────────────
  // Returns structured list for rendering: wing buckets for raids, boss-groups for others
  interface WingGroup { kind: "wing"; wingIdx: number; wingName: string; bossBuckets: { bossKey: string; bossName: string; logs: UploadRecord[] }[] }
  interface BossGroup { kind: "group"; bossName: string; bossBuckets: { bossKey: string; bossName: string; logs: UploadRecord[] }[]; logs: UploadRecord[] }
  type FeedItem = WingGroup | BossGroup;

  let filteredUploads = $derived((() => {
    // Hide anything the user has deleted from the feed. arcdps keeps re-touching
    // the source .zevtc, which makes the watcher re-emit the same path; a client
    // filter catches that re-emission regardless of Rust-side timing races.
    const deleted = deletedPaths;
    const list = uploads.filter((log) => {
      if (deleted.has(log.file_path)) return false;
      return passesFilters(log);
    });

    const active = list.filter(l => l.status === "Uploading" || !l.boss_name);
    const finished = list.filter(l => l.status !== "Uploading" && l.boss_name);

    if (finished.length > 50) {
      return [...active, ...finished.slice(0, 50)];
    }
    return list;
  })());

  // Returns the inclusive [from, to] "YYYY-MM-DD" bounds implied by the date
  // filter, or null when no date restriction is active. Timestamps are stored as
  // "%Y-%m-%d %H:%M:%S" strings, so the date prefix sorts lexicographically.
  function localYMD(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function dateRange(f: typeof filters): { from: string; to: string } | null {
    const now = new Date();
    const today = localYMD(now);
    switch (f.datePreset) {
      case "all": return null;
      case "today": return { from: today, to: today };
      case "7d": { const d = new Date(now); d.setDate(d.getDate() - 6); return { from: localYMD(d), to: today }; }
      case "30d": { const d = new Date(now); d.setDate(d.getDate() - 29); return { from: localYMD(d), to: today }; }
      case "month": { const d = new Date(now.getFullYear(), now.getMonth(), 1); return { from: localYMD(d), to: today }; }
      case "custom": {
        const from = f.dateFrom || "";
        const to = f.dateTo || "";
        if (!from && !to) return null;
        return { from: from || "0000-01-01", to: to || "9999-12-31" };
      }
    }
    return null;
  }

  // ─── Shared multi-view filter predicate ────────────────────────────────
  // Applies the shared `filters` object to any log list (Feed, History, or a
  // Folder/Subfolder). Active uploads (status Uploading or no boss yet) are
  // always shown so they aren't hidden while a filter is active.
  function passesFilters(log: UploadRecord): boolean {
    const f = filters;
    if (log.status === "Uploading" || !log.boss_name) return true;

    if (f.result === "success" && log.success !== true) return false;
    if (f.result === "failure" && log.success !== false) return false;

    const enc = getEncounterType(log.boss_name, log.num_players, log.is_convergence);
    if (f.type !== "all" && enc !== f.type) return false;

    if (f.boss !== "all") {
      const key = clean(log.boss_name);
      if (key !== f.boss) return false;
    }

    if (f.cmMode !== "all") {
      if (f.cmMode === "cm" && log.is_cm !== true) return false;
      if (f.cmMode === "lcm" && log.is_lcm !== true) return false;
      if (f.cmMode === "normal" && (log.is_cm === true || log.is_lcm === true || log.is_quick_play === true)) return false;
      if (f.cmMode === "quickplay" && log.is_quick_play !== true) return false;
    }

    // Profession filter. `professionKind` disambiguates the value:
    //  - "core": a base PROFESSIONS id (1-9) → match a squad member's base profession
    //  - "spec": an elite_spec id (5-81) → match a squad member's elite_spec exactly
    // This avoids the base-id/elite-id collision (e.g. 5 = Druid spec vs Thief core).
    if (f.profession !== "all") {
      const want = Number(f.profession);
      const has = (log.players ?? []).some(p =>
        f.professionKind === "spec" ? p.elite_spec === want : p.profession === want
      );
      if (!has) return false;
    }

    // Has notes filter
    if (f.hasNotes && (!log.notes || log.notes.length === 0)) return false;

    if (f.vlRank !== "all") {
      const ranks = vlRanksOf(log);
      if (f.vlRank === "none" && ranks.length > 0) return false;
      if (f.vlRank === "any" && ranks.length === 0) return false;
      if (f.vlRank !== "none" && f.vlRank !== "any" && !ranks.includes(f.vlRank)) return false;
    }
    // Date filter: compare the log's "YYYY-MM-DD" prefix against the active range.
    if (f.datePreset !== "all") {
      const range = dateRange(f);
      if (range) {
        const d = log.timestamp ? log.timestamp.slice(0, 10) : "";
        if (!d) return false; // no timestamp -> can't satisfy a date window
        if (d < range.from || d > range.to) return false;
      }
    }

    // Time-of-day filter: narrow by the "HH:MM" portion of the timestamp. Works
    // with OR without a date preset. Leave both empty for no time restriction
    // (a range, not an exact-minute match — e.g. From 21:00 / To 21:59).
    if (f.timeFrom || f.timeTo) {
      const t = log.timestamp ? log.timestamp.slice(11, 16) : "";
      if (!t) return false; // no timestamp -> can't satisfy a time window
      if (f.timeFrom && t < f.timeFrom) return false;
      if (f.timeTo && t > f.timeTo) return false;
    }

    const q = f.search.trim().toLowerCase();
    if (q) {
      const bossMatch =
        (log.boss_name || "").toLowerCase().includes(q) ||
        getBossDisplayName(log.boss_name).toLowerCase().includes(q) ||
        getFractalName(log.boss_name).toLowerCase().includes(q);
      const playerMatch = log.players?.some(p =>
        p.display_name.toLowerCase().includes(q) ||
        p.account.toLowerCase().includes(q) ||
        getSpecName(p).toLowerCase().includes(q)
      ) || false;
      if (!bossMatch && !playerMatch) return false;
    }
    return true;
  }

  function filterLogs(logs: UploadRecord[]): UploadRecord[] {
    const out: UploadRecord[] = [];
    for (const l of logs) if (passesFilters(l)) out.push(l);
    return out;
  }

  // Distinct bosses present in a log set -> options for the boss dropdown.
  // Returns [{ key: normalized, label: display }] sorted by label.
  function distinctBossOptions(logs: UploadRecord[]): { key: string; label: string }[] {
    const seen = new Map<string, string>(); // key -> label
    for (const l of logs) {
      if (!l.boss_name) continue;
      const key = clean(l.boss_name);
      if (!seen.has(key)) seen.set(key, getBossDisplayName(l.boss_name) || l.boss_name);
    }
    return [...seen.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function setBossFilter(log: UploadRecord) {
    if (!log.boss_name) return;
    filters.boss = clean(log.boss_name);
    filters.search = "";
  }
  function setVlRankFilter(rankId: string) {
    filters.vlRank = rankId;
  }
  function clearBossFilter() {
    filters.boss = "all";
  }

  // ─── Capture Session (live "raid night" collector, distinct from Folders) ──
  // A Capture Session tags every NEW Feed log while active, then on End files
  // them into a Folder subfolder. Persisted to capture_session.json so it
  // survives an app restart mid-session. Fully separate from config.sessions.
  type CaptureSession = {
    id: string;
    name: string;
    state: "collecting" | "paused"; // 'collecting' tags incoming logs; 'paused' freezes
    logPaths: string[];             // file_paths captured so far (for End move)
  } | null;
  let captureSession = $state<CaptureSession>(null);
  let sessionColor = $state("var(--accent)");
  let showConfirmDelete = $state(false)
  let pendingDeleteSubFolder = $state<{ sessionId: string; subFolderId: string; name: string } | null>(null)
  let pendingDeleteWh = $state<string | null>(null)
  const FOLDER_PALETTE = [
    { name: "Teal", hex: "#14b8a6" }, { name: "Cyan", hex: "#06b6d4" },
    { name: "Sky", hex: "#0ea5e9" }, { name: "Blue", hex: "#3b82f6" },
    { name: "Indigo", hex: "#6366f1" }, { name: "Violet", hex: "#8b5cf6" },
    { name: "Purple", hex: "#a855f7" }, { name: "Fuchsia", hex: "#d946ef" },
    { name: "Pink", hex: "#ec4899" }, { name: "Rose", hex: "#f43f5e" },
    { name: "Red", hex: "#ef4444" }, { name: "Orange", hex: "#f97316" },
    { name: "Amber", hex: "#f59e0b" }, { name: "Yellow", hex: "#eab308" },
    { name: "Lime", hex: "#84cc16" }, { name: "Green", hex: "#22c55e" },
    { name: "Emerald", hex: "#10b981" }, { name: "Slate", hex: "#64748b" },
    { name: "Zinc", hex: "#71717a" }, { name: "Stone", hex: "#a8a29e" },
    { name: "Brown", hex: "#b45309" }, { name: "Neutral", hex: "#737373" },
    { name: "Slate-600", hex: "#475569" }, { name: "Slate-800", hex: "#1e293b" }
  ];
  function loadCaptureSession() {
    try {
      const raw = localStorage.getItem("capture_session");
      if (raw) captureSession = JSON.parse(raw);
    } catch { /* ignore corrupt */ }
  }
  function persistCaptureSession() {
    try {
      if (captureSession) localStorage.setItem("capture_session", JSON.stringify(captureSession));
      else localStorage.removeItem("capture_session");
    } catch { /* ignore */ }
  }
  function startCaptureSession() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const name = `Session ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    captureSession = { id: crypto.randomUUID(), name, state: "collecting", logPaths: [] };
    sessionColor = "#6366f1";
    persistCaptureSession();
  }
  function pauseCaptureSession() {
    if (captureSession) { captureSession = { ...captureSession, state: "paused" }; persistCaptureSession(); }
  }
  function resumeCaptureSession() {
    if (captureSession) { captureSession = { ...captureSession, state: "collecting" }; persistCaptureSession(); }
  }
  function capturedLogs(): UploadRecord[] {
    if (!captureSession) return [];
    const set = new Set(captureSession.logPaths);
    return uploads.filter(u => set.has(u.file_path));
  }
  // End a Capture Session: file captured logs into a Folder as a new subfolder
  // (Option A). Reuses the existing unified PickerModal + createSubFolder +
  // addWingLogsToSession so behaviour matches the Folders feature exactly.
  function endCaptureSession() {
    if (!captureSession) return;
    const logs = capturedLogs();
    if (logs.length === 0) {
      captureSession = null;
      persistCaptureSession();
      return;
    }
    pickerModal = {
      title: "File Session To…",
      logs,
      sessionId: null,
      excludeSubFolderId: null,
      onPick: (targetFolderId) => {
        // `target` is the chosen Folder (session) id. Create a subfolder named
        // after this capture session (editable in the modal), with the chosen
        // color, then drop the logs into it.
        createSubFolder(targetFolderId as unknown as string, captureSession!.name, sessionColor);
        const folder = sessions.find(s => s.id === targetFolderId);
        const sub = folder?.subfolders?.find(sf => sf.name === captureSession!.name);
        if (sub) addWingLogsToSession(folder!.id, logs, sub.id);
        // Logs now live in the Folder — drop them from the Feed view.
        const paths = new Set(captureSession!.logPaths);
        uploads = uploads.filter(u => !paths.has(u.file_path));
        persistFeed();
        captureSession = null;
        persistCaptureSession();
      },
    };
  }

  // ─── Session / History State ─────────────────────────────────────────
  let sessions = $state<SavedSession[]>([]);
  let activeSessionId = $state<string | null>(null);
  let sessionTip = $state<{ show: boolean; name: string; top: number; left: number }>({ show: false, name: '', top: 0, left: 0 });
  let subFolderId = $state<string | null>(null);

  // ─── Squad Planner ──────────────────────────────────────────────────────
  // Feature flag: set true to restore the Planner tab/UI.
  const SHOW_SQUAD_PLANNER = false;
  let squadPlans = $state<SquadPlan[]>([]);
  let editingPlan = $state<SquadPlan | null>(null); // null = modal closed
  let creatingPlan = $state(false);
  let squadFolderStack = $state<SquadPlan[]>([]); // breadcrumb of opened folders
  // True only after loadConfig() has populated `squadPlans` from disk at least once.
  // Guards the autosave effect so the empty pre-load `[]` state can never be written
  // back over (and wipe) real persisted plans. See persistConfig() guard below.
  let squadPlansLoaded = $state(false);
  // True when a folder is currently open (comp being edited inherits its wing context).
  let inFolder = $derived(squadFolderStack.length > 0);

  // Full history (all logs, unfiltered) loaded once when the app opens. Filtering
  // + pagination happen client-side via `filteredHistory` / `pagedHistory` so the
  // shared FilterBar works over the ENTIRE history, not just the visible page.
  // (Single source of truth — avoids duplicating the boss-classification logic in
  // Rust, which only the frontend has.)
  let allHistory = $state.raw<UploadRecord[]>([]);
  let isHistoryLoading = $state(false);
  let historyPage = $state(0);
  let historyLimit = $state(25);
  let filteredHistory = $derived(filterLogs(allHistory)); // full filtered list
  // Count of logs whose Wingman import failed — drives the sidebar "Retry all failed" button.
  let failedWingmanCount = $derived(
    allHistory.filter((h) => h.wingman_status === "failed").length,
  );
  // Count of logs currently parked as On Hold (dps.report down) — drives the
  // "Retry on Hold" button + resume counter below the dps.report API status.
  let onHoldCount = $derived(
    [...uploads, ...allHistory].filter((h) => h.status === "On Hold").length,
  );
  let historyLogs = $derived(filteredHistory);             // alias for code that expected the full list
  let historyTotalCount = $derived(filteredHistory.length);// drives the pager
  // Launch-time CM/LCM Mode-flag self-heal progress (Rust emits `repair_progress`).
  // repairProgress removed - repair badge feature deprecated
  // repairHideTimer removed - repair badge feature deprecated
  // One-time notice shown when the user's machine lacks the .NET 8 Desktop
  // Runtime the bundled Elite Insights needs. Without it, local parsing falls
  // back to dps.report (uploads still work, but cards aren't from EI).
  let eiRuntimeNotice = $state<{ url: string } | null>(null);
  let pagedHistory = $derived.by(() => {
    const start = historyPage * historyLimit;
    return filteredHistory.slice(start, start + historyLimit);
  });
  // Reset to page 1 whenever any filter changes so a now-shorter list never
  // leaves the user stranded on a blank page 3.
  $effect(() => { filters; historyPage = 0; });
  let pendingManualTargets: Record<string, { sessionId: string; subFolderId: string | null }> = {};
  let deletingLogPaths = $state<Set<string>>(new Set());
  let toastMsg = $state<string | null>(null);
  let toastType = $state<"default" | "offline" | "online" | "success">("default");
  let toastIcon = $state<string>("⚠️");
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function showToast(msg: string, type: "default" | "offline" | "online" | "success" = "default") {
    toastMsg = msg;
    toastType = type;
    toastIcon = type === "offline" ? "📡" : type === "online" ? "✅" : type === "success" ? "✅" : "⚠️";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastMsg = null; }, 3200);
  }

  // ─── Auto-updater ────────────────────────────────────────────────────────
  let updateAvailable = $state<Update | null>(null);
  let updateChecking = $state(false);
  // Version we've already nudged the user about, so the hourly poll toasts only
  // once per new release (the persistent banner keeps showing it after that).
  let lastNotifiedVersion = $state<string | null>(null);
  // Full-screen modal takeover so a download/install is never "invisible".
  let updateModalOpen = $state(false);
  let updatePhase = $state<"downloading" | "ready" | "installing" | "restarting">("downloading");
  let updateDownloaded = $state(false); // true once bytes are fully downloaded
  let downloadPct = $state(0); // 0..100; -1 = indeterminate (server omitted size)
  let downloadLabel = $state("Starting update…");

  function showUpdateModal() {
    updateModalOpen = true;
    // Bring the window to the front so the prompt can't be missed behind another app.
    getCurrentWindow().unminimize().catch(() => {});
    getCurrentWindow().show().catch(() => {});
    getCurrentWindow().setFocus().catch(() => {});
  }

  async function checkForUpdate(silent = false) {
    if (updateChecking) return;
    updateChecking = true;
    try {
      const u = await check();
      if (u) {
        updateAvailable = u;
        // Only toast on first sighting of a given version (e.g. the hourly poll).
        // Subsequent polls keep the banner but stay quiet to avoid nagging.
        if (u.version !== lastNotifiedVersion) {
          lastNotifiedVersion = u.version;
          showToast(`Update ${u.version} ready — restart to apply`);
        }
      } else if (!silent) {
        showToast("You're on the latest version");
      }
    } catch (e) {
      const err = e as unknown as { message?: string };
      const msg = err?.message ?? (typeof e === "string" ? e : JSON.stringify(e));
      if (!silent) showToast("Update check failed: " + msg);
      console.error("update check failed:", e);
    } finally {
      updateChecking = false;
    }
  }

  async function applyUpdate() {
    const u = updateAvailable;
    if (!u) return;
    // Open the modal immediately so the click visibly "does something".
    showUpdateModal();
    updatePhase = "downloading";
    updateDownloaded = false;
    downloadPct = 0;
    downloadLabel = "Downloading update…";
    try {
      let total = 0;
      let received = 0;
      // Download only — no auto-install. User clicks "Install & Restart".
      await u.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          downloadPct = total > 0 ? 0 : -1; // -1 = indeterminate
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          downloadPct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : -1;
          downloadLabel = total > 0
            ? `Downloading update… ${downloadPct}%`
            : "Downloading update…";
        } else if (event.event === "Finished") {
          downloadPct = 100;
          downloadLabel = "Download complete";
        }
      });
      updateDownloaded = true;
      updatePhase = "ready"; // wait for the user's explicit Install click
      downloadLabel = "Ready to install";
    } catch (e) {
      updateModalOpen = false; // let the user try again from the banner
      showToast("Update download failed");
      console.error("update download failed:", e);
    }
  }

  // Triggered only by the user's "Install & Restart" click.
  async function installUpdate() {
    const u = updateAvailable;
    if (!u || !updateDownloaded) return;
    updatePhase = "installing";
    downloadLabel = "Installing update…";
    try {
      await u.install();
      updatePhase = "restarting";
      downloadLabel = "Restarting…";
      await relaunch();
    } catch (e) {
      updateModalOpen = false;
      showToast("Update install failed");
      console.error("update install failed:", e);
    }
  }

  // ─── UI State ────────────────────────────────────────────────────────
  let activeReplayUrl = $state<string | null>(null);
  let isIframeLoading = $state(false);
  let zoomLevel = $state(1.0);
  let isFullscreen = $state(false);
  let dpsReportStatus = $state<string>("unknown");
  let bDpsReportStatus = $state<string>("unknown");
  let wingmanStatus = $state<"online" | "offline" | "degraded" | "unknown">("unknown");
  let newSessionName = $state("");
  let newSessionColor = $state("#14b8a6");
  // Folders-tab modal state (New Folder + Edit Folder share the same modal shell).
  let newFolderModalOpen = $state(false);
  let editFolderId = $state<string | null>(null);
  let editFolderName = $state("");
  let editFolderColor = $state("#14b8a6");
  let creatingNewFolderInPicker = $state(false);
  let isCreatingSubFolder = $state(false);
  let newSubFolderName = $state("");
  let newSubFolderColor = $state("#14b8a6");
  let creatingSubFolderId = $state<string | null>(null);
  let deletingSubFolderId = $state<string | null>(null);
  let subFolderMenuId = $state<string | null>(null);
  let renamingSubFolderId = $state<string | null>(null);
  let renameSubFolderValue = $state("");
  let recoloringSubFolderId = $state<string | null>(null);
  let confirmDialog = $state<{ title: string; message: string; onConfirm: () => void } | null>(null);
  function openConfirm(title: string, message: string, onConfirm: () => void) {
    confirmDialog = { title, message, onConfirm };
  }
  function closeConfirm() {
    confirmDialog = null;
  }
  // Autofocus action for the subfolder-name input when the modal opens.
  function focusOnMount(node: HTMLInputElement) {
    node.focus();
    return {};
  }
  let showUploadTargetDropdown = $state(false);
  let copiedLogPath = $state<string | null>(null);

  // ─── Context menu ─────────────────────────────────────────────────────
  let ctxMenu = $state<{ x: number; y: number; items: { label: string; icon?: string; danger?: boolean; onSelect: () => void }[] } | null>(null);
  function openContextMenu(x: number, y: number, items: { label: string; icon?: string; danger?: boolean; onSelect: () => void }[]) {
    ctxMenu = { x, y, items };
  }
  function closeContextMenu() { ctxMenu = null; }
  function handleLogContextMenu(e: MouseEvent, log: any, isSession: boolean, sessionId?: string, onDelete?: () => void) {
    e.preventDefault();
    const items: { label: string; icon: string; danger?: boolean; onSelect: () => void; }[] = [
      { label: 'Open log link', icon: 'fa-arrow-up-right-from-square', onSelect: () => { if (isOnline && log.url) openExternalUrl(log.url); } },
      { label: 'Copy log link', icon: 'fa-copy', onSelect: () => { if (isOnline && log.url) copySingleLink(log.url, log.file_path); } },
      { label: '2D Replay', icon: 'fa-gamepad', onSelect: () => { if (isOnline && log.url) openReplayModal(log.url); } },
      { label: 'Save to Session…', icon: 'fa-folder-open', onSelect: () => openSavePicker([log], (sid) => addLogToSession(log.file_path, sid)) }
    ];

    if (isSession && sessionId) {
      items.push({ 
        label: 'Move to subfolder…', 
        icon: 'fa-folder', 
        onSelect: () => openMovePicker(log, sessionId, null, (target) => moveLogToSubFolder(sessionId, log.file_path, target)) 
      });
    }

    if (log.status === "Failed" || log.status === "On Hold" || log.status === "Duplicate") {
      items.push({ label: 'Retry upload', icon: 'fa-rotate-right', onSelect: () => retryLog(log.file_path) });
    }

    items.push({
      label: 'Delete',
      icon: 'fa-trash-can',
      danger: true,
      onSelect: () => {
        if (onDelete) {
          onDelete();
        } else if (isSession) {
          deleteLogRecord(log.file_path);
        } else {
          deleteHistoryLog(log.file_path);
        }
      }
    });

    openContextMenu(e.clientX, e.clientY, items);
  }

  // ─── Computed ────────────────────────────────────────────────────────
  let activeSession = $derived(sessions.find(s => s.id === activeSessionId) ?? null);

  // ─── UI Helpers ──────────────────────────────────────────────────────
  function toggleExpand(id: string) {
    expanded[id] = !expanded[id];
  }

  function toggleSelectLog(filePath: string) {
    const next = new Set(selectedLogs);
    if (next.has(filePath)) {
      next.delete(filePath);
    } else {
      next.add(filePath);
    }
    selectedLogs = next;
  }

  function isWingFullySelected(logs: UploadRecord[]): boolean {
    return logs.every(l => selectedLogs.has(l.file_path));
  }

  function toggleSelectWing(logs: UploadRecord[]) {
    // Toggle the whole group: if every log is already selected, deselect all;
    // otherwise select all. Fixes "unchecking the group box does nothing" — the
    // old default (select=true) could only ever add, never remove.
    const select = !logs.every((l) => selectedLogs.has(l.file_path));
    const next = new Set(selectedLogs);
    for (const l of logs) {
      if (select) {
        next.add(l.file_path);
      } else {
        next.delete(l.file_path);
      }
    }
    selectedLogs = next;
  }

  // ─── Selected-logs bulk actions (Copy Links / Move to Folder) ───
  // Reuse the existing PickerModal + clipboard flows; just scope to the checkbox
  // selection instead of "all logs in this view".
  function selectedInList(list: UploadRecord[]): UploadRecord[] {
    return list.filter((l) => selectedLogs.has(l.file_path));
  }

  async function copySelectedLinks(candidates: UploadRecord[]) {
    await copyAllLinks(selectedInList(candidates));
  }

  function moveSelectedToFolder(candidates: UploadRecord[]) {
    const selected = selectedInList(candidates);
    if (selected.length === 0) return;
    if (activeTab === "session" && activeSessionId) {
      // Already inside a Folder — move selection into a subfolder of THIS folder.
      const sid = activeSessionId;
      openMoveGroupPicker(selected, null, (target) => {
        for (const l of selected) moveLogToSubFolder(sid, l.file_path, target);
      });
    } else {
      // Feed / History: logs aren't in a session yet — "Move to Folder" means
      // save the selection into a chosen Folder.
      openSavePicker(selected, (sid) => {
        for (const l of selected) addLogToSession(l.file_path, sid);
      });
    }
  }

  function addLogToSession(filePath: string, sessionId: string) {
    const session = sessions.find(s => s.id === sessionId);
    const log = uploads.find(u => u.file_path === filePath) ?? allHistory.find(h => h.file_path === filePath);
    if (session && log) {
      if (!session.logs.some(l => l.file_path === filePath)) {
        session.logs = [...session.logs, log];
        sessions = [...sessions];
        persistConfig();
      }
    }
  }

  function removeLogFromSession(sessionId: string, filePath: string) {
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      session.logs = session.logs.filter((l) => l.file_path !== filePath);
      if (session.subfolders) {
        for (const sf of session.subfolders) {
          sf.logs = sf.logs.filter((l) => l.file_path !== filePath);
        }
      }
      sessions = [...sessions];
      persistConfig();
    }
  }

  function fadeRemoveFromSession(sessionId: string, filePath: string) {
    deletingLogPaths.add(filePath);
    deletingLogPaths = new Set(deletingLogPaths);
    setTimeout(() => {
      removeLogFromSession(sessionId, filePath);
      deletingLogPaths.delete(filePath);
      deletingLogPaths = new Set(deletingLogPaths);
    }, 280);
  }

  function removeLogFromSubFolder(sessionId: string, subFolderIdParam: string, filePath: string) {
    const session = sessions.find((s) => s.id === sessionId);
    if (session?.subfolders) {
      const sf = session.subfolders.find((sf) => sf.id === subFolderIdParam);
      if (sf) {
        sf.logs = sf.logs.filter((l) => l.file_path !== filePath);
        sessions = [...sessions];
        persistConfig();
      }
    }
  }

  function fadeRemoveFromSubFolder(sessionId: string, subFolderIdParam: string, filePath: string) {
    deletingLogPaths.add(filePath);
    deletingLogPaths = new Set(deletingLogPaths);
    setTimeout(() => {
      removeLogFromSubFolder(sessionId, subFolderIdParam, filePath);
      deletingLogPaths.delete(filePath);
      deletingLogPaths = new Set(deletingLogPaths);
    }, 280);
  }

  async function deleteLogGroup(filePaths: string[]) {
    if (filePaths.length === 0) return;
    // FEED-ONLY group delete: remove from the Uploads Feed and suppress the watcher
    // re-queue (deleted_paths.json). Never touches History or Folders.
    uploads = uploads.filter(u => !filePaths.includes(u.file_path));
    persistFeed();
    for (const p of filePaths) deletedPaths.add(p);
    deletedPaths = new Set(deletedPaths);
    try {
      for (const p of filePaths) await invoke("mark_log_deleted", { filePath: p });
    } catch (err) {
      console.error("Failed to mark group logs as deleted from feed:", err);
    }
  }

  function removeGroupFromSession(sessionId: string, logs: UploadRecord[]) {
    for (const log of logs) {
      removeLogFromSession(sessionId, log.file_path);
    }
  }

  function removeGroupFromSubFolder(sessionId: string, subFolderIdParam: string, logs: UploadRecord[]) {
    for (const log of logs) {
      removeLogFromSubFolder(sessionId, subFolderIdParam, log.file_path);
    }
  }

  function addWingLogsToSession(sessionId: string, logs: UploadRecord[], targetSubFolderId: string | null = null) {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    for (const log of logs) {
      if (targetSubFolderId) {
        const target = session.subfolders?.find(sf => sf.id === targetSubFolderId);
        if (target && !target.logs.some(l => l.file_path === log.file_path)) {
          target.logs = [...target.logs, log];
        }
      } else if (!session.logs.some(l => l.file_path === log.file_path)) {
        session.logs = [...session.logs, log];
      }
    }
    sessions = [...sessions];
    persistConfig();
  }

  function moveGroupLogsToSubFolder(sessionId: string, logs: UploadRecord[], subFolderIdParam: string | null) {
    for (const log of logs) {
      moveLogToSubFolder(sessionId, log.file_path, subFolderIdParam);
    }
  }

  // Create a new Folder from the Folders-tab modal, then close the modal.
  function createSession(): string | null {
    if (!newSessionName.trim()) return null;
    const newSession: SavedSession = {
      id: crypto.randomUUID(),
      name: newSessionName.trim().substring(0, 32),
      color: newSessionColor,
      logs: []
    };
    sessions = [...sessions, newSession];
    newSessionName = "";
    persistConfig();
    newFolderModalOpen = false;
    newSessionColor = "#14b8a6";
    return newSession.id;
  }

  function deleteSession(id: string) {
    sessions = sessions.filter(s => s.id !== id);
    if (activeSessionId === id) activeSessionId = null;
    persistConfig();
  }

  // Rename a Folder (used by the in-card rename in the Folders tab gallery).
  // Apply an Edit Folder modal: rename + recolor a Folder, persisting to config.
  function applyEditFolder() {
    const s = sessions.find(x => x.id === editFolderId);
    if (s && editFolderName.trim()) {
      s.name = editFolderName.trim().substring(0, 32);
      s.color = editFolderColor;
      sessions = [...sessions];
      persistConfig();
    }
    newFolderModalOpen = false;
    editFolderId = null;
    editFolderName = "";
    editFolderColor = "#14b8a6";
  }

  // Open the Edit Folder modal pre-filled with the folder's current name + color.
  function openEditFolder(id: string) {
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    editFolderId = id;
    editFolderName = s.name;
    editFolderColor = swatchHex(s.color);
    newFolderModalOpen = true;
  }

  // Total logs across a Folder's Main Folder + every subfolder (for the gallery count).
  function sessionTotalLogs(s: SavedSession): number {
    const subs = s.subfolders ?? [];
    return (s.logs?.length ?? 0) + subs.reduce((n, sf) => n + (sf.logs?.length ?? 0), 0);
  }

  // Most-recent log timestamp across root + subfolders, for the gallery "last log" line.
  function sessionLastLog(s: SavedSession): string {
    const all = [...(s.logs ?? [])];
    for (const sf of (s.subfolders ?? [])) all.push(...(sf.logs ?? []));
    let latest = "";
    for (const l of all) {
      if (l.timestamp && l.timestamp > latest) latest = l.timestamp;
    }
    return latest;
  }

  // Human "last log" label from an ISO timestamp (e.g. "Jul 27, 17:24").
  function formatSessionLast(ts: string): string {
    if (!ts) return "No logs yet";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "No logs yet";
    const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return `${date}, ${time}`;
  }

  function groupLogsForSession(sessionLogs: UploadRecord[]): FeedItem[] {
    const items: FeedItem[] = [];
    const resolvedLogs = sessionLogs.filter(l => l.boss_name);

    const wingBuckets = new Map<number, Map<string, { bossName: string; logs: UploadRecord[] }>>();
    for (const log of resolvedLogs) {
      if (getEncounterType(log.boss_name, log.num_players, log.is_convergence) !== "raid") continue;
      const c = clean(log.boss_name);
      const wi = BOSS_TO_WING[c] ?? 999;
      if (!wingBuckets.has(wi)) wingBuckets.set(wi, new Map());
      const bm = wingBuckets.get(wi)!;
      if (!bm.has(c)) bm.set(c, { bossName: log.boss_name ?? c, logs: [] });
      bm.get(c)!.logs.push(log);
    }

    const sortedWings = [...wingBuckets.keys()].sort((a, b) => a - b);
    for (const wi of sortedWings) {
      const bm = wingBuckets.get(wi)!;
      const bossBuckets = [...bm.keys()].map(bk => ({
        bossKey: bk,
        bossName: bm.get(bk)!.bossName,
        logs: bm.get(bk)!.logs
      }));
      items.push({ kind: "wing", wingIdx: wi, wingName: wi < WINGS.length ? WINGS[wi].name : `Wing ${wi + 1}`, bossBuckets });
    }

    const catBuckets = new Map<string, Map<string, { bossName: string; logs: UploadRecord[] }>>();
    for (const log of resolvedLogs) {
      if (getEncounterType(log.boss_name, log.num_players, log.is_convergence) === "raid") continue;
      const c = clean(log.boss_name);
      const frac = getFractalName(log.boss_name, log.num_players);
      // STRIKE_REGISTRY is authoritative for grouping so strikes whose boss name
      // collides with a fractal (e.g. Captain Mai Trin / "Mai Trin Boss") still
      // nest under their expansion instead of a phantom fractal category.
      const storyInst = getStoryInstance(log.boss_name, log);
      const catName = storyInst ? "Personal Story" : (STRIKE_REGISTRY[c]?.expansion ?? (frac ? frac : (BOSS_CATEGORIES[c] ?? (log.is_wvw ? "World vs World" : "Other Strikes"))));
      if (!catBuckets.has(catName)) catBuckets.set(catName, new Map());
      const bm = catBuckets.get(catName)!;
      // sub-bucket key = canonical strike name (so dps.report's map vs NPC aliases collapse together,
      // and multiple attempts of the same strike stack under one strike sub-header)
      const strikeKey = storyInst ?? (STRIKE_REGISTRY[c]?.strike ?? (frac ? c : getBossDisplayName(log.boss_name)));
      // Sub-header = canonical strike name (e.g. "Aetherblade Hideout"), never the
      // fractal/boss alias (e.g. "Mai Trin Boss") that dps.report sometimes sends.
      const headerName = storyInst || frac || (STRIKE_REGISTRY[c]?.strike ?? getBossDisplayName(log.boss_name));
      if (!bm.has(strikeKey)) bm.set(strikeKey, { bossName: headerName, logs: [] });
      bm.get(strikeKey)!.logs.push(log);
    }

    for (const [catName, bm] of catBuckets) {
      const bossBuckets = [...bm.entries()].map(([bk, v]): { bossKey: string; bossName: string; logs: UploadRecord[] } => ({ bossKey: bk, bossName: v.bossName, logs: v.logs }));
      items.push({ kind: "group", bossName: catName, bossBuckets, logs: bossBuckets.flatMap((b) => b.logs) });
    }

    return items;
  }

  function cardId(log: any): string {
    return log.file_path;
  }

  function toggleNotes(id: string) {
    notesOpen[id] = !notesOpen[id];
  }

  let noteDraft = $state<Record<string, string>>({});
  function updateLogInUploads(filePath: string, updater: (log: any) => any) {
    const idx = uploads.findIndex((u: any) => u.file_path === filePath);
    if (idx >= 0) {
      const newUploads = [...uploads];
      newUploads[idx] = updater(newUploads[idx]);
      uploads = newUploads;
    }
    const hIdx = allHistory.findIndex((h: any) => h.file_path === filePath);
    if (hIdx >= 0) {
      const newHistory = [...allHistory];
      newHistory[hIdx] = updater(newHistory[hIdx]);
      allHistory = newHistory;
    }
    // Also update in sessions/folders/subfolders
    const newSessions = sessions.map((s: any) => {
      let changed = false;
      const newLogs = s.logs.map((l: any) => {
        if (l.file_path === filePath) { changed = true; return updater(l); }
        return l;
      });
      let newSubfolders = s.subfolders;
      if (s.subfolders) {
        newSubfolders = s.subfolders.map((sf: any) => {
          const sfLogs = sf.logs.map((l: any) => {
            if (l.file_path === filePath) { changed = true; return updater(l); }
            return l;
          });
          return { ...sf, logs: sfLogs };
        });
      }
      if (changed) return { ...s, logs: newLogs, subfolders: newSubfolders };
      return s;
    });
    sessions = newSessions;
  }
  function addNote(log: any) {
    const id = cardId(log);
    const text = (noteDraft[id] ?? "").trim();
    if (!text) return;
    const newNote = { id: `tmp${Date.now()}`, text, created_at: new Date().toISOString() };
    invoke("add_log_note", { filePath: log.file_path, text }).catch(console.error);
    updateLogInUploads(log.file_path, (l: any) => ({ ...l, notes: [...(l.notes ?? []), newNote] }));
    noteDraft[id] = "";
  }
  function removeNote(log: any, noteId: string) {
    const id = cardId(log);
    invoke("delete_log_note", { filePath: log.file_path, noteId }).catch(console.error);
    updateLogInUploads(log.file_path, (l: any) => ({ ...l, notes: (l.notes ?? []).filter((n: any) => n.id !== noteId) }));
  }

  function triggerCustomConfirm(title: string, message: string, onConfirm: () => void) {
    confirmTitle = title;
    confirmMessage = message;
    confirmCallback = onConfirm;
    showConfirmModal = true;
  }

  // In Main Folder view (subFolderId === null), the pool is the deduplicated union
  // of session logs + every subfolder's logs, so filters/search span ALL logs.
  // In a specific subfolder, the pool is just that subfolder's logs.
  function sessionLogPool(s: SavedSession | null): UploadRecord[] {
    if (!s) return [];
    if (subFolderId !== null) return s.subfolders?.find((x) => x.id === subFolderId)?.logs ?? [];
    const seen = new Set<string>();
    const out: UploadRecord[] = [];
    const push = (l: UploadRecord) => {
      if (!l?.file_path || seen.has(l.file_path)) return;
      seen.add(l.file_path);
      out.push(l);
    };
    for (const l of s.logs ?? []) push(l);
    for (const sf of s.subfolders ?? []) for (const l of sf.logs ?? []) push(l);
    return out;
  }

  function hasActiveFilter(): boolean {
    const f = filters;
    return (
      f.search.trim() !== "" ||
      f.result !== "all" ||
      f.type !== "all" ||
      f.cmMode !== "all" ||
      f.datePreset !== "all" ||
      f.boss !== "all" ||
      f.vlRank !== "all" ||
      f.profession !== "all" ||
      f.timeFrom !== "" ||
      f.timeTo !== ""
    );
  }

  // What the Main Folder / subfolder actually RENDERS.
  //  - specific subfolder        -> just that subfolder's logs
  //  - Main Folder + filter active -> aggregate (search spans ALL subfolders)
  //  - Main Folder idle (no filter) -> root logs only (stays empty until you search)
  function sessionDisplayPool(s: SavedSession | null): UploadRecord[] {
    if (!s) return [];
    if (subFolderId !== null) return sessionLogPool(s);
    if (hasActiveFilter()) return sessionLogPool(s);
    return s.logs ?? [];
  }

  function getFilteredSessionLogs(activeSession: SavedSession | null): UploadRecord[] {
    if (!activeSession) return [];
    // Apply the shared FilterBar predicate so Folders filters identically to the
    // Feed / History. In Main Folder the aggregate spans every subfolder's logs
    // ONLY while a filter is active; idle Main Folder stays at root scope (empty
    // until you search). Active uploads (status Uploading / no boss yet) are kept.
    return filterLogs(sessionDisplayPool(activeSession));
  }

  function retryOnHoldLogs() {
    // Sweep On Hold logs from BOTH the live feed and full history (deduped by path),
    // then drain them through the serial dps queue so the x/total counter is visible.
    const paths = new Set<string>();
    for (const u of uploads) if (u.status === "On Hold") paths.add(u.file_path);
    for (const h of allHistory) if (h.status === "On Hold") paths.add(h.file_path);
    for (const fp of paths) enqueueDpsRetry(fp);
  }

  async function deleteHistoryLog(filePath: string) {
    deletingLogPaths.add(filePath);
    deletingLogPaths = new Set(deletingLogPaths);
    // HISTORY-ONLY delete: fade the card out first, then drop it from the History
    // store. Must NOT touch the Uploads Feed or Folders (independent stores).
    setTimeout(async () => {
      allHistory = allHistory.filter(u => u.file_path !== filePath);
      try {
        await invoke("delete_history_log", { filePath });
      } catch (err) {
        console.error("Failed to delete log from history:", err);
      }
      const nextSelected = new Set(selectedLogs);
      nextSelected.delete(filePath);
      selectedLogs = nextSelected;
      deletingLogPaths.delete(filePath);
      deletingLogPaths = new Set(deletingLogPaths);
    }, 280);
  }

  // Caps the in-RAM working set so a huge history can't blow up memory or make
  // every filter change an O(n) sweep over tens of thousands of records. For
  // normal history sizes (hundreds–low thousands) this is invisible — we still
  // load everything. Only when history exceeds the cap do we keep the most
  // recent HISTORY_CAP records and surface a "+" indicator. Filtering/paging
  // stay client-side (FilterBar needs the full filtered set + distinct bosses).
  const HISTORY_CAP = 5000;
  let historyHasMore = $state(false);
  // Loads history into memory (bounded by HISTORY_CAP). Filtering + pagination
  // stay client-side via `filteredHistory` / `pagedHistory`.
  async function loadFullHistory() {
    isHistoryLoading = true;
    try {
      const count = await invoke("get_history_count") as number;
      if (count === 0) { allHistory = []; historyHasMore = false; return; }
      const limit = Math.min(count, HISTORY_CAP);
      historyHasMore = count > limit;
      allHistory = await invoke("get_history_page", { page: 0, limit }) as UploadRecord[];
    } catch (err) {
      console.error("Failed to load full history:", err);
    } finally {
      isHistoryLoading = false;
    }
  }

  // ── Uploads Feed persistence (Option B) ────────────────────────────────
  // The Feed is in-memory; we persist ONLY the ordered file_path list to
  // feed.json and resolve it against history.json on launch — so a restart
  // restores "the logs I had open" faithfully without duplicating record data.
  let feedSaveTimer: ReturnType<typeof setTimeout> | null = null;
  function persistFeed() {
    // Debounced: the listener fires rapidly during live uploads.
    if (feedSaveTimer) clearTimeout(feedSaveTimer);
    feedSaveTimer = setTimeout(() => {
      const paths = uploads.map((u) => u.file_path).filter(Boolean);
      invoke("save_feed", { paths }).catch((err) =>
        console.error("Failed to persist feed:", err)
      );
    }, 600);
  }

  function logLivesInFolder(filePath: string): boolean {
    return sessions.some((s) =>
      s.logs.some((l) => l.file_path === filePath) ||
      (s.subfolders ?? []).some((sf: any) => sf.logs.some((l: any) => l.file_path === filePath))
    );
  }

  // Rebuild the Feed from the persisted path order, resolved against history.
  async function reseedFeed() {
    let saved: string[] = [];
    try {
      saved = (await invoke("get_feed")) as string[];
    } catch (err) {
      console.error("Failed to load feed order:", err);
      return;
    }
    if (saved.length === 0) return;
    const byPath = new Map(allHistory.map((h) => [h.file_path, h]));
    const reseeded: UploadRecord[] = [];
    for (const p of saved) {
      // Drop paths the user deleted, that now live in a Folder, or that no
      // longer exist in history (e.g. cleared History).
      if (!p || deletedPaths.has(p) || logLivesInFolder(p)) continue;
      const rec = byPath.get(p);
      if (rec) reseeded.push(rec);
    }
    // Cap to MAX_FEED_LOGS to match the live-feed bound.
    uploads = reseeded.slice(0, MAX_FEED_LOGS);
  }

  let groupedFeed = $derived.by(() => {
    const items: FeedItem[] = [];
    const uploadingLogs = filteredUploads.filter(l => l.status === "Uploading" || !l.boss_name);
    const resolvedLogs = filteredUploads.filter(l => l.status !== "Uploading" && l.boss_name);
    if (uploadingLogs.length > 0) {
      items.push({ kind: "group", bossName: "Active Uploads", bossBuckets: [{ bossKey: "active", bossName: "Active Uploads", logs: uploadingLogs }], logs: uploadingLogs });
    }
    const wingBuckets = new Map<number, Map<string, { bossName: string; logs: UploadRecord[] }>>();
    for (const log of resolvedLogs) {
      if (getEncounterType(log.boss_name, log.num_players, log.is_convergence) !== "raid") continue;
      const c = clean(log.boss_name);
      const wi = BOSS_TO_WING[c] ?? 999;
      if (!wingBuckets.has(wi)) wingBuckets.set(wi, new Map());
      const bm = wingBuckets.get(wi)!;
      if (!bm.has(c)) bm.set(c, { bossName: log.boss_name ?? c, logs: [] });
      bm.get(c)!.logs.push(log);
    }
    const sortedWings = [...wingBuckets.keys()].sort((a, b) => a - b);
    for (const wi of sortedWings) {
      const bm = wingBuckets.get(wi)!;
      const wingName = wi < WINGS.length ? WINGS[wi].name : `Wing ${wi + 1}`;
      const orderedBossKeys = wi < WINGS.length
        ? WINGS[wi].bosses.filter(b => bm.has(b))
        : [...bm.keys()];
      for (const k of bm.keys()) {
        if (!orderedBossKeys.includes(k)) orderedBossKeys.push(k);
      }
      const bossBuckets = orderedBossKeys.map(bk => ({ bossKey: bk, bossName: bm.get(bk)!.bossName, logs: bm.get(bk)!.logs }));
      items.push({ kind: "wing", wingIdx: wi, wingName, bossBuckets });
    }
    const catBuckets = new Map<string, Map<string, { bossName: string; logs: UploadRecord[] }>>();
    for (const log of resolvedLogs) {
      if (getEncounterType(log.boss_name, log.num_players, log.is_convergence) === "raid") continue;
      const c = clean(log.boss_name);
      const frac = getFractalName(log.boss_name, log.num_players);
      // STRIKE_REGISTRY is authoritative for grouping (see feed-site note above).
      const storyInst = getStoryInstance(log.boss_name, log);
      let catName = storyInst ? "Personal Story" : (STRIKE_REGISTRY[c]?.expansion ?? (frac ? frac : (BOSS_CATEGORIES[c] ?? (log.is_wvw ? "World vs World" : "Other Strikes"))));
      if (getEncounterType(log.boss_name, log.num_players, log.is_convergence) === "convergence") {
        if (["greer", "greerthebightbringer", "greertheblightbringer", "decima", "decimathestormsinger", "ura", "urathesteamshrieker"].includes(c)) {
          catName = "Convergence: Mount Balrior";
        } else {
          catName = "Convergence: Outer Nayos";
        }
      }
      if (!catBuckets.has(catName)) catBuckets.set(catName, new Map());
      const bm = catBuckets.get(catName)!;
      const strikeKey = storyInst ?? (STRIKE_REGISTRY[c]?.strike ?? getBossDisplayName(log.boss_name));
      // Sub-header = canonical strike name (e.g. "Aetherblade Hideout"), never the
      // fractal/boss alias (e.g. "Mai Trin Boss") that dps.report sometimes sends.
      const headerName = storyInst || frac || (STRIKE_REGISTRY[c]?.strike ?? getBossDisplayName(log.boss_name));
      if (!bm.has(strikeKey)) bm.set(strikeKey, { bossName: headerName, logs: [] });
      bm.get(strikeKey)!.logs.push(log);
    }
    for (const [catName, bm] of catBuckets) {
      const bossBuckets = [...bm.entries()].map(([bk, v]): { bossKey: string; bossName: string; logs: UploadRecord[] } => ({ bossKey: bk, bossName: v.bossName, logs: v.logs }));
      items.push({ kind: "group", bossName: catName, bossBuckets, logs: bossBuckets.flatMap((b) => b.logs) });
    }
    return items;
  });

  // ─── Formatter State ─────────────────────────────────────────────────
  let editableFormattedText = $state("");
  let formatterIncludeResults = $state(true);
  let formatterIncludeConvTime = $state(true);
  let formatterIncludeBossTime = $state(false);
  let formatterIncludeDates = $state(false);
  let formatterIncludeSpecs = $state(false);
  let formatterIncludeBestPull = $state(false);
  let customFormatterHeader = $state("");

  // Formatter preview: uses manual edit text when available, otherwise auto-syncs
  // with computed formattedText
  let manualEdit = $state<string | null>(null);
  let formatterKey = $state(0);

  // Sync checkboxes: bump formatterKey to force re-render
  // Note: we do NOT reset manualEdit here — manual edits persist across option toggles
  // User can click "Reset Edits" to re-sync with computed text

  // Discord caps plain-text messages at 2000 chars; pasting more makes Discord
  // Desktop offer to send the overflow as an uploaded .txt file instead of inline.
  const DISCORD_CHAR_LIMIT = 2000;
  let liveFormattedText = $derived.by(() => manualEdit ?? formattedText);
  let formatterDirty = $derived(manualEdit !== null);
  let formatterCharCount = $derived(liveFormattedText.length);
  let formatterOverLimit = $derived(formatterCharCount > DISCORD_CHAR_LIMIT);

  // True only when at least one selected log is a Convergence encounter,
  // so the "Total Convergence Time" toggle only appears when relevant.
  let hasConvergenceSelected = $derived.by(() => {
    const known = new Map<string, UploadRecord>();
    for (const l of uploads) known.set(l.file_path, l);
    for (const l of historyLogs) known.set(l.file_path, l);
    for (const s of sessions) {
      for (const l of s.logs ?? []) known.set(l.file_path, l);
      for (const sf of s.subfolders ?? []) for (const l of sf.logs ?? []) known.set(l.file_path, l);
    }
    for (const path of selectedLogs) {
      const l = known.get(path);
      if (l && l.is_convergence === true) return true;
    }
    return false;
  });

  // ─── Modal/Troubleshoot State ─────────────────────────────────────────
  let showTroubleshoot = $state<Record<string, boolean>>({});
  let modalWingCollapsed = $state<Record<number, boolean>>({});
  let modalCategoryCollapsed = $state<Record<string, boolean>>({});
  let copiedDiagPath = $state<string | null>(null);
  let savedDiagPath = $state<string | null>(null);

  function toggleModalWingCollapsed(wi: number) {
    modalWingCollapsed[wi] = !modalWingCollapsed[wi];
    modalWingCollapsed = { ...modalWingCollapsed };
  }

  function toggleModalCategoryCollapsed(cat: string) {
    modalCategoryCollapsed[cat] = !modalCategoryCollapsed[cat];
    modalCategoryCollapsed = { ...modalCategoryCollapsed };
  }

  // In-flight manual retries (Failed or Duplicate re-queue). Guards against a
  // double-click re-queuing the same file twice before its status flips.
  let retryingPaths = $state<Set<string>>(new Set());
  async function retryLog(filePath: string) {
    if (retryingPaths.has(filePath)) return;
    retryingPaths.add(filePath);
    retryingPaths = new Set(retryingPaths);
    try {
      await invoke("trigger_manual_upload", { filePath });
    } catch (err) {
      console.error("Failed to retry log:", err);
    } finally {
      retryingPaths.delete(filePath);
      retryingPaths = new Set(retryingPaths);
    }
  }

  async function deleteLogRecord(filePath: string) {
    // FEED-ONLY delete. Fade the card out first, then drop it from the feed store
    // and suppress the watcher re-queue of the re-touched .zevtc (deleted_paths.json).
    // Must NOT touch History or Folders — those are independent stores.
    deletingLogPaths.add(filePath);
    deletingLogPaths = new Set(deletingLogPaths);
    try {
      await invoke("mark_log_deleted", { filePath });
    } catch (err) {
      console.error("[deleteLogRecord] Failed to mark log as deleted from feed:", err);
    }
    // Invalidate cached dps.report JSON for this permalink so a later re-upload
    // fetches fresh phase/HP data instead of reusing stale cleared flags.
    try {
      const rec = uploads.find(u => u.file_path === filePath);
      if (rec?.url) {
        await invoke("invalidate_log_cache", { permalink: rec.url });
      }
    } catch (err) {
      console.error("[deleteLogRecord] Failed to invalidate log cache:", err);
    }
    setTimeout(() => {
      uploads = uploads.filter(u => u.file_path !== filePath);
      deletedPaths.add(filePath);
      deletedPaths = new Set(deletedPaths);
      persistFeed();
      deletingLogPaths.delete(filePath);
      deletingLogPaths = new Set(deletingLogPaths);
    }, 280);
  }

  async function copyDiagnostics(log: any) {
    const diag = log.diagnostics ?? log.error_msg ?? "No diagnostics available";
    await navigator.clipboard.writeText(diag);
    copiedDiagPath = log.file_path;
    setTimeout(() => { copiedDiagPath = null; }, 2000);
  }

  async function saveDiagnosticsToFile(log: any) {
    try {
      const diag = log.diagnostics ?? log.error_msg ?? "No diagnostics available";
      await invoke("save_diagnostics", { content: diag, fileName: log.file_name + ".diag.txt" });
      savedDiagPath = log.file_path;
      setTimeout(() => { savedDiagPath = null; }, 3000);
    } catch (err) {
      console.error("Failed to save diagnostics:", err);
    }
  }

  // Surface the offending log in the OS file manager so the user can inspect/delete it.
  // Reuses the existing open_in_explorer Tauri command (also used by the Save Logs flow).
  let openExplorerErr: string | null = null;
  async function openLogInExplorer(log: any) {
    openExplorerErr = null;
    try {
      await invoke("open_in_explorer", { path: log.file_path });
    } catch (e) {
      const msg = (e as unknown as { message?: string })?.message ?? String(e);
      openExplorerErr = msg;
      showToast(`Couldn't open file location: ${msg}`, "default");
    }
  }

  function copySingleLink(url: string, filePath?: string) {
    navigator.clipboard.writeText(url).then(() => {
      copiedLogPath = filePath || url;
      showToast("Link copied!", "success");
      setTimeout(() => { copiedLogPath = null; }, 2000);
    });
  }

  function copyFormatterTextToClipboard() {
    const text = liveFormattedText;
    navigator.clipboard.writeText(text).then(() => {
      formatterCopyFeedback = true;
      setTimeout(() => { formatterCopyFeedback = false; }, 1000);
    });
  }

  function resetFormatterText() {
    manualEdit = null;
  }

  function handleDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".split-btn-container")) {
      showUploadTargetDropdown = false;
    }
    if (!target.closest(".subfolder-tab")) {
      subFolderMenuId = null;
    }
    if (target && !target.closest(".ctx-menu")) {
      closeContextMenu();
    }
    if (target && !target.closest(".card-menu-container")) {
      activeMenuCard = null;
    }
  }

  function handleOnline() {
    isOnline = true;
    retryOnHoldLogs();
    processDpsQueue();
    showToast("Back online — uploads resumed", "online");
  }

  function dismissEiNotice() {
    eiRuntimeNotice = null;
    localStorage.setItem("ei_runtime_notice_dismissed", "1");
  }

  onMount(() => {
    const statusInterval = setInterval(() => {
      checkDpsReportStatus();
      checkBackupDpsStatus();
      checkWingmanStatus();
    }, 20000);
    // Hourly update-poll handle (declared here so the onMount cleanup can clear it).
    let updatePollInterval: number | null = null;

    const preventDragDefault = (e: DragEvent) => { e.preventDefault(); };
    window.addEventListener("dragover", preventDragDefault, false);
    window.addEventListener("drop", preventDragDefault, false);

    isOnline = navigator.onLine;
    const handleOffline = () => {
      isOnline = false;
      showToast("You're offline — uploads paused until connection returns", "offline");
    };
    window.addEventListener("online", handleOnline, false);
    window.addEventListener("offline", handleOffline, false);
    window.addEventListener("click", handleDocumentClick, false);

    let unlistenUpload: (() => void) | null = null;
    let unlistenDrag: (() => void) | null = null;
    // unlistenRepair removed - repair badge feature deprecated
    let unlistenQueue: (() => void) | null = null;

    // Live progress for the launch-time CM/LCM Mode-flag self-heal. Shows a banner
    // above the History feed while dps.report is re-checked, then auto-hides.

    void (async () => {
      await loadConfig();
      // the installed version (not a hard-coded string). This makes the modal

      try {
        currentAppVersion = await getVersion();
      } catch {
        currentAppVersion = "";
      }
      // Open the manual Version History viewer on the current release.
      if (currentAppVersion) selectedPatchNotesVersion = currentAppVersion;
      // Show only when: a real version is known, the user hasn't dismissed THIS
      // version yet, AND we actually have notes for it (prevents an empty modal
      // on versions that don't ship notes yet).
      if (
        currentAppVersion &&
        localStorage.getItem("last_seen_patch_notes") !== currentAppVersion &&
        PATCH_NOTES_DATA.some(p => p.version === currentAppVersion)
      ) {
        showPatchNotesModal = true;
      }
      // One-time notice: if the bundled Elite Insights can't run (missing .NET 8
      // Desktop Runtime), uploads still work but fall back to dps.report. Only
      // show when not already dismissed this app version.
      if (localStorage.getItem("ei_runtime_notice_dismissed") !== "1") {
        invoke<{ available: boolean; download_url: string }>("check_ei_runtime")
          .then((s) => { if (!s.available) eiRuntimeNotice = { url: s.download_url }; })
          .catch(() => {});
      }
      checkDpsReportStatus();
      checkBackupDpsStatus();
      checkWingmanStatus();
      checkForUpdate(true); // silent: only toasts if an update is found

      // Hourly poll so a freshly-shipped GitHub update surfaces a toast without the
      // user relaunching. De-duped inside checkForUpdate via lastNotifiedVersion;
      // skipped while the install modal is open so we don't nag mid-update.
      updatePollInterval = setInterval(() => {
        if (!updateModalOpen && !updateChecking) checkForUpdate(true);
      }, 60 * 60 * 1000);

      await loadFullHistory();
      // Restore the persisted Feed ordering from feed.json (resolved against history).
      await reseedFeed();
      loadCaptureSession();

      unlistenUpload = await listen<UploadRecord>("upload-status", (event) => {
        const r = event.payload;
        // Ignore re-emissions of paths the user deleted from the feed.
        if (deletedPaths.has(r.file_path)) return;

        // ── Store isolation (Feed / History / Folders operate independently) ──
        // A record only belongs in the Uploads Feed if it is NOT already housed in
        // a Session / Folder / Subfolder. If it lives in a folder, any re-emission
        // (VL rank change, Wingman retry, self-heal) must patch it in place *there*
        // and never re-surface it into the feed — otherwise it becomes a phantom
        // that can't be removed. (The Rust side no longer emits upload-status for
        // rank changes, but this guard makes the listener correct regardless.)
        const livesInFolder = sessions.some((s) =>
          s.logs.some((l) => l.file_path === r.file_path) ||
          (s.subfolders ?? []).some((sf: any) => sf.logs.some((l: any) => l.file_path === r.file_path))
        );
        if (livesInFolder) {
          // Refresh the record wherever it currently lives (badge, status, url).
          const apply = (log: any) => { if (log && log.file_path === r.file_path) Object.assign(log, r); };
          sessions = sessions.map((s) => {
            const logs = s.logs.map((l) => { const c = { ...l }; apply(c); return c; });
            const subfolders = (s.subfolders ?? []).map((sf: any) => ({
              ...sf,
              logs: sf.logs.map((l: any) => { const c = { ...l }; apply(c); return c; }),
            }));
            return { ...s, logs, subfolders };
          });
          // Patch in place (indexed) instead of cloning the whole history array —
          // avoids O(n) churn on every foldered re-emission.
          const hIdx = allHistory.findIndex((h) => h.file_path === r.file_path);
          if (hIdx !== -1) {
            const c = { ...allHistory[hIdx] };
            apply(c);
            allHistory[hIdx] = c;
            allHistory = [...allHistory];
          }
          return;
        }

        // ── Keep the History in sync with live uploads ──
        // Patching allHistory keeps the API Tracker tab in sync in real time.
        const hIdx = allHistory.findIndex((h) => h.file_path === r.file_path);
        if (hIdx !== -1) {
          allHistory[hIdx] = r;
          allHistory = [...allHistory];
        } else if (
          // Patch live into History for any terminal/settled state. `Processing`
          // (a log parked while dps.report's Elite Insights runs) MUST be included
          // too — otherwise it never appears until the app is restarted and
          // re-reads history.json from disk.
          r.status === "Completed" || r.status === "Failed" ||
          r.status === "Duplicate" || r.status === "Processing"
        ) {
          allHistory = [r, ...allHistory];
        }

        const idx = uploads.findIndex((u) => u.file_path === r.file_path);
        let wasCompleted = false;
        if (idx !== -1) {
          wasCompleted = uploads[idx].status === "Completed";
          uploads[idx] = r;
          uploads = [...uploads];
        } else {
          uploads = [r, ...uploads];
          // Capture Session: tag this NEW Feed log while actively collecting.
          if (captureSession && captureSession.state === "collecting") {
            const set = new Set(captureSession.logPaths);
            set.add(r.file_path);
            captureSession = { ...captureSession, logPaths: [...set] };
            persistCaptureSession();
          }
          if (uploads.length > MAX_FEED_LOGS) {
            // Keep any still-active uploads, then the most recent, up to the cap.
            const active = uploads.filter((u) => u.status === "Uploading" || !u.boss_name);
            const done = uploads.filter((u) => u.status !== "Uploading" && u.boss_name);
            uploads = [...active, ...done.slice(0, MAX_FEED_LOGS - active.length)];
          }
        }
        // Persist the (new) Feed ordering to feed.json.
        persistFeed();
        // Duplicate uploads are now resolved server-side by Rust: the backend
        // captures the existing dps.report permalink and schedules a one-shot
        // deferred EI check that flips the record to Completed (emitting
        // upload-status again). No frontend countdown is needed.
        if (r.status === "Completed") {
          const target = pendingManualTargets[r.file_path];
          if (target) {
            addLogToSession(r.file_path, target.sessionId);
            if (target.subFolderId) {
              moveLogToSubFolder(target.sessionId, r.file_path, target.subFolderId);
            }
            delete pendingManualTargets[r.file_path];
          }
        }
        if (r.status === "Completed" && !wasCompleted) {
          playSuccessSound();
          showDesktopNotification(r);
        }
      });

      const appWindow = getCurrentWindow();
      unlistenDrag = await appWindow.onDragDropEvent((event) => {
        const payload = event.payload as any;
        if (payload.type === "enter" || payload.type === "over") {
          isDragging = true;
        } else if (payload.type === "leave") {
          isDragging = false;
        } else if (payload.type === "drop") {
          isDragging = false;
          const paths: string[] = payload.paths ?? [];
          let rejected = 0;
          for (const p of paths) {
            const lower = p.toLowerCase();
            if (lower.endsWith(".evtc") || lower.endsWith(".zevtc")) {
              queueFile(p);
            } else {
              rejected++;
            }
          }
          if (rejected > 0) {
            showToast(`Only .evtc / .zevtc files are accepted (${rejected} rejected).`);
          }
          // Drag-in cascade: animate the queue bar as logs land.
          if (paths.length > rejected) pulseQueue();
        }
      });

      // Live upload-queue snapshot from Rust (queued + active logs).
      unlistenQueue = await listen<{ paused: boolean; items: QueueEntry[] }>("queue-status", (event) => {
        uploadQueue = event.payload.items ?? [];
        uploadPaused = event.payload.paused ?? false;
      });

      // Seed the queue from Rust on mount (covers logs already queued before the UI opened).
      try {
        const q = await invoke<{ paused: boolean; items: QueueEntry[] }>("get_upload_queue");
        uploadQueue = q.items ?? [];
        uploadPaused = q.paused ?? false;
      } catch (e) { /* command may not exist on older builds */ }

      })();

      return () => {
        window.removeEventListener("dragover", preventDragDefault);
        window.removeEventListener("drop", preventDragDefault);
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
        window.removeEventListener("click", handleDocumentClick);
        unlistenUpload?.();
        unlistenDrag?.();
        unlistenQueue?.();

        if (updatePollInterval !== null) clearInterval(updatePollInterval);
        if (statusInterval) clearInterval(statusInterval);
        if (toastTimer) clearTimeout(toastTimer);
        if (feedSaveTimer) clearTimeout(feedSaveTimer);
        if (configSaveTimer) clearTimeout(configSaveTimer);
      };
    });

  async function triggerFolderUpload() {
    try {
      const paths = await invoke<string[]>("pick_log_files");
      for (const path of paths) {
        await queueFile(path);
      }
    } catch (err) {
      console.error("Failed to pick log files:", err);
    }
  }

  async function openPathInExplorer(path: string) {
    if (!path) return;
    try {
      await invoke("open_in_explorer", { path });
    } catch (err) {
      console.error("Failed to open path in explorer:", err);
    }
  }

  // ─── Actions ────────────────────────────────────────────────────────
  async function queueFile(path: string) {
    // A deliberate re-upload must surface even if this path was previously deleted
    // (the client deletedPaths set hides deleted cards, so clear it here).
    deletedPaths.delete(path);
    deletedPaths = new Set(deletedPaths);
    try {
      await invoke("trigger_manual_upload", { filePath: path });
    } catch (err) {
      console.error("Failed to queue file:", err);
    }
  }

  // A single shared AudioContext for the app lifetime. Creating a new one per
  // upload leaks contexts (browsers cap them ~6) and eventually silences the chime.
  let audioCtx: AudioContext | null = null;

  function playSuccessSound() {
    if (!sound_notifications) return;
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      if (!audioCtx || audioCtx.state === "closed") audioCtx = new AC();
      const ctx = audioCtx;
      if (ctx.state === "suspended") void ctx.resume();
      
      const playNote = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = "sine"; 
        osc.frequency.setValueAtTime(freq, start);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.3, start + duration);
        
        gain.gain.setValueAtTime(0.12, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(start);
        osc.stop(start + duration);
      };
      
      const now = ctx.currentTime;
      playNote(523.25, now, 0.15); // C5
      playNote(659.25, now + 0.08, 0.20); // E5
      playNote(783.99, now + 0.15, 0.28); // G5
    } catch (e) {
      console.error("Failed to play sound:", e);
    }
  }

  async function showDesktopNotification(log: UploadRecord) {
    if (!desktop_notifications) return;
    try {
      // Native Windows toast via tauri-plugin-notification (the web Notification API
      // is a no-op in Tauri's WebView2). Request permission on first use, then send.
      let granted = await isPermissionGranted();
      if (!granted) {
        const perm = await requestPermission();
        granted = perm === "granted";
      }
      if (!granted) return;
      const message = `${getBossDisplayName(log.boss_name)}: ${log.success ? "Success" : "Failed"} (${formatDuration(log.duration_seconds ?? log.duration ?? 0)})`;
      sendNotification({ title: "Log Upload Status", body: message });
    } catch (err) {
      console.error("Desktop notification error:", err);
    }
  }

  // Literal hex for a folder color — used by swatches + previews so the color shows
  // without depending on (currently undefined) --<name> CSS variables. Passes custom
  // hex values through unchanged; falls back to a legacy preset-name map.
  function swatchHex(c: string): string {
    if (!c) return "#6366f1";
    if (c.startsWith("#")) return c; // custom color stored as hex
    const m: Record<string, string> = {
      teal: "#14b8a6", indigo: "#6366f1", purple: "#8b5cf6", fuchsia: "#ec4899",
      red: "#ef4444", orange: "#f59e0b", emerald: "#10b981"
    };
    return m[c] ?? "#6366f1";
  }

  // Smart Log Formatter states
  let showFormatterPanel = $state(false);
  // When the last selected log is unchecked, drop the formatter panel too —
  // otherwise the "Log Formatter" banner lingers with nothing to format.
  $effect(() => {
    if (selectedLogs.size === 0) showFormatterPanel = false;
  });
  // Computed preview text compiled in real-time
  let formattedText = $derived.by(() => {
    const allKnownLogsMap = new Map();
    for (const log of uploads) {
      allKnownLogsMap.set(log.file_path, log);
    }
    for (const log of allHistory) {
      allKnownLogsMap.set(log.file_path, log);
    }
    for (const s of sessions) {
      for (const log of s.logs ?? []) {
        allKnownLogsMap.set(log.file_path, log);
      }
      for (const sf of s.subfolders ?? []) {
        for (const log of sf.logs ?? []) {
          allKnownLogsMap.set(log.file_path, log);
        }
      }
    }
    for (const log of filteredUploads) {
      allKnownLogsMap.set(log.file_path, log);
    }

    const selected: UploadRecord[] = [];
    for (const path of selectedLogs) {
      const found = allKnownLogsMap.get(path);
      if (found) {
        selected.push(found);
      }
    }
    if (selected.length === 0) return "No logs selected. Check some logs in the feed to begin!";

    const lines: string[] = [];
    if (customFormatterHeader.trim()) {
      lines.push(customFormatterHeader.trim());
      lines.push("");
    }

    let lastExpansion = "";

    // Group raid logs by wing, preserve wing + boss order
    const raidSelected = selected.filter(l => getEncounterType(l.boss_name, l.num_players, l.is_convergence) === "raid");
    const nonRaidSelected = selected.filter(l => getEncounterType(l.boss_name, l.num_players, l.is_convergence) !== "raid");

    // (Dragonvoid logs are intercepted below into the wipe-tally block)
    const dragonvoidSelected = nonRaidSelected.filter((l) => dragonvoidWipePoint(l) !== null);
    const otherNonRaidSelected = nonRaidSelected.filter((l) => dragonvoidWipePoint(l) === null);

    const wingMap = new Map<number, Map<string, UploadRecord[]>>();
    for (const log of raidSelected) {
      const c = clean(log.boss_name);
      const wingIdx = BOSS_TO_WING[c] ?? -1;
      if (!wingMap.has(wingIdx)) wingMap.set(wingIdx, new Map());
      const bm = wingMap.get(wingIdx)!;
      if (!bm.has(c)) bm.set(c, []);
      bm.get(c)!.push(log);
    }

    for (let wi = 0; wi < WINGS.length; wi++) {
      if (!wingMap.has(wi)) continue;
      const bossMap = wingMap.get(wi)!;
      
      const expName = getExpansionNameForWing(wi);
      if (expName && expName !== lastExpansion) {
        if (lines.length > 0) lines.push("");
        lines.push(`# **${expName}**`);
        lines.push("");
        lastExpansion = expName;
      }
      
      const formattedWing = WINGS[wi].name.replace("·", "-");
      lines.push(`**Raid ${formattedWing}**`);
      lines.push("");

      for (const bossKey of WINGS[wi].bosses) {
        if (!bossMap.has(bossKey)) continue;
        const bosslogs = [...bossMap.get(bossKey)!].sort((a, b) => {
          const aSuccess = a.success === true;
          const bSuccess = b.success === true;
          if (aSuccess && !bSuccess) return 1;
          if (!aSuccess && bSuccess) return -1;
          return 0;
        });
        
        let bossHeader = `__**${getDiscordBossName(bosslogs[0].boss_name, bosslogs[0].num_players)}**__`;
        
        // Add Specs list or count if selected
        if (formatterIncludeSpecs && bosslogs[0].players) {
          const specCount: { [key: string]: number } = {};
          for (const p of bosslogs[0].players) {
            const specName = getEliteSpecName(p.elite_spec, p.profession);
            specCount[specName] = (specCount[specName] || 0) + 1;
          }
          const specStr = Object.entries(specCount)
            .map(([sName, count]) => `${count}x ${sName}`)
            .join(", ");
          if (specStr) bossHeader += ` (${specStr})`;
        }
        
        lines.push(bossHeader);
        // Determine the best-pull (lowest HP left) log up front so it can be moved
        // to the end instead of duplicated when the toggle is on.
        let best: { hp: number; url: string } | null = null;
        if (formatterIncludeBestPull) {
          // For Ura logs with AHR (health regeneration), prefer AHR logs for Best Pull
          const isUra = bosslogs.some(l => {
            const n = (l.boss_name ?? "").toLowerCase();
            return n.includes("ura") && (n.includes("steamshrieker") || n === "ura" || n.includes("godscream"));
          });
          const ahrLogs = isUra ? bosslogs.filter(l => l.ura_health_regen === "AHR") : [];
          const candidates = ahrLogs.length > 0 ? ahrLogs : bosslogs;
          for (const l of candidates) {
            if (l.url && typeof l.boss_hp_left === "number" && (best === null || l.boss_hp_left < best.hp)) {
              best = { hp: l.boss_hp_left, url: l.url };
            }
          }
        }
        for (const l of bosslogs) {
          // Skip the best-pull log here; it's surfaced once at the end.
          if (best && l.url === best.url) continue;
          if (l.url) {
            const vl = vlRankLabel(l.boss_name, l.vl_rank);
            let logLine = `> `;
            if (vl) logLine += `**${vl}** — `;
            if (l.success === true) {
              logLine += `**Kill Log** → ${l.url}`;
            } else {
              logLine += `${l.url}`;
            }
            
            const metaParts: string[] = [];
            if (formatterIncludeResults) {
              if (l.success === true) {
                metaParts.push("Victory");
              } else if (l.boss_hp_left !== undefined && l.boss_hp_left !== null && shouldShowHpLeft(l)) {
                metaParts.push(`Failed - ${l.boss_hp_left.toFixed(2)}% left${l.ura_health_regen === "AHR" ? " AHR" : ""}`);
              } else {
                metaParts.push("Failed");
              }
            }
            if (formatterIncludeBossTime && l.duration) {
              // Non-convergence logs: duration is the boss/encounter time.
              // Convergences: only show boss time when boss_duration was actually fetched
              // (from EI). If unavailable, omit it rather than falling back to the total
              // convergence time, which would duplicate "Total Convergence Time".
              if (l.is_convergence) {
                if (l.boss_duration != null) metaParts.push(formatDuration(l.boss_duration));
              } else {
                metaParts.push(formatDuration(l.duration));
              }
            }
            if (formatterIncludeDates && l.timestamp) {
              metaParts.push(l.timestamp.split(" ")[0]);
            }
            
            if (metaParts.length > 0) {
              logLine += ` *(${metaParts.join(" | ")})*`;
            }
            lines.push(logLine);
          }
        }
        if (best) {
          const bestLog = bosslogs.find((l) => l.url === best!.url);
          const vl = vlRankLabel(bestLog?.boss_name, bestLog?.vl_rank);
          let bestLine = `> **Best Pull →** `;
          if (vl) bestLine += `**${vl}** — `;
          bestLine += best.url;
          const metaParts: string[] = [];
          if (formatterIncludeResults) {
            if (bestLog?.success === true) {
              metaParts.push("Victory");
            } else if (bestLog?.boss_hp_left !== undefined && bestLog?.boss_hp_left !== null) {
              metaParts.push(`Failed - ${bestLog.boss_hp_left.toFixed(2)}% left${bestLog.ura_health_regen === "AHR" ? " AHR" : ""}`);
            } else {
              metaParts.push("Failed");
            }
          }
          if (formatterIncludeBossTime && bestLog?.duration) {
            if (bestLog.is_convergence) {
              if (bestLog.boss_duration != null) metaParts.push(formatDuration(bestLog.boss_duration));
            } else {
              metaParts.push(formatDuration(bestLog.duration));
            }
          }
          if (formatterIncludeDates && bestLog?.timestamp) {
            metaParts.push(bestLog.timestamp.split(" ")[0]);
          }
          if (metaParts.length > 0) {
            bestLine += ` *(${metaParts.join(" | ")})*`;
          }
          lines.push(bestLine);
        }
      }
      const wingAllLogs = [...bossMap.values()].flat();
      const wingConvTotal = wingAllLogs.filter(l => l.is_convergence).reduce((s, l) => s + (l.duration ?? 0), 0);
      if (formatterIncludeConvTime && wingConvTotal > 0) {
        lines.push(`> **Total Convergence Time:** ${formatDuration(wingConvTotal)}`);
      }
      lines.push("");
    }

    if (otherNonRaidSelected.length > 0) {
      const nonRaidMap = new Map<string, Map<string, Map<string, UploadRecord[]>>>();
      for (const log of otherNonRaidSelected) {
        const { exp, cat } = getNonRaidCategory(log.boss_name ?? "", log.is_convergence, log.is_cm);
        if (!nonRaidMap.has(exp)) nonRaidMap.set(exp, new Map());
        const catMap = nonRaidMap.get(exp)!;
        if (!catMap.has(cat)) catMap.set(cat, new Map());
        const bossMap = catMap.get(cat)!;
        const bKey = log.boss_name ?? "Unknown";
        if (!bossMap.has(bKey)) bossMap.set(bKey, []);
        bossMap.get(bKey)!.push(log);
      }
      
      for (const [exp, catMap] of nonRaidMap) {
        if (exp !== lastExpansion) {
          if (lines.length > 0) lines.push("");
          lines.push(`# **${exp}**`);
          lines.push("");
          lastExpansion = exp;
        }
        for (const [cat, bossMap] of catMap) {
          if (cat !== exp) {
            lines.push(`**${cat}**`);
            lines.push("");
          }
          for (const [bossName, logs] of bossMap) {
            const si = strikeInstanceFor(bossName);
            const bossKey = (bossName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
            const regBoss = si ? (STRIKE_REGISTRY[bossKey]?.boss ?? null) : null;
            let bossHeader = `__**${regBoss ?? getDiscordBossName(bossName, logs[0].num_players)}**__`;
            if (formatterIncludeSpecs && logs[0].players) {
              const specCount: { [key: string]: number } = {};
              for (const p of logs[0].players) {
                const specName = getEliteSpecName(p.elite_spec, p.profession);
                specCount[specName] = (specCount[specName] || 0) + 1;
              }
              const specStr = Object.entries(specCount)
                .map(([sName, count]) => `${count}x ${sName}`)
                .join(", ");
              if (specStr) bossHeader += ` (${specStr})`;
            }
            // Strikes: prepend the instance (strike) name so the header is 3-tier:
            // Expansion (#, emitted by the exp loop) / Instance / Boss.
            if (si) lines.push(`**${si}**`);
            lines.push(bossHeader);
            const sortedLogs = [...logs].sort((a, b) => {
              const aSuccess = a.success === true;
              const bSuccess = b.success === true;
              if (aSuccess && !bSuccess) return 1;
              if (!aSuccess && bSuccess) return -1;
              return 0;
            });
            // Determine the best-pull (lowest HP left) log up front so it can be moved
            // to the end instead of duplicated when the toggle is on.
            let best: { hp: number; url: string } | null = null;
            if (formatterIncludeBestPull) {
              // For Ura logs with AHR (health regeneration), prefer AHR logs for Best Pull
              const isUra = sortedLogs.some(l => {
                const n = (l.boss_name ?? "").toLowerCase();
                return n.includes("ura") && (n.includes("steamshrieker") || n === "ura" || n.includes("godscream"));
              });
              const ahrLogs = isUra ? sortedLogs.filter(l => l.ura_health_regen === "AHR") : [];
              const candidates = ahrLogs.length > 0 ? ahrLogs : sortedLogs;
              for (const l of candidates) {
                if (l.url && typeof l.boss_hp_left === "number" && (best === null || l.boss_hp_left < best.hp)) {
                  best = { hp: l.boss_hp_left, url: l.url };
                }
              }
            }
            for (const l of sortedLogs) {
              // Skip the best-pull log here; it's surfaced once at the end.
              if (best && l.url === best.url) continue;
              if (l.url) {
                const vl = vlRankLabel(l.boss_name, l.vl_rank);
                let logLine = `> `;
                if (vl) logLine += `**${vl}** — `;
                if (l.success === true) {
                  logLine += `**Kill Log** → ${l.url}`;
                } else {
                  logLine += `${l.url}`;
                }
                
                const metaParts: string[] = [];
                if (formatterIncludeResults) {
                  if (l.success === true) {
                    metaParts.push("Victory");
                  } else if (l.boss_hp_left !== undefined && l.boss_hp_left !== null && shouldShowHpLeft(l)) {
                    metaParts.push(`Failed - ${l.boss_hp_left.toFixed(2)}% left${l.ura_health_regen === "AHR" ? " AHR" : ""}`);
                  } else {
                    metaParts.push("Failed");
                  }
                }
                if (formatterIncludeBossTime && l.duration) {
                  // Non-convergence logs: duration is the boss/encounter time.
                  // Convergences: only show boss time when boss_duration was actually fetched
                  // (from EI). If unavailable, omit it rather than falling back to the total
                  // convergence time, which would duplicate "Total Convergence Time".
                  if (l.is_convergence) {
                    if (l.boss_duration != null) metaParts.push(formatDuration(l.boss_duration));
                  } else {
                    metaParts.push(formatDuration(l.duration));
                  }
                }
                if (formatterIncludeDates && l.timestamp) {
                  metaParts.push(l.timestamp.split(" ")[0]);
                }
                
                if (metaParts.length > 0) {
                  logLine += ` *(${metaParts.join(" | ")})*`;
                }
                lines.push(logLine);
              }
            }
            if (best) {
              const bestLog = sortedLogs.find((l) => l.url === best!.url);
              const vl = vlRankLabel(bestLog?.boss_name, bestLog?.vl_rank);
              let bestLine = `> **Best Pull** → `;
              if (vl) bestLine += `**${vl}** — `;
              bestLine += best.url;
              const metaParts: string[] = [];
              if (formatterIncludeResults) {
                if (bestLog?.success === true) {
                  metaParts.push("Victory");
                } else if (bestLog?.boss_hp_left !== undefined && bestLog?.boss_hp_left !== null && shouldShowHpLeft(bestLog)) {
                  metaParts.push(`Failed - ${bestLog.boss_hp_left.toFixed(2)}% left${bestLog.ura_health_regen === "AHR" ? " AHR" : ""}`);
                } else {
                  metaParts.push("Failed");
                }
              }
              if (formatterIncludeBossTime && bestLog?.duration) {
                if (bestLog.is_convergence) {
                  if (bestLog.boss_duration != null) metaParts.push(formatDuration(bestLog.boss_duration));
                } else {
                  metaParts.push(formatDuration(bestLog.duration));
                }
              }
              if (formatterIncludeDates && bestLog?.timestamp) {
                metaParts.push(bestLog.timestamp.split(" ")[0]);
              }
              if (metaParts.length > 0) {
                bestLine += ` *(${metaParts.join(" | ")})*`;
              }
              lines.push(bestLine);
            }
          }
          lines.push("");
          const catAllLogs = [...bossMap.values()].flat();
          const catConvTotal = catAllLogs.filter(l => l.is_convergence).reduce((s, l) => s + (l.duration ?? 0), 0);
          if (formatterIncludeConvTime && catConvTotal > 0) {
            lines.push(`> **Total Convergence Time:** ${formatDuration(catConvTotal)}`);
          }
        }
      }
    }

    // ── Harvest Temple (The Dragonvoid) wipe-tally ──────────────────────
    // Group every selected Dragonvoid attempt by the phase where it ended, then
    // emit `**{phase}** ({count})` followed by one bullet per log URL, ordered
    // by fight progression (kills sort last under Soo-Won ✅).
    if (dragonvoidSelected.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push(`# **End of Dragons Strikes**`);
      lines.push("");
      lines.push("**Harvest Temple**");
      lines.push("__**The Dragonvoid**__");
      lines.push("");

      const byWipe = new Map<string, { label: string; order: number; logs: UploadRecord[] }>();
      for (const log of dragonvoidSelected) {
        const wp = dragonvoidWipePoint(log)!;
        const key = wp.key;
        if (!byWipe.has(key)) byWipe.set(key, { label: wp.name, order: wp.order, logs: [] });
        byWipe.get(key)!.logs.push(log);
      }

      const groups = [...byWipe.values()].sort((a, b) => b.order - a.order);
      for (const g of groups) {
        const count = g.logs.length;
        const label = g.order >= 9999 ? `${g.label} ✅` : g.label;
        lines.push(`**${label}** (${count})`);
        for (const l of g.logs) {
          if (l.url) lines.push(`- ${l.url}`);
        }
        lines.push("");
      }
    }

    return lines.join("\n").trim();
  });



  async function clearAllHistory() {
    openConfirm(
      "Clear Upload History",
      "Are you sure you want to clear your entire upload history? This cannot be undone.",
      async () => {
        try {
          await invoke("clear_history");
          allHistory = [];
          historyPage = 0;
        } catch (err) {
          console.error("Failed to clear history:", err);
        }
      }
    );
  }

  async function checkDpsReportStatus() {
    const prev = dpsReportStatus;
    try {
      const statusStr = (await invoke("check_dps_report_status")) as string;
      dpsReportStatus =
        (statusStr === "online" ||
        statusStr === "offline" ||
        statusStr === "outage_dps" ||
        statusStr.startsWith("degraded_"))
          ? statusStr
          : "unknown";
    } catch {
      dpsReportStatus = "unknown";
    }

    const wasDown = prev === "offline" || prev === "outage_dps" || prev === "unknown";
    const nowUp = dpsReportStatus === "online";
    if (wasDown && nowUp) {
      const jitter = Math.floor(Math.random() * 15000);
      setTimeout(() => {
        invoke("sweep_dps_processing").catch((e) =>
          console.error("dps.report recovery sweep failed:", e)
        );
        retryOnHoldLogs();
        processDpsQueue();
      }, jitter);
    }
  }

  async function checkBackupDpsStatus() {
    try {
      const statusStr = (await invoke("check_backup_dps_status")) as string;
      bDpsReportStatus =
        statusStr === "online" ||
        statusStr === "offline" ||
        statusStr.startsWith("degraded_")
          ? statusStr
          : "unknown";
    } catch {
      bDpsReportStatus = "unknown";
    }
  }

  async function checkWingmanStatus() {
    const prev = wingmanStatus;
    try {
      const statusStr = await invoke("check_wingman_status") as string;
      wingmanStatus = statusStr === "online" ? "online" : "offline";
    } catch {
      wingmanStatus = "offline";
    }
    // Recovery detected: sweep failed logs into the retry queue (jittered).
    // Fire on offline→online AND unknown→online: the latter covers app startup
    // (status begins "unknown"), where pre-existing failed logs would otherwise
    // never auto-retry because there was no live offline→online transition.
    if ((prev === "offline" || prev === "unknown") && wingmanStatus === "online") {
      enqueueAllFailedOnRecovery();
    } else if (wingmanStatus === "online") {
      // Woke already-online: if a queue was paused, resume draining.
      processWingmanQueue();
    }
  }

  function openReplayModal(url: string | undefined) {
    if (!url) return;
    activeReplayUrl = url;
    zoomLevel = 1.0;
    isFullscreen = false;
    isIframeLoading = true;
  }

  function closeReplayModal() {
    activeReplayUrl = null;
  }

  // ─── Squad Planner handlers ────────────────────────────────────────────────
  function savePlan(p: SquadPlan) {
    // If we're inside a folder, write the saved plan into that folder's children
    // (new child) or replace it in place (edit). Otherwise operate on root.
    if (squadFolderStack.length) {
      const folder = squadFolderStack[squadFolderStack.length - 1];
      const children = upsertPlan(folder.children ?? [], p);
      const updatedFolder = { ...folder, children };
      squadPlans = upsertPlan(squadPlans, updatedFolder);
      // keep the breadcrumb reference in sync
      squadFolderStack = squadFolderStack.map((f) => (f.id === folder.id ? updatedFolder : f));
    } else {
      squadPlans = upsertPlan(squadPlans, p);
    }
    editingPlan = null;
    creatingPlan = false;
    persistConfig();
  }
  function deletePlan(id: string) {
    squadPlans = removePlan(squadPlans, id);
    squadFolderStack = squadFolderStack.filter((f) => f.id !== id);
    persistConfig();
  }
  function duplicatePlan(p: SquadPlan) {
    const c = JSON.parse(JSON.stringify(p)) as SquadPlan;
    c.id = crypto.randomUUID();
    c.name = p.name + " (copy)";
    c.createdAt = c.updatedAt = Date.now();
    if (squadFolderStack.length) {
      const folder = squadFolderStack[squadFolderStack.length - 1];
      const children = upsertPlan(folder.children ?? [], c);
      squadPlans = upsertPlan(squadPlans, { ...folder, children });
    } else {
      squadPlans = upsertPlan(squadPlans, c);
    }
    persistConfig();
  }

  async function persistConfig() {
    // Guard: never write back the empty pre-load `[]` state. Before loadConfig()
    // has populated `squadPlans`, an autosave firing here would overwrite real
    // on-disk plans with an empty list and silently wipe them across a restart.
    if (!squadPlansLoaded) return;
    try {
      await invoke("save_config", {
        newConfig: {
          logs_directory,
          dps_report_token,
          discord_webhook,
          discord_webhooks: $state.snapshot(discord_webhooks),
          auto_upload,
          autostart,
          sound_notifications,
          desktop_notifications,
          wingman_enabled,
          wingman_account,
          use_backup_dps,
          max_concurrent_uploads,
          watch_stability_delay_ms,
          max_upload_retries,
          min_log_seconds,
          log_cache_max_files,
          reduce_motion,
          hide_on_startup,
          wvw_enabled,
          sessions,
          accent,
          app_font,
          app_sidebar_open: sidebarOpen,
          gw2_accounts: $state.snapshot(gw2_accounts),
          squad_plans: $state.snapshot(squadPlans),
        }
      });
      sessions = [...sessions];
    } catch (err) {
      console.error("Failed to save config:", err);
    }
  }

  async function openExternalUrl(url: string) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch (err) {
      console.error("Failed to open URL via plugin-opener:", err);
      window.open(url, "_blank");
    }
  }

  // ─── Phase 2B: webhook ping test + audit log ──────────────────────────────
  let webhookLogOpen = $state(false);
  let webhookLogRows = $state<any[]>([]);
  let webhookLogLoading = $state(false);

  function whUrlValid(url: string | null | undefined): boolean {
    return /^https:\/\/discord\.com\/api\/webhooks\/.+/.test((url ?? "").trim());
  }

  // ─── Tier D: structured role pings ──────────────────────────────────────────
  // Transient per-webhook draft for the "add role" row (label + raw id typed).
  let whRoleDraft = $state<Record<string, { label: string; raw: string }>>({});
  // Roles currently in inline-edit mode, keyed by `${wh.id}:${index}`.
  let whRoleEdit = $state<Record<string, { label: string; raw: string }>>({});

  // Normalize a user-typed ping into a Discord token:
  //  - @everyone / @here  -> verbatim
  //  - <@&id> / <@id>     -> verbatim (already correct)
  //  - 123 or "name 123"  -> <@&123>  (numeric id, optional leading name)
  //  - anything else      -> kept as-is (raw text)
  function wrapToken(raw: string): string {
    const t = (raw ?? "").trim();
    if (!t) return "";
    if (t === "@everyone" || t === "@here") return t;
    if (/^<@&?\d+>$/.test(t)) return t;
    const m = t.match(/(\d+)\s*$/);
    if (m) return `<@&${m[1]}>`;
    return t;
  }

  function insertMention(wh: any, token: string) {
    if (!Array.isArray(wh.mention_roles)) wh.mention_roles = [];
    if (!wh.mention_roles.some((r: any) => r.token === token)) {
      wh.mention_roles.push({ label: token, token });
    }
    discord_webhooks = [...discord_webhooks];
  }

  /**
 * Add a role ping from the draft inputs.
 * Closes the form after adding. Validates raw token before saving.
 */
function addRole(wh: any) {
    const draft = whRoleDraft[wh.id] ?? { label: "", raw: "" };
    const token = wrapToken(draft.raw);
    if (!token) return;
    if (!Array.isArray(wh.mention_roles)) wh.mention_roles = [];
    if (!wh.mention_roles.some((r: any) => r.token === token)) {
      wh.mention_roles.push({ label: draft.label.trim() || "Ping", token });
    }
    wh._roleFormOpen = false;
    whRoleDraft = { ...whRoleDraft, [wh.id]: { label: "", raw: "" } };
    discord_webhooks = [...discord_webhooks];
  }

  /** Save inline-edited role ping. Validates raw token before saving. */
function saveRoleEdit(wh: any, idx: number) {
    const key = `${wh.id}:${idx}`;
    const draft = whRoleEdit[key];
    if (!draft) return;
    const token = wrapToken(draft.raw);
    if (!token) return;
    if (Array.isArray(wh.mention_roles) && wh.mention_roles[idx]) {
      wh.mention_roles[idx] = { label: draft.label.trim() || "Ping", token };
    }
    whRoleEdit = { ...whRoleEdit };
    delete whRoleEdit[key];
    whRoleEdit = { ...whRoleEdit };
    discord_webhooks = [...discord_webhooks];
  }

  function duplicateRole(wh: any, idx: number) {
    if (!Array.isArray(wh.mention_roles) || !wh.mention_roles[idx]) return;
    const src = wh.mention_roles[idx];
    wh.mention_roles.splice(idx + 1, 0, { label: src.label, token: src.token });
    discord_webhooks = [...discord_webhooks];
  }

  /** Remove a role ping by index. */
function deleteRole(wh: any, idx: number) {
    if (Array.isArray(wh.mention_roles)) wh.mention_roles.splice(idx, 1);
    discord_webhooks = [...discord_webhooks];
  }

  function duplicateWebhook(wh: any, idx: number) {
    const clone = {
      id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label: ((wh.label ?? "").trim() || "Webhook") + " (copy)",
      url: wh.url ?? "",
      enabled: true,
      mention_roles: Array.isArray(wh.mention_roles) ? wh.mention_roles.map((r: any) => ({ label: r.label, token: r.token })) : [],
      thread_id: null,
      filters: JSON.parse(JSON.stringify(wh.filters ?? { kinds: [], outcomes: [], only_cm: null, only_lcm: null, bosses: [] })),
      _collapsed: false,
    };
    const next = [...discord_webhooks];
    next.splice(idx + 1, 0, clone);
    discord_webhooks = next;
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // WEBHOOK FUNCTIONS — role management, testing, mention handling
  // ════════════════════════════════════════════════════════════════════════════════

/**
 * Test a webhook by sending a sample embed.
 * Builds mention string from mention_roles, appends thread_id to URL.
 * Result shown inline next to the Test button.
 */
async function testWebhook(wh: any) {
    if (!wh.url || !wh.url.trim()) {
      whTest = { ...whTest, [wh.id]: { status: "err", msg: "Webhook URL is empty" } };
      showToast("Webhook URL is empty — enter a URL first.", "default");
      return;
    }
    whTest = { ...whTest, [wh.id]: { status: "testing", msg: "" } };
    try {
      const res = await invoke("test_webhook", {
        webhook: {
          id: wh.id,
          label: wh.label ?? "",
          url: wh.url,
          enabled: wh.enabled ?? true,
          filters: wh.filters ?? { kinds: [], outcomes: [], only_cm: null, only_lcm: null, bosses: [] },
          mention_roles: Array.isArray(wh.mention_roles) ? wh.mention_roles : [],
          thread_id: typeof wh.thread_id === "string" ? wh.thread_id : null,
        },
      });
      whTest = { ...whTest, [wh.id]: { status: "ok", msg: String(res) } };
      showToast(String(res), "success");
    } catch (err) {
      const msg = (err as unknown as { message?: string })?.message ?? String(err);
      whTest = { ...whTest, [wh.id]: { status: "err", msg } };
      showToast("Test failed: " + msg);
    }
  }

  async function openWebhookLog() {
    webhookLogOpen = true;
    webhookLogLoading = true;
    webhookLogRows = [];
    try {
      const rows = await invoke("read_webhook_log", { limit: 200 }) as any[];
      webhookLogRows = Array.isArray(rows) ? rows : [];
    } catch (err) {
      const msg = (err as unknown as { message?: string })?.message ?? String(err);
      showToast("Could not read webhook log: " + msg);
    } finally {
      webhookLogLoading = false;
    }
  }

  let resendingWebhooks = $state(false);
  async function resendFailedWebhooks() {
    if (resendingWebhooks) return;
    resendingWebhooks = true;
    try {
      const summary = await invoke("resend_failed_webhooks") as string;
      showToast(summary, "default");
      // Refresh the log so the user sees the resent rows immediately.
      if (webhookLogOpen) await openWebhookLog();
    } catch (err) {
      const msg = (err as unknown as { message?: string })?.message ?? String(err);
      showToast("Resend failed: " + msg, "default");
    } finally {
      resendingWebhooks = false;
    }
  }

  function createSubFolder(sessionId: string, name: string, color: string) {
    if (!name.trim()) return;
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      if (!session.subfolders) session.subfolders = [];
      const newSub = {
        id: crypto.randomUUID(),
        name: name.trim(),
        color,
        logs: []
      };
      session.subfolders = [...session.subfolders, newSub];
      sessions = [...sessions];
      persistConfig();
      creatingSubFolderId = newSub.id;
      setTimeout(() => { if (creatingSubFolderId === newSub.id) creatingSubFolderId = null; }, 900);
    }
    newSubFolderName = "";
    isCreatingSubFolder = false;
  }

  function deleteSubFolder(sessionId: string, subFolderId: string) {
    const session = sessions.find(s => s.id === sessionId);
    if (session && session.subfolders) {
      const sub = session.subfolders.find(sf => sf.id === subFolderId);
      if (sub) {
        for (const log of sub.logs) {
          if (!session.logs.some(l => l.file_path === log.file_path)) {
            session.logs = [...session.logs, log];
          }
        }
        session.subfolders = session.subfolders.filter(sf => sf.id !== subFolderId);
        sessions = [...sessions];
        persistConfig();
      }
    }
  }

  function renameSubFolder(sessionId: string, subFolderId: string, name: string) {
    const session = sessions.find(s => s.id === sessionId);
    if (session?.subfolders) {
      const sf = session.subfolders.find(s => s.id === subFolderId);
      if (sf && name.trim()) {
        sf.name = name.trim().substring(0, 32);
        sessions = [...sessions];
        persistConfig();
      }
    }
    renamingSubFolderId = null;
    renameSubFolderValue = "";
  }

  function recolorSubFolder(sessionId: string, subFolderId: string, color: string) {
    const session = sessions.find(s => s.id === sessionId);
    if (session?.subfolders) {
      const sf = session.subfolders.find(s => s.id === subFolderId);
      if (sf) {
        sf.color = color;
        sessions = [...sessions];
        persistConfig();
      }
    }
    recoloringSubFolderId = null;
  }

  function getLogSession(filePath: string): SavedSession | null {
    return sessions.find((s) =>
      s.logs.some((l) => l.file_path === filePath) ||
      (s.subfolders ?? []).some((sf) => sf.logs.some((l) => l.file_path === filePath))
    ) ?? null;
  }

  function moveLogToSubFolder(sessionId: string, filePath: string, targetSubFolderId: string | null) {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    
    // Find the log object
    let logObj: UploadRecord | undefined;
    
    // Check main parent folder
    const mainIndex = session.logs.findIndex(l => l.file_path === filePath);
    if (mainIndex !== -1) {
      logObj = session.logs[mainIndex];
      if (targetSubFolderId) {
        session.logs.splice(mainIndex, 1);
      }
    } else if (session.subfolders) {
      // Check other subfolders
      for (const sf of session.subfolders) {
        const subIndex = sf.logs.findIndex(l => l.file_path === filePath);
        if (subIndex !== -1) {
          logObj = sf.logs[subIndex];
          if (sf.id !== targetSubFolderId) {
            sf.logs.splice(subIndex, 1);
          }
          break;
        }
      }
    }
    
    if (logObj) {
      if (targetSubFolderId && session.subfolders) {
        const targetSf = session.subfolders.find(sf => sf.id === targetSubFolderId);
        if (targetSf) {
          if (!targetSf.logs.some(l => l.file_path === filePath)) {
            targetSf.logs = [...targetSf.logs, logObj];
          }
        }
      } else {
        // Move back to parent folder root
        if (!session.logs.some(l => l.file_path === filePath)) {
          session.logs = [...session.logs, logObj];
        }
      }
      sessions = [...sessions];
      persistConfig();
    }
  }

  async function loadConfig() {
    try {
      const config: any = await invoke("get_config");
      logs_directory = config.logs_directory;
      dps_report_token = config.dps_report_token;
      discord_webhook = config.discord_webhook ?? "";
      discord_webhooks = (config.discord_webhooks ?? []).map((w: any) => ({
        id: w.id || `wh_${Math.random().toString(36).slice(2)}`,
        label: w.label ?? "",
        url: w.url ?? "",
        enabled: w.enabled ?? true,
        filters: {
          kinds: Array.isArray(w.filters?.kinds) ? w.filters.kinds : [],
          outcomes: Array.isArray(w.filters?.outcomes) ? w.filters.outcomes : [],
          only_cm: typeof w.filters?.only_cm === "boolean" ? w.filters.only_cm : null,
          only_lcm: typeof w.filters?.only_lcm === "boolean" ? w.filters.only_lcm : null,
          bosses: Array.isArray(w.filters?.bosses) ? w.filters.bosses : [],
        },
        mention: null,
        mention_roles: Array.isArray(w.mention_roles) ? w.mention_roles : (typeof w.mention === "string" && w.mention.trim() ? [{ label: "Mention", token: w.mention.trim() }] : []),
        thread_id: typeof w.thread_id === "string" ? w.thread_id : null,
        }));
      auto_upload = config.auto_upload;
      autostart = config.autostart;
      sound_notifications = config.sound_notifications ?? true;
      desktop_notifications = config.desktop_notifications ?? true;
      wingman_enabled = config.wingman_enabled ?? false;
      wingman_account = config.wingman_account ?? "";
      wvw_enabled = config.wvw_enabled ?? false;
      use_backup_dps = config.use_backup_dps ?? true;
      max_concurrent_uploads = config.max_concurrent_uploads ?? 2;
      watch_stability_delay_ms = config.watch_stability_delay_ms ?? 500;
      max_upload_retries = config.max_upload_retries ?? 3;
      min_log_seconds = config.min_log_seconds ?? 0;
      log_cache_max_files = config.log_cache_max_files ?? 50;
      reduce_motion = config.reduce_motion ?? false;
      hide_on_startup = config.hide_on_startup ?? false;
      compact_mode = config.compact_mode ?? false;
      applyCompactMode(compact_mode);
      accent = config.accent || "var(--accent)";
      applyAccent(accent);
      app_font = config.app_font || "inter-outfit";
      applyFont(app_font);
      sidebarOpen = config.app_sidebar_open ?? true;
      sessions = (config.sessions ?? []).map((s: any) => ({
        ...s,
        subfolders: s.subfolders ?? []
      }));
      squadPlans = normalizeSquadPlans((config.squad_plans ?? []).map((p: any) => ({
        ...p,
        subgroups: (p.subgroups ?? []).map((g: any) => ({
          ...g,
          slots: (g.slots ?? []).map((s: any) => ({ id: s.id ?? crypto.randomUUID(), roles: s.roles ?? [], ...s }))
        }))
      })));
      squadPlansLoaded = true;

      gw2_accounts = config.gw2_accounts ?? [];
      configLoaded = true;
      refreshCacheSize();
    } catch (e) {
      console.error("Failed to load config:", e);
      // Don't set configLoaded = true on failure, otherwise autosave will
      // overwrite the config with empty default values
      configLoaded = false;
      // Show error to user
      saveMessage = "Failed to load settings: " + (e instanceof Error ? e.message : String(e));
    }
  }

  // Autosave ALL settings on any change (Behavior, Appearance, Upload/Network,
  // Data portability toggles). Debounced so typing a numeric field fires one write,
  // not one per keystroke. Guarded by configLoaded so we don't rewrite disk with
  // startup defaults before loadConfig() has hydrated state. This is the silent
  // autosave; the explicit Save button (saveConfig) still works and writes the same
  // payload synchronously for an immediate confirmation.
  let lastWebhooksHash = '';

  $effect(() => {
    // touch every persisted setting so the effect re-runs on any change.
    logs_directory; dps_report_token; discord_webhook;
    auto_upload; autostart; sound_notifications; desktop_notifications;
    wingman_enabled; wingman_account; use_backup_dps; max_concurrent_uploads;
    watch_stability_delay_ms; max_upload_retries; min_log_seconds;
    reduce_motion; hide_on_startup; wvw_enabled; accent; compact_mode; app_font;
    sidebarOpen;
    JSON.stringify(sessions);
    JSON.stringify(gw2_accounts);
    const currentWebhooksHash = JSON.stringify(discord_webhooks);
    if (currentWebhooksHash === lastWebhooksHash) return;
    lastWebhooksHash = currentWebhooksHash;
    if (!configLoaded) return;
    // Don't autosave the empty pre-load state back over real disk data (would wipe
    // persisted plans). squadPlansLoaded flips true only after loadConfig() has
    // hydrated squadPlans from disk.
    if (!squadPlansLoaded) return;

    configSaveTimer = setTimeout(() => { persistConfig(); }, 400);
  });

  async function saveConfig() {
    isSaving = true;
    saveMessage = "";
    try {
      await invoke("save_config", {
        newConfig: {
          logs_directory,
          dps_report_token,
          discord_webhook,
          discord_webhooks: $state.snapshot(discord_webhooks),
          auto_upload,
          autostart,
          sound_notifications,
          desktop_notifications,
          sessions: $state.snapshot(sessions),
          wingman_enabled,
          wingman_account,
          wvw_enabled,
          max_concurrent_uploads,
          watch_stability_delay_ms,
          max_upload_retries,
          min_log_seconds,
          log_cache_max_files,
          reduce_motion,
          hide_on_startup,
          accent,
          compact_mode,
          use_backup_dps,
          app_font,
          app_sidebar_open: sidebarOpen,
          gw2_accounts: $state.snapshot(gw2_accounts),
          squad_plans: $state.snapshot(squadPlans),
        },
      });
      saveMessage = "Settings saved and watcher updated!";
      setTimeout(() => { saveMessage = ""; }, 3000);
    } catch (e: any) {
      saveMessage = `Error: ${e}`;
    } finally {
      isSaving = false;
    }
  }

  function applyReduceMotion(on: boolean) {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("reduce-motion", !!on);
  }

  function applyCompactMode(on: boolean) {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("mode-compact", !!on);
    void document.documentElement.offsetHeight;
  }

  function applyFont(fontName: string) {
    if (typeof document === "undefined") return;
    // Remove existing font classes
    const classes = Array.from(document.documentElement.classList);
    for (const c of classes) {
      if (c.startsWith("font-")) {
        document.documentElement.classList.remove(c);
      }
    }
    // Add the new selected class
    document.documentElement.classList.add(`font-${fontName}`);
  }

  function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} Bytes`;
  }

  async function refreshCacheSize() {
    try {
      const res = await invoke("get_cache_size") as [number, number];
      if (Array.isArray(res)) {
        logCacheSize = res[0] ?? 0;
        logCacheCount = res[1] ?? 0;
      }
    } catch (e) {
      console.error("Failed to query log cache size:", e);
    }
    try {
      const res = await invoke("get_history_cache_size") as [number, number];
      if (Array.isArray(res)) {
        historyCacheSize = res[0] ?? 0;
        historyCacheCount = res[1] ?? 0;
      }
    } catch (e) {
      console.error("Failed to query history cache size:", e);
    }
  }

  function openClearCacheModal() {
    if (logCacheCount > 0) {
      showClearCacheModal = true;
    }
  }

  async function confirmPurgeLogCache() {
    showClearCacheModal = false;
    try {
      await invoke("clear_log_cache");
      await refreshCacheSize();
      showToast("Log JSON cache cleared successfully!", "success");
    } catch (e) {
      showToast(`Failed to clear cache: ${e}`);
    }
  }

  function openClearHistoryModal() {
    if (historyCacheCount > 0) {
      showClearHistoryModal = true;
    }
  }

  async function confirmPurgeHistoryCache() {
    showClearHistoryModal = false;
    try {
      await invoke("clear_history_cache");
      await loadFullHistory();
      await refreshCacheSize();
      showToast("Analytics & History cache cleared successfully!", "success");
    } catch (e) {
      showToast(`Failed to clear history: ${e}`);
    }
  }

  // Sets the UI accent by deriving --accent (base) + --accent-h (hover/darker).
  // Dragging the color picker fires `input` continuously; repainting the WHOLE
  // app on every frame is what made the picker lag. So we scope the live preview
  // to just one element (the Settings panel) during the drag, then commit to
  // :root once on release. `writeAccent(scope)` is the coalesced writer.
  let accentRaf: number | null = null;
  let accentPending: string | null = null;
  let accentScope: HTMLElement | null = null;
  function writeAccent(scope: HTMLElement | null) {
    const base = accentPending!;
    const target = scope ?? document.documentElement;
    target.style.setProperty("--accent", base);
    target.style.setProperty("--accent-h", darken(base, 0.12));
  }
  function applyAccent(hex: string, scope?: HTMLElement | null) {
    if (typeof document === "undefined") return;
    accentPending = hex.startsWith("#") ? hex : `#${hex}`;
    accentScope = scope ?? null;
    if (accentRaf !== null) return;
    accentRaf = requestAnimationFrame(() => {
      accentRaf = null;
      writeAccent(accentScope);
    });
  }

  // ─── Accent Picker Modal ─────────────────────────────────────────────
  // A custom modal replaces the janky native <input type="color">. During a
  // drag only a tiny in-modal preview chip repaints, so the app never lags.
  let accentPickerOpen = $state(false);
  let pickerDraft = $state("#6366f1"); // working color inside the modal

  function openAccentPicker() {
    pickerDraft = accent.startsWith("#") ? accent : "#6366f1";
    accentPickerOpen = true;
  }
  function closeAccentPicker() {
    accentPickerOpen = false;
  }
  function applyAccentFromPicker() {
    accent = pickerDraft;
    applyAccent(pickerDraft); // commit to :root once
    accentPickerOpen = false;
  }
  function pickPreset(c: string) {
    pickerDraft = c;
  }

  // HSL <-> HEX helpers for the custom hue/SV picker.
  function hexToHsl(hex: string): { h: number; s: number; l: number } {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let hue = 0, sat = 0; const light = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
      sat = light > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (max === g) hue = ((b - r) / d + 2) * 60;
      else hue = ((r - g) / d + 4) * 60;
    }
    return { h: hue, s: sat * 100, l: light * 100 };
  }
  function hslToHex(h: number, s: number, l: number): string {
    s /= 100; l /= 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return Math.round(255 * c).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }
  let pickerHue = $derived(hexToHsl(pickerDraft).h);
  let pickerSat = $derived(hexToHsl(pickerDraft).s);
  let pickerLight = $derived(hexToHsl(pickerDraft).l);
  function setHue(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    pickerDraft = hslToHex(v, pickerSat, pickerLight);
  }

  // Lighten/darken a hex color by amt (positive = darker). Returns #rrggbb.
  function darken(hex: string, amt: number): string {
    const h = hex.replace("#", "");
    if (h.length !== 6) return hex;
    const num = parseInt(h, 16);
    const r = Math.max(0, Math.min(255, Math.round(((num >> 16) & 255) * (1 - amt))));
    const g = Math.max(0, Math.min(255, Math.round(((num >> 8) & 255) * (1 - amt))));
    const b = Math.max(0, Math.min(255, Math.round((num & 255) * (1 - amt))));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  async function handleManualUpload(sessionId?: string, subFolderId?: string | null) {
    manualUploadError = "";
    manualUploadSuccess = "";
    if (!manualFilePath.trim()) {
      manualUploadError = "Please enter a valid file path.";
      return;
    }
    const path = manualFilePath.trim();
    if (sessionId) {
      pendingManualTargets[path] = { sessionId, subFolderId: subFolderId ?? null };
    }
    try {
      await invoke("trigger_manual_upload", { filePath: path });
      manualUploadSuccess = "File queued for upload!";
      manualFilePath = "";
    } catch (err) {
      manualUploadError = "Failed to upload: " + err;
    }
  }

</script>

{#snippet logHeaderLeft(log: any)}
<div class="log-header-left">
  {#if log.status === "Failed"}
    <div class="failed-icon-container" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 6px; font-size: 15px; color: #f87171; flex-shrink: 0; font-family: sans-serif; font-weight: bold;">⚠</div>
    <div class="boss-details" style="min-width: 0;">
      <div class="boss-title-row" style="display: flex; align-items: center; gap: 8px;">
        <span class="boss-name" style="color: #f87171; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Upload Failed: {log.file_name}</span>
        <span class="badge badge-error" style="background: rgba(239,68,68,0.15); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); font-size: 9px; padding: 2px 6px;">Error</span>
      </div>
      <div class="log-meta">
        <span class="meta-item">🕒 {log.timestamp}</span>
      </div>
    </div>
  {:else}
    <div class="boss-icon-container">
      {#if isReadingLog(log)}
        <div class="upload-icon-placeholder">
          <i class="fa-solid fa-cloud-arrow-up"></i>
        </div>
      {:else}
        <img src={resolveBossIconSrc(log)} alt="" class="boss-icon-img" onerror={(e) => { const el = e.currentTarget as HTMLImageElement; // Cascade: local -> external fallback -> unknown. Never loop.
          if (!el.src.endsWith('/bosses/unknown.png')) {
            if (log.boss_icon && el.src !== iconForExternal(log.boss_icon)) { el.src = iconForExternal(log.boss_icon); }
            else { el.src = '/bosses/unknown.png'; }
          }
        }} />
      {/if}
    </div>
    <div class="boss-details" style="min-width: 0;">
      <div class="boss-title-row">
        <span class="boss-name" role={log.boss_name ? "button" : undefined} style="cursor: {log.boss_name ? 'pointer' : 'default'};" title={log.boss_name ? "Filter to this boss" : ""} onclick={(e) => { e.stopPropagation(); if (log.boss_name) setBossFilter(log); }} onkeydown={(e) => { if ((e.key === "Enter" || e.key === " ") && log.boss_name) { e.preventDefault(); setBossFilter(log); } }}>{log.boss_name ? getModeBossDisplayName(log.boss_name, log) : (log.file_name ?? "")}</span>
        {#if log.status === "Processing"}
          <span class="status-pill sp-processing">⏳ Processing…</span>
        {:else if clean(log.boss_name).includes("golem")}
          <span class="cm-badge training-badge">Training</span>
        {:else if log.is_quick_play}
          <span class="cm-badge quickplay-badge">Quick Play</span>
        {:else if showLegendaryCm(log)}
          <span class="cm-badge lcm-badge">Legendary CM</span>
        {:else if showChallengeMode(log)}
          <span class="cm-badge">Challenge Mode</span>
        {:else if isStoryBoss(log.boss_name, log)}
          <span class="cm-badge story-badge">Personal Story</span>
        {:else if log.boss_name}
          <span class="cm-badge nm-badge">Normal Mode</span>
        {:else if log.status === "Skipped"}
          <span class="status-pill sp-skipped">Skipped</span>
        {/if}
        {#if wingman_enabled && (log.wingman_status === "failed" || log.wingman_status === "imported" || wingmanUi[log.file_path] === "sending" || log.wingman_status === "done")}
          {@const wmState = wingmanUi[log.file_path] === "sending" ? "sending" : (log.wingman_status ?? "failed")}
          {#if wmState === "imported"}
            <span class="wm-chip wm-imported" title="This log was already imported into Wingman.">
              <i class="fa-solid fa-shield-halved"></i> Imported
            </span>
          {/if}
          {#if wmState === "failed"}
            {#if wingmanStatus === "offline"}
              <span class="wm-chip wm-offline" title="GW2 Wingman is currently offline — this log will be retried once the service is reachable again.">
                <i class="fa-solid fa-shield-halved"></i> Wingman offline
              </span>
            {:else}
              <button class="wm-chip wm-failed" title="Wingman was unreachable when this log uploaded — click to retry importing it into Wingman." onclick={(e) => { e.stopPropagation(); sendToWingman(log.file_path); }}>
                <i class="fa-solid fa-shield-halved"></i> Send to Wingman
              </button>
              {#if likelyCause(log)}
                <span class="wm-cause">{likelyCause(log)}</span>
              {/if}
            {/if}
          {:else if wmState === "sending"}
            <span class="wm-chip wm-sending"><i class="fa-solid fa-shield-halved wm-spin"></i> Uploading…</span>
          {:else if wmState === "done"}
            <span class="wm-chip wm-done"><i class="fa-solid fa-shield-halved"></i> Completed</span>
          {/if}
        {/if}
        {#if discord_webhooks.length > 0 && log.discord_pending === true}
          <span class="wm-chip wm-offline" title="A Discord webhook post failed when this log uploaded. It will be retried automatically the next time this log uploads successfully (e.g. on a dps.report recovery sweep).">
            <i class="fa-brands fa-discord"></i> Discord pending
          </span>
        {/if}
        {#each vlCurrentRanks(log) as rk}
          <span class="vl-badge" role="button" tabindex="0" style="color: {rk.text_color}; background: {rk.bg_color}; border: 1px solid color-mix(in srgb, {rk.text_color} 45%, transparent); cursor: pointer;" title="Filter to {rk.label} logs" onclick={(e) => { e.stopPropagation(); setVlRankFilter(rk.id); }} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setVlRankFilter(rk.id); } }}><span class="vl-badge-icon">{rk.icon}</span>{rk.label}</span>
        {/each}
        {#if log.status === "On Hold"}
          <span class="status-pill sp-onhold">⧖ On Hold</span>
        {:else if log.status === "Duplicate"}
          <span class="status-pill sp-duplicate">Duplicate — resolving…</span>
        {:else if log.status === "Completed"}
          {#if isStoryBoss(log.boss_name, log)}
            <span class="status-pill sp-done">✓ Completed</span>
          {:else if log.success === true}
            <span class="status-pill sp-success">✓ Success</span>
          {:else if log.success === false}
            <span class="status-pill sp-failed">✗ Failed</span>
          {:else}
            <span class="status-pill sp-unknown">? Unknown</span>
          {/if}
        {:else if log.status === "Processing"}
          <span class="status-pill sp-processing">⧗ Elite Insights processing</span>
        {/if}
      </div>
      {#if (log.old_lions_court && log.success !== true) || isDragonvoid(log.boss_name)}
        <div class="log-meta">
          {#if log.duration != null}
            <span class="meta-item"><i class="fa-solid fa-stopwatch" style="margin-right: 4px; font-size: 11px;"></i> {formatDuration(log.duration)}</span>
          {/if}
          {#if log.num_players != null}
            <span class="meta-item"><i class="fa-solid fa-users" style="margin-right: 4px; font-size: 11px;"></i> {log.num_players} Players</span>
          {/if}
          <span class="meta-item"><i class="fa-solid fa-calendar-days" style="margin-right: 4px; font-size: 11px;"></i> {log.timestamp}</span>
        </div>
      {/if}
      <!-- Harvest Temple "Dragon Council" strip: one chip per elder dragon.
           Only valid for The Dragonvoid — never render it for other bosses
           (e.g. Whisper/Fraenir of Jormag also carry "jormag" phases on the
           backend, so we gate on the canonical Dragonvoid boss keys here too).
           The EVTC itself carries no per-dragon HP; dps.report supplies it. -->
      {#if isDragonvoid(log.boss_name) && log.bosses_phases && log.bosses_phases.length}
        {@const hpByKey = new Map<string, DragonHp>((log.bosses_hp ?? []).map((d: DragonHp): [string, DragonHp] => [d.key, d]))}
        {@const council = dragonCouncilMerged(log.bosses_phases, hpByKey)}
        <div class="dragon-council merged" aria-label="Dragon Council">
          {#each council as p, i (p.key)}
            <div
              class="dragon-chip tk-{p.kind}"
              class:cleared={p.cleared}
              class:wiped={!p.cleared}
              style="--i:{i}"
              title="{p.name}: {p.cleared ? 'Cleared' : 'Not cleared'}{p.hp != null ? ' · ' + (p.died ? 'Defeated' : p.hp!.toFixed(1) + '% HP left') : ''}"
            >
              <img class="dragon-icon" src={p.icon} alt={p.name} onerror={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
              {#if p.hp != null}
                <div class="dragon-bar"><div class="dragon-fill dstate-{p.hpState}" style="width:{p.hp}%;"></div></div>
              {/if}
              <span class="dragon-name">{p.name}</span>
              <span class="phase-mark"><i class="fa-solid {p.cleared ? 'fa-check' : 'fa-xmark'}"></i></span>
            </div>
          {/each}
        </div>
      {:else if isDragonvoid(log.boss_name) && log.bosses_hp && log.bosses_hp.length}
        {@const hasPhases = log.bosses_phases && log.bosses_phases.length}
        {@const purification2 =
          hasPhases
            ? log.bosses_phases.find((p: any) => p.key === "purification2")
            : null}
        {@const council = dragonCouncil(log.bosses_hp)}
        <div class="dragon-council" aria-label="Dragon Council HP">
          {#each council as d, i (d.key)}
            {@const tcGate = d.key === "timecaster" && purification2 != null}
            {@const tcCleared = tcGate ? purification2.cleared : d.reached}
            <div
              class="dragon-chip dstate-{d.state}"
              class:reached={d.reached}
              class:cleared={tcCleared}
              style="--i:{i}"
              title="{d.name}: {d.state === 'dead' ? 'Defeated' : d.state === 'alive' ? d.hp_left.toFixed(1) + '% HP left' : 'Not reached'}"
            >
              <img class="dragon-icon" src="/bosses/the{d.key}void.png" alt={d.name} onerror={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
              <div class="dragon-bar"><div class="dragon-fill" style="width:{d.pct}%;"></div></div>
              <span class="dragon-name">{d.name}</span>
            </div>
          {/each}
        </div>
      {/if}
      {#if log.bosses_phases && log.bosses_phases.length && log.dragonvoid_add_evidence}
        {@const addRows = Object.entries(log.dragonvoid_add_evidence.hp_left)}
        {@const addSet = new Set(Object.keys(log.dragonvoid_add_evidence.died ?? {}))}
        <div class="add-council" aria-label="Dragonvoid Add Evidence">
          {#each addRows as [addName, hp]}
            {@const addOrder = orderForAdd(addName)}
            {@const hpValue = typeof hp === 'number' ? hp : 0}
            {@const died = addSet.has(addName) && log.dragonvoid_add_evidence!.died![addName]}
            <div
              class="dragon-chip tk-miniboss add-chip"
              class:cleared={died}
              title="{addName}: {died ? 'Defeated' : 'Survived'} · {hpValue.toFixed(1)}% HP"
              style="order: {addOrder}"
            >
              <img
                class="dragon-icon"
                src="/bosses/{addName}.png"
                alt={addName}
                onerror={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
              />
              <span class="dragon-name">{addName}</span>
              <span class="phase-mark"><i class="fa-solid {died ? 'fa-check' : 'fa-xmark'}"></i></span>
            </div>
          {/each}
        </div>
      {/if}
      {#if isKainengOverlook(log.boss_name) && log.kaineng_phases && log.kaineng_phases.length}
        {@const kaiPhases = log.kaineng_phases}
        <div class="kaineng-phases" aria-label="Kaineng Overlook Phases">
          <button type="button" class="kai-phases-header" onclick={() => kaiPhasesCollapsed = !kaiPhasesCollapsed}>
            <span class="kai-phases-title">Phases</span>
            <span class="kai-phases-toggle"><i class="fa-solid {kaiPhasesCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}"></i></span>
          </button>
          {#if !kaiPhasesCollapsed}
            {#each kaiPhases as phase, i}
              <div class="kai-phase" class:boss-phase={phase.phase_type === 'boss'} class:split-phase={phase.phase_type === 'split'} class:wiped={phase.success === false}>
                <div class="kai-phase-header">
                  <span class="kai-phase-name">{phase.name}</span>
                  {#if phase.success === true}
                    <span class="kai-phase-status cleared">✓ Cleared</span>
                  {:else if phase.success === false}
                    <span class="kai-phase-status wiped">✗ Wiped</span>
                  {/if}
                </div>
                <div class="kai-phase-targets">
                  {#each phase.targets as target}
                    <div class="kai-target" class:killed={target.killed}>
                      <img class="kai-target-icon" src="/bosses/{target.icon}.png" alt={target.name} onerror={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                      <span class="kai-target-name">{target.name}</span>
                      {#if target.killed}
                        <span class="kai-target-badge killed">Killed</span>
                      {:else if target.hp_left != null}
                        <span class="kai-target-badge hp">{target.hp_left.toFixed(1)}% HP</span>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
      <div class="log-meta">
        {#if log.status === "Parsing" || log.status === "Uploading" || log.status === "Reading" || log.status === "Queued" || log.status === "On Hold"}
          <!-- Stage stepper: one honest indicator of pipeline position -->
          <div class="stage-stepper">
            {#each uploadStageList(log) as st, i}
              {#if i > 0}<span class="stage-connector" class:filled={uploadStageList(log)[i-1].state === "done"}></span>{/if}
              <span class="stage-step stage-{st.state}">
                {#if st.state === "done"}<i class="fa-solid fa-check"></i> {:else if st.state === "active"}<span class="stage-dot"></span> {/if}{st.label}
              </span>
            {/each}
          </div>
        {/if}
        <div class="meta-line">
          {#if log.boss_hp_left != null && shouldShowHpLeft(log) && !(log.twin_largos && log.success !== true) && !(log.eyes && log.success !== true) && !(log.voice_claw && log.success !== true) && !(log.aetherblade && log.success !== true) && !(log.old_lions_court && log.success !== true) && !isDragonvoid(log.boss_name)}
            {#if log.ura_health_regen === "AHR"}
              <span class="custom-tooltip-container">
                <span class="ura-ahr-badge">AHR</span>
                <span class="custom-tooltip">After Health Regen</span>
              </span>
            {/if}
            <span class="meta-item" style="color:#f87171; font-weight:700;"><i class="fa-solid fa-heart-crack" style="margin-right: 4px; font-size: 11px;"></i> {log.boss_hp_left.toFixed(2)}% HP Left</span>
          {/if}
          {#if log.twin_largos && log.success !== true}
            <div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;">
              {#if log.twin_largos.nikare_hp_left != null}
                {#if log.twin_largos.nikare_hp_left <= 1.0}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person" style="margin-right:4px; font-size:11px;"></i> Nikare <span style="color:#4ade80; margin-left:6px;">Killed</span></span>
                {:else}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person" style="margin-right:4px; font-size:11px;"></i> Nikare <span style="color:#f87171; margin-left:6px;">{log.twin_largos.nikare_hp_left.toFixed(2)}% HP Left</span></span>
                {/if}
              {/if}
              {#if log.twin_largos.kenut_hp_left != null}
                {#if log.twin_largos.kenut_hp_left <= 1.0}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person" style="margin-right:4px; font-size:11px;"></i> Kenut <span style="color:#4ade80; margin-left:6px;">Killed</span></span>
                {:else}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person" style="margin-right:4px; font-size:11px;"></i> Kenut <span style="color:#f87171; margin-left:6px;">{log.twin_largos.kenut_hp_left.toFixed(2)}% HP Left</span></span>
                {/if}
              {/if}
            </div>
          {/if}
          {#if log.eyes && log.success !== true}
            <div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;">
              {#if log.eyes.darkness_hp_left != null}
                {#if log.eyes.darkness_hp_left <= 1.0}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-eye" style="margin-right:4px; font-size:11px;"></i> Eye of Darkness <span style="color:#4ade80; margin-left:6px;">Killed</span></span>
                {:else}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-eye" style="margin-right:4px; font-size:11px;"></i> Eye of Darkness <span style="color:#f87171; margin-left:6px;">{log.eyes.darkness_hp_left.toFixed(2)}% HP Left</span></span>
                {/if}
              {/if}
              {#if log.eyes.despair_hp_left != null}
                {#if log.eyes.despair_hp_left <= 1.0}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-eye" style="margin-right:4px; font-size:11px;"></i> Eye of Despair <span style="color:#4ade80; margin-left:6px;">Killed</span></span>
                {:else}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-eye" style="margin-right:4px; font-size:11px;"></i> Eye of Despair <span style="color:#f87171; margin-left:6px;">{log.eyes.despair_hp_left.toFixed(2)}% HP Left</span></span>
                {/if}
              {/if}
            </div>
          {/if}
          {#if log.voice_claw && log.success !== true}
            <div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;">
              {#if log.voice_claw.voice_hp_left != null}
                {#if log.voice_claw.voice_hp_left <= 1.0}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person" style="margin-right:4px; font-size:11px;"></i> Voice <span style="color:#4ade80; margin-left:6px;">Killed</span></span>
                {:else}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person" style="margin-right:4px; font-size:11px;"></i> Voice <span style="color:#f87171; margin-left:6px;">{log.voice_claw.voice_hp_left.toFixed(2)}% HP Left</span></span>
                {/if}
              {/if}
              {#if log.voice_claw.claw_hp_left != null}
                {#if log.voice_claw.claw_hp_left <= 1.0}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person" style="margin-right:4px; font-size:11px;"></i> Claw <span style="color:#4ade80; margin-left:6px;">Killed</span></span>
                {:else}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person" style="margin-right:4px; font-size:11px;"></i> Claw <span style="color:#f87171; margin-left:6px;">{log.voice_claw.claw_hp_left.toFixed(2)}% HP Left</span></span>
                {/if}
              {/if}
            </div>
          {/if}
          {#if log.old_lions_court && log.success !== true}
            <div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;">
              {#if log.old_lions_court.phase != null}
                <span class="meta-item" style="color:#cbd5e1; font-weight:700;"><i class="fa-solid fa-tower-observation" style="margin-right:4px; font-size:11px;"></i> Phase {log.old_lions_court.phase}</span>
              {/if}
              {#if log.old_lions_court.cc_wipe}
                <span class="meta-item" style="color:#fbbf24; font-weight:700;"><i class="fa-solid fa-puzzle-piece" style="margin-right:4px; font-size:11px;"></i> CC Wipe</span>
              {/if}
              {#if log.old_lions_court.vermilion_hp_left != null}
                {#if log.old_lions_court.vermilion_hp_left <= 1.0}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-robot" style="margin-right:4px; font-size:11px; color:#ef4444;"></i> Prototype Vermilion <span style="color:#4ade80; margin-left:6px;">Killed</span></span>
                {:else}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-robot" style="margin-right:4px; font-size:11px; color:#ef4444;"></i> Prototype Vermilion <span style="color:#f87171; margin-left:6px;">{log.old_lions_court.vermilion_hp_left.toFixed(2)}% HP Left</span></span>
                {/if}
              {/if}
              {#if log.old_lions_court.arsenite_hp_left != null}
                {#if log.old_lions_court.arsenite_hp_left <= 1.0}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-robot" style="margin-right:4px; font-size:11px; color:#22c55e;"></i> Prototype Arsenite <span style="color:#4ade80; margin-left:6px;">Killed</span></span>
                {:else}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-robot" style="margin-right:4px; font-size:11px; color:#22c55e;"></i> Prototype Arsenite <span style="color:#f87171; margin-left:6px;">{log.old_lions_court.arsenite_hp_left.toFixed(2)}% HP Left</span></span>
                {/if}
              {/if}
              {#if log.old_lions_court.indigo_hp_left != null}
                {#if log.old_lions_court.indigo_hp_left <= 1.0}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-robot" style="margin-right:4px; font-size:11px; color:#3b82f6;"></i> Prototype Indigo <span style="color:#4ade80; margin-left:6px;">Killed</span></span>
                {:else}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-robot" style="margin-right:4px; font-size:11px; color:#3b82f6;"></i> Prototype Indigo <span style="color:#f87171; margin-left:6px;">{log.old_lions_court.indigo_hp_left.toFixed(2)}% HP Left</span></span>
                {/if}
              {/if}
            </div>
          {/if}
          {#if log.aetherblade && log.success === false}
            <div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;">
              {#if log.aetherblade.maitrin_hp_left != null}
                {#if log.aetherblade.maitrin_hp_left <= 1.0}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-skull" style="margin-right:4px; font-size:11px;"></i> Mai Trin <span style="color:#4ade80; margin-left:6px;">Killed</span></span>
                {:else}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-skull" style="margin-right:4px; font-size:11px;"></i> Mai Trin <span style="color:#f87171; margin-left:6px;">{log.aetherblade.maitrin_hp_left.toFixed(2)}% HP Left</span></span>
                {/if}
              {/if}
              {#if log.aetherblade.scarlet_hp_left != null}
                {#if log.aetherblade.scarlet_hp_left <= 1.0}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person" style="margin-right:4px; font-size:11px;"></i> Echo of Scarlet <span style="color:#4ade80; margin-left:6px;">Killed</span></span>
                {:else}
                  <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person" style="margin-right:4px; font-size:11px;"></i> Echo of Scarlet <span style="color:#f87171; margin-left:6px;">{log.aetherblade.scarlet_hp_left.toFixed(2)}% HP Left</span></span>
                {/if}
              {/if}
            </div>
          {/if}
          {#if log.ca_arms && log.success === false}
            <div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;">
              {#if log.ca_arms.right_arm_hp_left <= 1.0}
                <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-hand-fist" style="margin-right:4px; font-size:11px;"></i> Right Arm <span style="color:#4ade80; margin-left:6px;">Killed</span></span>
              {:else}
                <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-hand-fist" style="margin-right:4px; font-size:11px;"></i> Right Arm <span style="color:#f87171; margin-left:6px;">{log.ca_arms.right_arm_hp_left.toFixed(2)}% HP Left</span></span>
              {/if}
              {#if log.ca_arms.left_arm_hp_left <= 1.0}
                <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-hand-fist" style="margin-right:4px; font-size:11px;"></i> Left Arm <span style="color:#4ade80; margin-left:6px;">Killed</span></span>
              {:else}
                <span class="meta-item" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-hand-fist" style="margin-right:4px; font-size:11px;"></i> Left Arm <span style="color:#f87171; margin-left:6px;">{log.ca_arms.left_arm_hp_left.toFixed(2)}% HP Left</span></span>
              {/if}
            </div>
          {/if}
          {#if log.cerus_empowered_stacks != null}
            <span class="cerus-stacks-badge" title={log.boss_hp_left != null && log.boss_hp_left > 50.0 ? `Cerus Empowered Stacks at Wipe (${log.boss_hp_left.toFixed(1)}% HP Left)` : 'Cerus Empowered Stacks at 50% HP Left'}>
              <img src="/mechanics/enraged.png" alt="" style="width: 12px; height: 12px; margin-right: 4px; object-fit: contain; vertical-align: middle;" />
              {log.cerus_empowered_stacks} Stacks
            </span>
          {/if}
          {#if !(log.old_lions_court && log.success !== true) && !isDragonvoid(log.boss_name)}
            {#if log.duration != null}
              {#if isGolemLog(log) && log.group_dps != null}
                {@const profIconSrc = (log.players && log.players[0]) ? getProfIcon(log.players[0]) : "/professions/guardian.png"}
                <span class="dmg-dealt-badge" title="Total damage dealt by the squad (golem log)">
                  <img src={profIconSrc} alt="" style="width: 20px; height: 20px; margin-right: 4px; object-fit: contain; vertical-align: middle;" />{formatComplete(log.group_dps)} DPS
                </span>
              {/if}
              <span class="meta-item custom-tooltip-container">
                <span class="custom-tooltip">{log.is_convergence && log.is_cm ? 'Total Convergence Time' : 'Duration'}</span>
                <i class="fa-solid fa-stopwatch" style="margin-right: 4px; font-size: 11px;"></i> {formatDuration(log.duration)}
              </span>
              {#if log.is_convergence && log.is_cm && log.boss_duration != null && Math.abs((log.boss_duration ?? 0) - (log.duration ?? 0)) > 1}
                {#if isGolemLog(log) && log.group_dps != null}
                  <span class="dmg-badge" title="Group DPS (total squad damage output)">
                    <i class="fa-solid fa-bolt" style="margin-right: 3px; font-size: 10px;"></i>{formatDps(log.group_dps)} DPS
                  </span>
                {/if}
                <span class="meta-item custom-tooltip-container" style="margin-left:4px;">
                  <span class="custom-tooltip">Total Boss Time</span>
                  <i class="fa-solid fa-crosshairs" style="margin-right: 4px; font-size: 11px;"></i> {formatDuration(log.boss_duration)}
                </span>
              {/if}
              <span class="meta-divider">|</span>
            {/if}
            {#if log.num_players != null}
              <span class="meta-item"><i class="fa-solid fa-users" style="margin-right: 4px; font-size: 11px;"></i> {log.num_players} Players</span>
              <span class="meta-divider">|</span>
            {/if}
            <span class="meta-item"><i class="fa-solid fa-calendar-days" style="margin-right: 4px; font-size: 11px;"></i> {log.timestamp}</span>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
{/snippet}



{#snippet logFooter(log: any, onDelete: () => void)}
<div class="log-footer">
  <div class="log-actions-row">
    <!-- Primary Action 1: Stats Modal -->
    <div class="custom-tooltip-container">
      <button class="action-btn primary-action-btn" class:disabled-resolving={!log.url && !log.local_fallback} disabled={!log.url && !log.local_fallback} onclick={(e) => { e.stopPropagation(); openStats(log); }}>
        <i class="fa-solid fa-chart-bar"></i> <span class="btn-text">Stats</span>
      </button>
      <div class="custom-tooltip custom-tooltip-box">{log.url || log.local_fallback ? "Combat stats — DPS, cleave & boon uptime per player" : "No report link available yet"}</div>
    </div>

    <!-- Primary Action 2: Open Log in Browser (if online) -->
    <div class="custom-tooltip-container">
      <button class="action-btn primary-action-btn" class:disabled-offline={!isOnline && log.url} class:disabled-resolving={!log.url} class:disabled-uploading={log.status === "Uploading"} disabled={!log.url || !isOnline} onclick={(e) => { e.stopPropagation(); if (isOnline && log.url) openExternalUrl(log.url); }}>
        {#if log.url}
          <i class="fa-solid fa-globe"></i> <span class="btn-text">Open Log</span>
        {:else if log.status === "Duplicate"}
          <i class="fa-solid fa-spinner fa-spin"></i> <span class="btn-text">Resolving...</span>
        {:else}
          <span style="opacity: 0.5;">🔗 <span class="btn-text">No Link</span></span>
        {/if}
      </button>
      <div class="custom-tooltip">
        {#if log.url}
          {isOnline ? log.url : "You are offline. Requires internet."}
        {:else if log.status === "Duplicate"}
          Log is processing on dps.report. Link will appear shortly.
        {:else}
          No report link yet.
        {/if}
      </div>
    </div>

    <!-- Direct Quick Actions (responsive: hide/collapse on small screens) -->
    <div class="custom-tooltip-container quick-action-desktop-only">
      <button class="action-btn secondary-action-btn" disabled={!log.url || !isOnline} onclick={(e) => { e.stopPropagation(); if (isOnline && log.url) copySingleLink(log.url, log.file_path); }}>
        {#if copiedLogPath === log.file_path}
          <i class="fa-solid fa-check" style="color: var(--success); animation: copied-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);"></i>
        {:else}
          <i class="fa-solid fa-copy"></i>
        {/if}
        <span class="btn-text">Copy</span>
      </button>
      <div class="custom-tooltip">Copy dps.report URL</div>
    </div>

    <div class="custom-tooltip-container quick-action-desktop-only">
      <button class="action-btn secondary-action-btn" disabled={!log.url || !isOnline} onclick={(e) => { e.stopPropagation(); if (isOnline && log.url) openReplayModal(log.url); }}>
        <i class="fa-solid fa-gamepad"></i> <span class="btn-text">Replay</span>
      </button>
      <div class="custom-tooltip">Open 2D Fight Replay</div>
    </div>

    <div class="custom-tooltip-container quick-action-desktop-only">
      <button class="action-btn secondary-action-btn quick-action-desktop-only btn-notes" class:active-toggle={notesOpen[cardId(log)]} class:has-notes={log.notes && log.notes.length > 0} title={log.notes && log.notes.length > 0 ? `Notes (${log.notes.length})` : "Notes"} onclick={(e) => { e.stopPropagation(); toggleNotes(cardId(log)); }}>
        <i class="fa-solid fa-note-sticky"></i> <span class="btn-text">Notes</span> {#if log.notes && log.notes.length > 0}<span class="badge-count">{log.notes.length}</span>{/if}
      </button>
      <div class="custom-tooltip">Notes</div>
    </div>

    {#if vlAvailableFor(log)}
      <button class="action-btn secondary-action-btn quick-action-desktop-only" title="VL Rank" onclick={(e) => { e.stopPropagation(); openVlModal(log); }}>
        <i class="fa-solid fa-medal"></i> <span class="btn-text">VL Rank</span> {#if vlRanksOf(log).length > 0}<span class="badge-count">{vlRanksOf(log).length}</span>{/if}
      </button>
    {/if}

    {#if getLogSession(log.file_path) != null}
      {@const logSession = getLogSession(log.file_path)!}
      <button class="action-btn secondary-action-btn quick-action-desktop-only" title="Move To" onclick={(e) => { e.stopPropagation(); openMovePicker(log, logSession.id, null, (target) => moveLogToSubFolder(logSession.id, log.file_path, target)); }}>
        <i class="fa-solid fa-arrow-right-arrow-left"></i> <span class="btn-text">Move</span>
      </button>
    {:else}
      <div class="custom-tooltip-container quick-action-desktop-only">
        <button class="action-btn secondary-action-btn quick-action-desktop-only" onclick={(e) => { e.stopPropagation(); openSavePicker([log], (sid) => addLogToSession(log.file_path, sid)); }}>
          <i class="fa-solid fa-folder-open"></i> <span class="btn-text">Save</span>
        </button>
        <div class="custom-tooltip">Save to Session</div>
      </div>
    {/if}

    <!-- Troubleshooting (direct quick action for failed logs) -->
    {#if log.status === "Failed" && log.diagnostics}
      <button class="action-btn secondary-action-btn troubleshoot-btn quick-action-desktop-only" title="Troubleshoot" onclick={(e) => { e.stopPropagation(); showTroubleshoot[log.file_path] = !showTroubleshoot[log.file_path]; }}>
        <i class="fa-solid fa-circle-question"></i> <span class="btn-text">Troubleshoot</span>
      </button>
    {/if}

    <!-- More Actions Dropdown Menu (Overflow) -->
    <div class="card-menu-container">
      <button class="card-menu-btn" onclick={(e) => { e.stopPropagation(); activeMenuCard = activeMenuCard === cardId(log) ? null : cardId(log); }} title="More Actions" aria-label="More actions" aria-haspopup="menu" aria-expanded={activeMenuCard === cardId(log)}>
        <i class="fa-solid fa-ellipsis"></i>
      </button>
      {#if activeMenuCard === cardId(log)}
        <div class="card-dropdown-menu" onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.stopPropagation(); } }} role="menu" aria-label="More actions" tabindex="-1">
          <!-- Items shown in overflow menu (always available or revealed on narrow screens) -->
          <button class="card-dropdown-item overflow-item-mobile" disabled={!log.url || !isOnline} onclick={() => { activeMenuCard = null; if (isOnline && log.url) copySingleLink(log.url, log.file_path); }}>
            <i class="fa-solid fa-copy"></i> Copy Link
          </button>
          
          <button class="card-dropdown-item overflow-item-mobile" disabled={!log.url || !isOnline} onclick={() => { activeMenuCard = null; if (isOnline && log.url) openReplayModal(log.url); }}>
            <i class="fa-solid fa-gamepad"></i> 2D Replay
          </button>

          <button class="card-dropdown-item overflow-item-mobile" onclick={() => { activeMenuCard = null; toggleNotes(cardId(log)); }}>
            <i class="fa-solid fa-note-sticky"></i> Notes {#if log.notes && log.notes.length > 0}<span class="notes-count">({log.notes.length})</span>{/if}
          </button>

          {#if vlAvailableFor(log)}
            <button class="card-dropdown-item overflow-item-mobile" onclick={() => { activeMenuCard = null; openVlModal(log); }}>
              <i class="fa-solid fa-medal"></i> VL Rank {#if vlRanksOf(log).length > 0}({vlRanksOf(log).length}){/if}
            </button>
          {/if}

          <button class="card-dropdown-item overflow-item-mobile" onclick={() => { activeMenuCard = null; openSavePicker([log], (sid) => addLogToSession(log.file_path, sid)); }}>
            <i class="fa-solid fa-folder-open"></i> Save to Session
          </button>

          {#if getLogSession(log.file_path) != null}
            {@const logSession = getLogSession(log.file_path)!}
            <button class="card-dropdown-item overflow-item-mobile" onclick={() => { activeMenuCard = null; openMovePicker(log, logSession.id, null, (target) => moveLogToSubFolder(logSession.id, log.file_path, target)); }}>
              <i class="fa-solid fa-arrow-right-arrow-left"></i> Move To
            </button>
          {/if}

          {#if log.status === "Failed" && log.diagnostics}
            <button class="card-dropdown-item" onclick={() => { activeMenuCard = null; showTroubleshoot[log.file_path] = !showTroubleshoot[log.file_path]; }}>
              <i class="fa-solid fa-circle-question"></i> Troubleshoot
            </button>
          {/if}

          {#if log.status === "Failed" || log.status === "On Hold"}
            <button class="card-dropdown-item" disabled={retryingPaths.has(log.file_path)} onclick={() => { activeMenuCard = null; if (!retryingPaths.has(log.file_path)) retryLog(log.file_path); }}>
              <i class="fa-solid fa-rotate-right"></i> {retryingPaths.has(log.file_path) ? "Retrying…" : "Retry Upload"}
            </button>
          {/if}
          {#if log.status === "Duplicate"}
            <button class="card-dropdown-item" onclick={() => { activeMenuCard = null; retryLog(log.file_path); }}>
              <i class="fa-solid fa-rotate-right"></i> Retry Upload
            </button>
          {/if}

          <div class="card-dropdown-divider"></div>

          <button class="card-dropdown-item danger" title="Delete log from history" onclick={() => { activeMenuCard = null; onDelete(); }}>
            <i class="fa-solid fa-trash-can"></i> Delete Log
          </button>
        </div>
      {/if}
    </div>
  </div>
  {#if notesOpen[cardId(log)]}
    <div class="notes-section">
      <div class="notes-title">
        <i class="fa-solid fa-note-sticky"></i> Notes
        {#if log.notes && log.notes.length > 0}<span class="notes-count">({log.notes.length})</span>{/if}
      </div>
      {#if log.notes && log.notes.length > 0}
        <div class="notes-list">
          {#each log.notes as note (note.id)}
            <div class="note-item">
              <span class="note-text">{note.text}</span>
              <button class="note-delete" title="Delete Note" onclick={(e) => { e.stopPropagation(); removeNote(log, note.id); }}>✕</button>
            </div>
          {/each}
        </div>
      {/if}
      <div class="notes-compose">
        <input
          class="notes-input"
          type="text"
          placeholder="Write a note…"
          value={noteDraft[cardId(log)] ?? ""}
          oninput={(e) => { noteDraft[cardId(log)] = (e.currentTarget as HTMLInputElement).value; }}
          onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNote(log); } }}
        />
        <button class="notes-add-btn" onclick={(e) => { e.stopPropagation(); addNote(log); }}>New</button>
      </div>
    </div>
  {/if}

  {#if log.error_msg && !retryingPaths.has(log.file_path) && log.status !== "Skipped"}
    <div class="error-msg-row">
      {#if log.status === "On Hold"}
        <span class="onhold-reason"><i class="fa-solid fa-pause" style="margin-right: 5px;"></i>{log.error_msg}</span>
      {:else}
        <span class="error-text">{log.status === "Duplicate" ? "⧖" : "❌"} {log.error_msg}</span>
      {/if}
    </div>
  {/if}

  {#if log.status === "Failed" && log.diagnostics && showTroubleshoot[log.file_path]}
    {@const d = log.diagnostics}
    {@const catClass = (d.cause_category === "locked" || d.cause_category === "corrupt") ? "cat-bad"
      : d.cause_category === "server" ? "cat-server"
      : d.cause_category === "duplicate" ? "cat-dup"
      : "cat-unknown"}
    {@const catLabel = d.cause_category === "locked" ? "FILE LOCKED"
      : d.cause_category === "corrupt" ? "CORRUPT"
      : d.cause_category === "server" ? "SERVER"
      : d.cause_category === "duplicate" ? "DUPLICATE"
      : "UNKNOWN"}
    <div class="diagnostics-panel" style="margin-top: 10px; background: rgba(15, 15, 25, 0.6); border: 1px solid rgba(255,255,255,0.06); padding: 14px; border-radius: 6px; font-family: monospace; font-size: 11px;">
      <div style="font-weight: 700; color: #a78bfa; margin-bottom: 8px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
        <span style="display:flex; align-items:center; gap:8px;">
          <span class="cause-pill {catClass}">{catLabel}</span>
          DIAGNOSTIC ANALYSIS
        </span>
        <div style="display: flex; gap: 6px;">
          <button class="action-btn" style="padding: 2px 8px; font-size: 10px;" onclick={() => openLogInExplorer(log)} title="Open the log file in Explorer">
            📂 Open
          </button>
          <button class="action-btn" style="padding: 2px 8px; font-size: 10px;" onclick={() => copyDiagnostics(log)}>
            {copiedDiagPath === log.file_path ? "✓ Copied!" : "📋 Copy"}
          </button>
          <button class="action-btn" style="padding: 2px 8px; font-size: 10px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399;" onclick={() => saveDiagnosticsToFile(log)}>
            {savedDiagPath === log.file_path ? "✓ Saved to Desktop!" : "💾 Save as .txt"}
          </button>
        </div>
      </div>
      {#if d.concurrent_uploaders && d.concurrent_uploaders.length > 0}
        <div style="margin-bottom: 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); color: #f87171; padding: 8px; border-radius: 4px; font-size: 10px; line-height: 1.4;">
          ⚠️ <strong>File Access Lock:</strong> The log file is currently locked/opened by: <strong>{d.concurrent_uploaders.join(", ")}</strong>. This lock prevents other applications from cleanly reading and uploading the file.
        </div>
      {/if}
      <div style="display: grid; grid-template-columns: 140px 1fr; gap: 4px 12px; color: #e2e8f0; line-height: 1.4;">
        <span style="color: #64748b;">File Name:</span>
        <span style="word-break: break-all;">{d.file_name}</span>
        <span style="color: #64748b;">File Size:</span>
        <span>{(d.file_size / 1024).toFixed(2)} KB ({d.file_size} bytes)</span>
        <span style="color: #64748b;">Format:</span>
        <span>{d.is_zevtc ? "ZEVTC (Compressed)" : "EVTC (Raw)"}</span>
        <span style="color: #64748b;">Header Magic:</span>
        <span style={d.header_valid ? "color: #10b981;" : "color: #ef4444;"}>{d.header_valid ? "Valid (EVTC)" : `Invalid (Magic: ${d.magic_bytes})`}</span>
        <span style="color: #64748b;">Revision:</span>
        <span>{d.revision}</span>
        <span style="color: #64748b;">Local Agent Count:</span>
        <span>{d.agent_count !== null ? d.agent_count : "Failed to parse"}</span>
        <span style="color: #64748b;">Local Parser:</span>
        <span style={d.parse_players_error ? "color: #ef4444;" : "color: #10b981;"}>{d.parse_players_error ? `Failed (${d.parse_players_error})` : "Success"}</span>
        <span style="color: #64748b;">Server Response:</span>
        <span>{d.upload_response_status !== null ? `HTTP ${d.upload_response_status}` : "No response"}</span>
        <span style="color: #64748b; font-weight: bold;">Likely Cause:</span>
        <span style="color: #fca5a5; font-weight: bold; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px;">{d.likely_cause || "Unknown"}</span>
        <span style="color: #64748b; font-weight: bold; align-self: start;">What to do:</span>
        <span style="color: #cbd5e1; background: rgba(99,102,241,0.08); border-left: 2px solid rgba(139,92,246,0.5); padding: 4px 8px; border-radius: 4px;">{d.remediation || "No guidance available."}</span>
      </div>
      {#if d.upload_response_body}
        <div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px;">
          <div style="color: #64748b; margin-bottom: 4px;">Server Error Payload:</div>
          <pre style="margin: 0; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 4px; overflow-x: auto; color: #cbd5e1; max-height: 80px; font-size: 10px;">{d.upload_response_body}</pre>
        </div>
      {/if}
    </div>
  {/if}
</div>
{/snippet}

{#snippet recordsListRenderer(groupedLogs: any, subFolderIdParam: any, sessionParam: any)}
<div class="records-list">
  {#each groupedLogs as item}
    {#if item.kind === "wing"}
      {@const wingLogs: UploadRecord[] = item.bossBuckets.flatMap((b: { logs: UploadRecord[] }) => b.logs)}
      {@const isCollapsed = modalWingCollapsed[item.wingIdx] !== false}
      {@const wingAllSelected = isWingFullySelected(wingLogs)}
      {@const wingDuration = wingLogs.reduce((sum: number, l: UploadRecord) => sum + (l.duration ?? 0), 0)}
      <div class="wing-block" style="background: rgba(255, 255, 255, 0.01); border: 1px solid rgba(255,255,255,0.03); margin-bottom: 12px; border-radius: 8px; position: relative;">
        <div class="wing-header">
          <input type="checkbox" class="log-select-check" checked={wingAllSelected} onclick={(e) => { e.stopPropagation(); toggleSelectWing(wingLogs); }} />
          <button class="wing-title-btn" onclick={() => toggleModalWingCollapsed(item.wingIdx)}>
            <span class="wing-chevron" class:open={!isCollapsed}>›</span>
            <span class="wing-name">{item.wingName}</span>
            <span class="wing-count">{wingLogs.length} log{wingLogs.length > 1 ? 's' : ''}</span>
            {#if wingDuration > 0}
              <span class="wing-count" style="margin-left: 6px;">⏱️ {formatTotalTime(wingDuration)}</span>
            {/if}
          </button>
          
          <button class="action-btn" onclick={(e) => { e.stopPropagation(); openMoveGroupPicker(wingLogs, subFolderIdParam, (target) => moveGroupLogsToSubFolder(sessionParam.id, wingLogs, target)); }}>
            <i class="fa-solid fa-folder-open" style="margin-right: 4px;"></i> Move Logs
          </button>
            <button class="action-btn btn-delete" title="Remove all logs in this group" onclick={() => openConfirm(`Remove "${item.wingName}"?`, `Remove all ${wingLogs.length} log(s) in this group from ${subFolderIdParam != null ? "this subfolder" : "this folder"}?`, () => { if (subFolderIdParam != null) removeGroupFromSubFolder(sessionParam.id, subFolderIdParam, wingLogs); else removeGroupFromSession(sessionParam.id, wingLogs); })}>
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        {#if !isCollapsed}
          <div class="wing-body" transition:slide={{ duration: prefersReducedMotion ? 0 : 200 }}>
            {#each item.bossBuckets as bucket}
              <div class="wing-boss-label">{bucket.bossName}</div>
              {#each bucket.logs as log (log.file_path)}
                {@const id = cardId(log)}
                {@const isExpanded = !!expanded[id]}
                {@const isSelected = selectedLogs.has(log.file_path)}
                <div class="log-card card {isExpanded ? 'is-expanded' : ''}" class:menu-open={activeMenuCard === id} style="margin-bottom: 12px; position: relative; cursor: context-menu;" role="button" tabindex="0" oncontextmenu={(e) => handleLogContextMenu(e, log, true, sessionParam.id, () => { if (subFolderIdParam != null) fadeRemoveFromSubFolder(sessionParam.id, subFolderIdParam, log.file_path); else fadeRemoveFromSession(sessionParam.id, log.file_path); })}>
                  <button class="log-header" onclick={() => toggleExpand(id)}>
                    <input type="checkbox" class="log-select-check" checked={isSelected} onclick={(e) => { e.stopPropagation(); toggleSelectLog(log.file_path); }} />
                    {@render logHeaderLeft(log)}
                    <div class="log-right">
                      <span class="chevron" class:open={isExpanded}>›</span>
                    </div>
                  </button>
                  
                  {@render logFooter(log, () => { if (subFolderIdParam != null) fadeRemoveFromSubFolder(sessionParam.id, subFolderIdParam, log.file_path); else fadeRemoveFromSession(sessionParam.id, log.file_path); })}

                  {#if isExpanded}
                    {@const groups = log.players ? groupBySubgroup(log.players) : {}}
                    {@const subgroupNums = log.players ? sortedSubgroups(log.players) : []}
                    <div class="squad-section" style="background: rgba(0,0,0,0.15);">
                      <div class="squad-title">Squad Composition</div>
                      {#if !log.players || log.players.length === 0}
                        <p class="no-players">No player data available for this log.</p>
                      {:else}
                        <div class="subgroups-grid">
                          {#each subgroupNums as sgNum}
                            <div class="subgroup-col">
                              <div class="subgroup-label">Sub {sgNum}</div>
                              {#each groups[sgNum] as player}
                                <div class="player-row">
                                  <div class="prof-badge" class:img-loaded={playerIconsLoaded[player.display_name]} style="background-color: {getProfColor(player.profession)};" title="{getSpecName(player)}">
                        <img src={getProfIcon(player)} alt="" class="prof-icon-img" onload={() => { playerIconsLoaded[player.display_name] = true; }} onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                    <span class="prof-abbr-fallback">{getSpecAbbr(player)}</span>
                                  </div>
                                  <div class="player-info">
                                    <span class="player-name">{#if isCommander(player)}<span class="commander-crown" title="Tank / Commander">👑</span>{/if}{player.display_name}</span>
                                    <span class="player-spec">{player.account}</span>
                                  </div>
                                  {#if player.role}<span class="role-chip role-{player.role.toLowerCase()}">{player.role}</span>{/if}
                                </div>
                              {/each}
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            {/each}
          </div>
        {/if}
      </div>
    {:else if item.kind === "group"}
      {@const catLogs = item.logs}
      {@const isCollapsed = modalCategoryCollapsed[item.bossName] !== false}
      {@const catAllSelected = isWingFullySelected(catLogs)}
      {@const catDuration = catLogs.reduce((sum: number, l: UploadRecord) => sum + (l.duration ?? 0), 0)}
      <div class="wing-block category-block" class:fractal-block={item.kind === 'group' && item.logs.some((l: UploadRecord) => getEncounterType(l.boss_name, l.num_players, l.is_convergence) === 'fractal')} style="background: rgba(255, 255, 255, 0.01); border: 1px solid rgba(255,255,255,0.03); margin-bottom: 12px; border-radius: 8px; position: relative;">
        <div class="wing-header">
          <input type="checkbox" class="log-select-check" checked={catAllSelected} onclick={(e) => { e.stopPropagation(); toggleSelectWing(catLogs); }} />
          <button class="wing-title-btn" onclick={() => toggleModalCategoryCollapsed(item.bossName)}>
            <span class="wing-chevron" class:open={!isCollapsed}>›</span>
            <span class="wing-name">{item.bossName}</span>
            <span class="wing-count">{catLogs.length} log{catLogs.length > 1 ? 's' : ''}</span>
            {#if catDuration > 0}
              <span class="wing-count" style="margin-left: 6px;">⏱️ {formatTotalTime(catDuration)}</span>
            {/if}
          </button>
          
          <div style="position: relative; margin-left: auto;">
            <button class="action-btn" onclick={(e) => { e.stopPropagation(); openMoveGroupPicker(catLogs, subFolderIdParam, (target) => moveGroupLogsToSubFolder(sessionParam.id, catLogs, target)); }}>
              <i class="fa-solid fa-folder-open" style="margin-right: 4px;"></i> Move Logs
            </button>
            <button class="action-btn btn-delete" title="Remove all logs in this group" onclick={() => openConfirm(`Remove "${item.bossName}"?`, `Remove all ${catLogs.length} log(s) in this group from ${subFolderIdParam != null ? "this subfolder" : "this folder"}?`, () => { if (subFolderIdParam != null) removeGroupFromSubFolder(sessionParam.id, subFolderIdParam, catLogs); else removeGroupFromSession(sessionParam.id, catLogs); })}>
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>

        {#if !isCollapsed}
          <div class="wing-body" transition:slide={{ duration: prefersReducedMotion ? 0 : 200 }}>
            {#each item.bossBuckets as bucket}
              <div class="wing-boss-label">{bucket.bossName}</div>
            {#each bucket.logs as log (log.file_path)}
                {@const id = cardId(log)}
                {@const isExpanded = !!expanded[id]}
                {@const isSelected = selectedLogs.has(log.file_path)}
                <div class="log-card card {isExpanded ? 'is-expanded' : ''}" class:menu-open={activeMenuCard === id} style="margin-bottom: 12px; position: relative; cursor: context-menu;" role="button" tabindex="0" oncontextmenu={(e) => handleLogContextMenu(e, log, true, sessionParam.id, () => { if (subFolderIdParam != null) fadeRemoveFromSubFolder(sessionParam.id, subFolderIdParam, log.file_path); else fadeRemoveFromSession(sessionParam.id, log.file_path); })}>
                  <button class="log-header" onclick={() => toggleExpand(id)}>
                    <input type="checkbox" class="log-select-check" checked={isSelected} onclick={(e) => { e.stopPropagation(); toggleSelectLog(log.file_path); }} />
                    {@render logHeaderLeft(log)}
                    <div class="log-right">
                      <span class="chevron" class:open={isExpanded}>›</span>
                    </div>
                  </button>
                  
                  {@render logFooter(log, () => { if (subFolderIdParam != null) fadeRemoveFromSubFolder(sessionParam.id, subFolderIdParam, log.file_path); else fadeRemoveFromSession(sessionParam.id, log.file_path); })}

                  {#if isExpanded}
                    {@const groups = log.players ? groupBySubgroup(log.players) : {}}
                    {@const subgroupNums = log.players ? sortedSubgroups(log.players) : []}
                    <div class="squad-section" style="background: rgba(0,0,0,0.15);">
                      <div class="squad-title">Squad Composition</div>
                      {#if !log.players || log.players.length === 0}
                        <p class="no-players">No player data available for this log.</p>
                      {:else}
                        <div class="subgroups-grid">
                          {#each subgroupNums as sgNum}
                            <div class="subgroup-col">
                              <div class="subgroup-label">Sub {sgNum}</div>
                              {#each groups[sgNum] as player}
                                <div class="player-row">
                                  <div class="prof-badge" class:img-loaded={playerIconsLoaded[player.display_name]} style="background-color: {getProfColor(player.profession)};" title="{getSpecName(player)}">
                                    <img src={getProfIcon(player)} alt="" class="prof-icon-img" onload={() => { playerIconsLoaded[player.display_name] = true; }} onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                    <span class="prof-abbr-fallback">{getSpecAbbr(player)}</span>
                                  </div>
                                  <div class="player-info">
                                    <span class="player-name">{#if isCommander(player)}<span class="commander-crown" title="Tank / Commander">👑</span>{/if}{player.display_name}</span>
                                    <span class="player-spec">{player.account}</span>
                                  </div>
                                  {#if player.role}<span class="role-chip role-{player.role.toLowerCase()}">{player.role}</span>{/if}
                                </div>
                              {/each}
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
{/snippet}

<main class="app-container" class:sidebar-collapsed={!sidebarOpen}>
  <!-- ─── In-body titlebar strip (Option A: native OS decorations kept) ─── -->
  <div class="app-titlebar" data-tauri-drag-region>
    <!-- Toggle responds on pointerdown for instant visual feedback -->
    <button
      class="sidebar-toggle-btn"
      data-tauri-drag-region="false"
      onpointerdown={(e) => { e.preventDefault(); sidebarOpen = !sidebarOpen; }}
      title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
    >
      <i class="fa-solid {sidebarOpen ? 'fa-angles-left' : 'fa-angles-right'}"></i>
    </button>

    <!-- Tab pills — slide in from left when sidebar is collapsed -->
    <nav class="titlebar-tabs" aria-label="Main navigation" data-tauri-drag-region="false">
      <button class="tb-tab {activeTab === 'feed' ? 'active' : ''}" onclick={() => activeTab = 'feed'}>
        <i class="fa-solid fa-cloud-arrow-up"></i><span>Uploads</span>
      </button>
      <button class="tb-tab {activeTab === 'folders' ? 'active' : ''}" onclick={() => { activeSessionId = null; activeTab = 'folders'; }}>
        <i class="fa-solid fa-folder"></i><span>Folders</span>
      </button>
      <button class="tb-tab {activeTab === 'tracker' ? 'active' : ''}" onclick={() => activeTab = 'tracker'}>
        <i class="fa-solid fa-list-check"></i><span>Clears</span>
      </button>
      <button class="tb-tab {activeTab === 'analytics' ? 'active' : ''}" onclick={() => { activeTab = 'analytics'; loadFullHistory(); }}>
        <i class="fa-solid fa-chart-line"></i><span>Analytics</span>
      </button>
      <button class="tb-tab {activeTab === 'history' ? 'active' : ''}" onclick={() => { activeTab = 'history'; historyPage = 0; loadFullHistory(); }}>
        <i class="fa-solid fa-clock-rotate-left"></i><span>History</span>
      </button>
      {#if SHOW_SQUAD_PLANNER}
      <button class="tb-tab {activeTab === 'squad' ? 'active' : ''}" onclick={() => activeTab = 'squad'}>
        <i class="fa-solid fa-users"></i><span>Planner</span>
      </button>
      {/if}
      <button class="tb-tab {activeTab === 'settings' ? 'active' : ''}" onclick={() => activeTab = 'settings'}>
        <i class="fa-solid fa-gear"></i><span>Settings</span>
      </button>
    </nav>

    <!-- Center wordmark — fades out when tab pills are showing -->
    <div class="titlebar-wordmark" class:hidden={!sidebarOpen} data-tauri-drag-region aria-hidden="true">
      Portal Protocol <span class="titlebar-version">v{appVersion}</span>
    </div>
  </div>
  <!-- Connectivity / status pill: fixed overlay, never in layout flow (cannot displace sidebar) -->
  {#if !isOnline}
    <div class="pp-status-pill pp-status-offline" role="status" aria-live="polite">
      <span class="pp-status-dot"></span>
      <span>Offline Mode · Uploads Paused</span>
    </div>
  {/if}

  {#if toastMsg}
    <div class="pp-status-pill" class:pp-status-online={toastType === "online"} class:pp-status-offline={toastType === "offline"} class:pp-status-success={toastType === "success"} role="status" aria-live="polite" transition:fade={{ duration: prefersReducedMotion ? 0 : 220 }}>
      <span class="pp-status-dot"></span>
      <span class="pp-status-icon">{toastIcon}</span>
      <span>{toastMsg}</span>
    </div>
  {/if}

  {#if updateAvailable}
    <div class="app-toast app-update-banner">
      <span class="app-toast-icon"><i class="fa-solid fa-arrow-up-from-bracket"></i></span>
      <span>Update {updateAvailable.version} ready</span>
      <button class="app-update-btn" onclick={() => applyUpdate()} disabled={updateModalOpen}>
        {updateDownloaded ? "Restart to apply" : "Click to Download"}
      </button>
    </div>
  {/if}

  {#if dpsReportStatus === "offline"}
    <div class="app-toast app-dps-down-banner" role="status" aria-live="polite">
      <span class="app-toast-icon"><i class="fa-solid fa-triangle-exclamation"></i></span>
      {#if bDpsReportStatus === "online" && use_backup_dps}
        <span>dps.report is unreachable — uploads are auto-routing to <strong>b.dps.report</strong> until it recovers.</span>
      {:else}
        <span>dps.report is unreachable — uploads are paused and will resume automatically when it comes back.</span>
      {/if}
    </div>
  {/if}

  {#if updateModalOpen}
    <div class="update-overlay" transition:fade={{ duration: prefersReducedMotion ? 0 : 160 }}>
      <div class="update-modal" transition:scale={{ duration: prefersReducedMotion ? 0 : 200, start: 0.92 }}>
        <div class="update-icon"><i class="fa-solid fa-arrow-up-from-bracket"></i></div>
        <h3 class="update-title">Updating to v{updateAvailable?.version ?? ""}</h3>
        <p class="update-sub">{downloadLabel}</p>
        <div class="update-bar" class:indeterminate={downloadPct === -1}>
          {#if downloadPct === -1}
            <div class="update-bar-fill indeterminate"></div>
          {:else}
            <div class="update-bar-fill" style="width: {downloadPct}%"></div>
          {/if}
        </div>
        {#if downloadPct > 0 && downloadPct < 100}
          <div class="update-pct">{downloadPct}%</div>
        {/if}
        <div class="update-steps">
          <span class="update-step" class:active={updatePhase === "downloading"} class:done={updatePhase !== "downloading"}>Download</span>
          <span class="update-step" class:active={updatePhase === "installing" || updatePhase === "ready"} class:done={updatePhase === "restarting"}>Install</span>
          <span class="update-step" class:active={updatePhase === "restarting"}>Restart</span>
        </div>
        {#if updatePhase === "ready"}
          <button class="update-install-btn" onclick={() => installUpdate()}>Install &amp; Restart</button>
        {/if}
      </div>
    </div>
  {/if}

  <aside class="sidebar">
    <div class="brand">
      <img class="logo-img" src="/app-icon.png" alt="Portal Logo"/>
      <div class="brand-text">
        <h2>Portal Protocol</h2>
        <span>dps.report Log Uploader</span>
      </div>
    </div>
    <nav class="nav-links" bind:this={navLinksEl}>
      <span class="nav-tab-indicator" class:visible={tabIndicator.visible} style="left: {tabIndicator.left}px; top: {tabIndicator.top}px; width: {tabIndicator.width}px; height: {tabIndicator.height}px;"></span>
      <button class="nav-btn {activeTab === 'feed' ? 'active' : ''}" onclick={() => activeTab = "feed"}>
        <span class="nav-icon"><i class="fa-solid fa-cloud-arrow-up"></i></span> Uploads Feed
      </button>
      <button class="nav-btn {activeTab === 'folders' ? 'active' : ''}" onclick={() => { activeSessionId = null; activeTab = "folders"; }}>
        <span class="nav-icon"><i class="fa-solid fa-folder"></i></span> Folders
      </button>
      <button class="nav-btn {activeTab === 'tracker' ? 'active' : ''}" onclick={() => activeTab = "tracker"}>
        <span class="nav-icon"><i class="fa-solid fa-list-check"></i></span> Clears
      </button>
      <button class="nav-btn {activeTab === 'analytics' ? 'active' : ''}" onclick={() => { activeTab = "analytics"; loadFullHistory(); }}>
        <span class="nav-icon"><i class="fa-solid fa-chart-line"></i></span> Analytics
      </button>
      <button class="nav-btn {activeTab === 'history' ? 'active' : ''}" onclick={() => { activeTab = "history"; historyPage = 0; loadFullHistory(); }}>
        <span class="nav-icon"><i class="fa-solid fa-clock-rotate-left"></i></span> History Log
      </button>
      {#if SHOW_SQUAD_PLANNER}
      <button class="nav-btn {activeTab === 'squad' ? 'active' : ''}" onclick={() => activeTab = "squad"}>
        <span class="nav-icon"><i class="fa-solid fa-users"></i></span> Squad Planner
      </button>
      {/if}
    </nav>
    <div class="sidebar-section-divider"></div>
      <div class="sidebar-footer" style="margin-top: auto; display: flex; flex-direction: column; gap: 16px;">
      <nav class="nav-links" style="gap: 0;" bind:this={footerNavEl}>
        <span class="nav-tab-indicator" class:visible={footerIndicator.visible} style="left: {footerIndicator.left}px; top: {footerIndicator.top}px; width: {footerIndicator.width}px; height: {footerIndicator.height}px;"></span>
        <button class="nav-btn {activeTab === 'settings' ? 'active' : ''}" onclick={() => activeTab = "settings"}>
          <span class="nav-icon"><i class="fa-solid fa-gear"></i></span> Settings
        </button>
      </nav>
      <div class="quick-links-section" style="border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 8px; margin-top: 0px;">
          <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 700; margin-bottom: 6px;">Quick Links</div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <button class="sidebar-quick-link" onclick={() => openExternalUrl('https://dps.report')}>
              <img src="/dpsreport_icon.png" alt="dps.report" /> Visit dps.report
            </button>
            <button class="sidebar-quick-link" onclick={() => openExternalUrl('https://gw2wingman.nevermindcreations.de/rev/dashboard')}>
              <img src="/wingman_icon.png" alt="Wingman" /> Wingman Dashboard
            </button>
          </div>
        </div>
    </div>
  </aside>

  <section class="content-area">
    {#if eiRuntimeNotice}
      <div style="display:flex; align-items:center; gap:10px; padding:9px 12px; margin-bottom:10px; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.4); border-radius:8px; font-size:12px; color:rgba(255,255,255,0.9);">
        <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b; font-size:14px;"></i>
        <span style="flex:1;">
          Local combat-log parsing (Elite Insights) needs the free <strong>.NET 8 Desktop Runtime</strong>. Without it, logs still upload but use dps.report instead of full local parsing.
        </span>
        <a href={eiRuntimeNotice.url} target="_blank" rel="noopener noreferrer" style="color:#fbbf24; font-weight:700; text-decoration:none; white-space:nowrap;">Get .NET 8 ↗</a>
        <button type="button" onclick={dismissEiNotice} aria-label="Dismiss notice" style="background:none; border:none; color:rgba(255,255,255,0.6); font-size:16px; line-height:1; cursor:pointer; padding:0 2px;">×</button>
      </div>
    {/if}
    {#if activeTab === "feed"}
      <div style="display: flex; flex-direction: column; gap: inherit; min-height: 100%;" in:fly={{ y: 6, duration: prefersReducedMotion ? 0 : 200 }} out:fade={{ duration: prefersReducedMotion ? 0 : 150 }}>
        <div class="feed-header-row">
        <div>
          <h2 class="feed-title">Uploads Feed</h2>
          <p class="feed-subtitle">Drag .evtc/.zevtc files here or configure a watch folder in Settings</p>
        </div>
        <FilterBar
          {filters}
          bosses={distinctBossOptions(uploads)}
          vlRanks={vlCatalog.flatMap(e => e.ranks.map(r => ({ id: r.id, label: r.label, icon: r.icon })))}
          professions={PROFESSION_OPTIONS}
          professionGroups={PROFESSION_GROUPS}
          showCounts={true}
          resultCount={filteredUploads.length}
          totalCount={uploads.filter(u => !deletedPaths.has(u.file_path)).length}
        />
        <div style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <button class="action-btn btn-delete" onclick={() => copyAllLinks(filteredUploads)} title="Copy every uploaded link in this view">
            <i class="fa-solid fa-copy" style="margin-right: 4px;"></i> Copy All Links
          </button>
          {#if uploads.length > 0}
            <button class="action-btn btn-delete" style="margin-left: 8px;" onclick={() => openConfirm(
              "Clear Uploads Feed",
              "Remove all logs from the Uploads Feed view? They stay in Uploads History and can be re-added.",
              () => { uploads = []; persistFeed(); }
            )} title="Empty the Feed view (logs remain in History)">
              <i class="fa-solid fa-broom" style="margin-right: 4px;"></i> Clear Feed
            </button>
          {/if}
          {#if !captureSession}
            <button class="action-btn session-start" onclick={startCaptureSession} title="Start a Capture Session — new logs get collected for filing">
              <i class="fa-solid fa-circle-dot" style="margin-right: 4px;"></i> Start Session
            </button>
          {:else}
            <div class="session-pill" class:paused={captureSession.state === "paused"}>
              <span class="session-shimmer"></span>
              <i class="fa-solid {captureSession.state === 'paused' ? 'fa-pause' : 'fa-record-vinyl'}"></i>
              <span class="session-name">{captureSession.name}</span>
              <span class="session-count">{captureSession.logPaths.length}</span>
            </div>
            {#if captureSession.state === "collecting"}
              <button class="action-btn session-pause" onclick={pauseCaptureSession} title="Pause collecting (new logs won't be tagged)">
                <i class="fa-solid fa-pause" style="margin-right: 4px;"></i> Pause
              </button>
            {:else}
              <button class="action-btn session-resume" onclick={resumeCaptureSession} title="Resume collecting">
                <i class="fa-solid fa-play" style="margin-right: 4px;"></i> Resume
              </button>
            {/if}
            <button class="action-btn session-end" onclick={endCaptureSession} title="File collected logs into a Folder">
              <i class="fa-solid fa-folder-plus" style="margin-right: 4px;"></i> End Session
            </button>
          {/if}
        </div>
      </div>

      <div class="manual-bar-inline">
        <span class="manual-bar-label"><i class="fa-solid fa-file-arrow-up"></i> Queue Log</span>
        <div class="manual-bar-input-row">
          <input
            class="manual-bar-input"
            type="text"
            placeholder="Absolute path to .evtc or .zevtc file…"
            bind:value={manualFilePath}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                const fp = manualFilePath.trim();
                const lower = fp.toLowerCase();
                if (!fp || !(lower.endsWith('.evtc') || lower.endsWith('.zevtc'))) { showToast('Enter a valid .evtc or .zevtc file path.'); return; }
                queueFile(fp);
              }
            }}
          />
          <button class="manual-bar-btn" onclick={() => {
            const fp = manualFilePath.trim();
            const lower = fp.toLowerCase();
            if (!fp || !(lower.endsWith('.evtc') || lower.endsWith('.zevtc'))) { showToast('Enter a valid .evtc or .zevtc file path.'); return; }
            queueFile(fp);
          }} title="Queue this log for upload"><i class="fa-solid fa-upload"></i> Upload</button>
          <button class="manual-bar-browse" onclick={(e) => { e.stopPropagation(); triggerFolderUpload(); }} title="Browse for .evtc / .zevtc files"><i class="fa-solid fa-folder-open"></i></button>
        </div>
      </div>

      {#if selectedLogs.size > 0}
        <div class="copy-toolbar" style="position: sticky; top: 0; z-index: 10; margin: 0 0 16px 0; border: 1px solid rgba(99, 102, 241, 0.25); background: rgba(15, 16, 28, 0.95); backdrop-filter: blur(8px);">
          <span class="copy-count">{selectedLogs.size} log{selectedLogs.size > 1 ? 's' : ''} selected</span>
          <button class="btn btn-copy" onclick={() => copySelectedLinks(filteredUploads)} title="Copy links for the selected logs">
            <i class="fa-solid fa-copy" style="margin-right: 4px;"></i> Copy Selected Links
          </button>
          <button class="btn btn-move" onclick={() => moveSelectedToFolder(filteredUploads)} title="Save selected logs into a Folder">
            <i class="fa-solid fa-folder-plus" style="margin-right: 4px;"></i> Move to Folder
          </button>
          <button class="btn btn-discord" onclick={() => showFormatterPanel = !showFormatterPanel}>
            <i class="fa-solid fa-wand-magic-sparkles" style="margin-right: 4px;"></i> Log Formatter
          </button>
          <button class="btn btn-clear" onclick={() => { selectedLogs = new Set(); showFormatterPanel = false; }}>
            <i class="fa-solid fa-xmark" style="margin-right: 4px;"></i> Close
          </button>
        </div>
      {/if}

      <div style="display: flex; gap: 20px; align-items: flex-start; width: 100%;">
        <div style="flex: {showFormatterPanel ? '0 0 65%' : '1 1 100%'}; min-width: 0;">
          {#if filteredUploads.length === 0}
            <div class="empty-state">
              <span class="empty-icon"><i class="fa-solid fa-folder-open"></i></span>
              <h3>No logs match the current filters</h3>
              <p>Try clearing your active filters or drag a new log onto the window.</p>
            </div>
          {:else}
            <div class="records-list">
              {#each groupedFeed as item}
                {#if item.kind === "wing"}
                  {@const wingLogs: UploadRecord[] = item.bossBuckets.flatMap((b: { logs: UploadRecord[] }) => b.logs)}
                  {@const isCollapsed = wingCollapsed[item.wingIdx] !== false}
                  {@const wingAllSelected = isWingFullySelected(wingLogs)}
                  {@const wingDuration = wingLogs.reduce((sum: number, l: UploadRecord) => sum + (l.duration ?? 0), 0)}
                  <div class="wing-block">
                    <div class="wing-header">
                      <input type="checkbox" class="log-select-check" checked={wingAllSelected} onclick={(e) => { e.stopPropagation(); toggleSelectWing(wingLogs); }} title="Select all logs in this wing" />
                      <button class="wing-title-btn" onclick={() => wingCollapsed[item.wingIdx] = !isCollapsed}>
                        <span class="wing-chevron" class:open={!isCollapsed}>›</span>
                        <span class="wing-name">{item.wingName}</span>
                        <span class="wing-count">{wingLogs.length} log{wingLogs.length > 1 ? 's' : ''}</span>
                        {#if wingDuration > 0}
                          <span class="wing-count" style="margin-left: 6px;">⏱️ {formatTotalTime(wingDuration)}</span>
                        {/if}
                      </button>
                        <button class="btn-remove-wing" title="Remove all logs in this group" onclick={() => openConfirm(`Remove "${item.wingName}"?`, `Remove all ${wingLogs.length} log(s) in this group from the Uploads Feed view? They stay in Uploads History.`, () => deleteLogGroup(wingLogs.map((l) => l.file_path)))}>
                          <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>

                    {#if !isCollapsed}
                      <div class="wing-body" transition:slide={{ duration: prefersReducedMotion ? 0 : 200 }}>
                        {#each item.bossBuckets as bucket}
                          <div class="wing-boss-label">{bucket.bossName}</div>
                          {#each bucket.logs as log (log.file_path)}
                            {@const id = cardId(log)}
                            {@const isExpanded = !!expanded[id]}
                            {@const isSelected = selectedLogs.has(log.file_path)}
                            {@const isCaptured = !!captureSession && captureSession.logPaths.includes(log.file_path)}
                            <div class="log-card card" class:menu-open={activeMenuCard === id} class:is-expanded={isExpanded} class:uploading={log.status === "Uploading"} class:is-selected={isSelected} class:deleting={deletingLogPaths.has(log.file_path)} class:session-captured={isCaptured} style="position: relative; cursor: context-menu;" oncontextmenu={(e) => handleLogContextMenu(e, log, false)} role="button" tabindex="0">
                              {#if log.status === "Uploading"}
                                <div class="upload-progress-top"></div>
                              {/if}
                              <button class="log-header" onclick={() => toggleExpand(id)}>
                                <input type="checkbox" class="log-select-check" checked={isSelected} onclick={(e) => { e.stopPropagation(); toggleSelectLog(log.file_path); }} />
                                {@render logHeaderLeft(log)}
                                <div class="log-right">
                                  <span class="chevron" class:open={isExpanded}>›</span>
                                </div>
                              </button>
                              {@render logFooter(log, () => deleteLogRecord(log.file_path))}
                              {#if isExpanded}
                                {@const groups = log.players ? groupBySubgroup(log.players) : {}}
                                {@const subgroupNums = log.players ? sortedSubgroups(log.players) : []}
                                <div class="squad-section">
                                  <div class="squad-title">Squad Composition</div>
                                  {#if !log.players || log.players.length === 0}
                                    <p class="no-players">No player data available for this log.</p>
                                  {:else}
                                    <div class="subgroups-grid">
                                      {#each subgroupNums as sgNum}
                                        <div class="subgroup-col">
                                          <div class="subgroup-label">Sub {sgNum}</div>
                                          {#each groups[sgNum] as player}
                                            <div class="player-row">
                                  <div class="prof-badge" class:img-loaded={playerIconsLoaded[player.display_name]} style="background-color: {getProfColor(player.profession)};" title="{getSpecName(player)}">
                                    <img src={getProfIcon(player)} alt="" class="prof-icon-img" onload={() => { playerIconsLoaded[player.display_name] = true; }} onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                                <span class="prof-abbr-fallback">{getSpecAbbr(player)}</span>
                                              </div>
                                              <div class="player-info">
                                                <span class="player-name">{#if isCommander(player)}<span class="commander-crown" title="Tank / Commander">👑</span>{/if}{player.display_name}</span>
                                                <span class="player-spec">{player.account}</span>
                                              </div>
                                              {#if player.role}<span class="role-chip role-{player.role.toLowerCase()}">{player.role}</span>{/if}
                                            </div>
                                          {/each}
                                        </div>
                                      {/each}
                                    </div>
                                  {/if}
                                </div>
                              {/if}
                            </div>
                          {/each}
                        {/each}
                      </div>
                    {/if}
                  </div>
                {:else if item.kind === "group"}
                  {@const catLogs = item.logs}
                  {@const isCollapsed = categoryCollapsed[item.bossName] !== false}
                  {@const catAllSelected = isWingFullySelected(catLogs)}
                  {@const catDuration = catLogs.reduce((sum: number, l: UploadRecord) => sum + (l.duration ?? 0), 0)}
                  <div class="wing-block category-block" class:fractal-block={item.kind === 'group' && item.logs.some((l: UploadRecord) => getEncounterType(l.boss_name, l.num_players, l.is_convergence) === 'fractal')}>
                    <div class="wing-header">
                      <input type="checkbox" class="log-select-check" checked={catAllSelected} onclick={(e) => { e.stopPropagation(); toggleSelectWing(catLogs); }} title="Select all logs in this category" />
                      <button class="wing-title-btn" onclick={() => categoryCollapsed[item.bossName] = !isCollapsed}>
                        <span class="wing-chevron" class:open={!isCollapsed}>›</span>
                        <span class="wing-name">{item.bossName}</span>
                        <span class="wing-count">{catLogs.length} log{catLogs.length > 1 ? 's' : ''}</span>
                        {#if catDuration > 0}
                          <span class="wing-count" style="margin-left: 6px;">⏱️ {formatTotalTime(catDuration)}</span>
                        {/if}
                      </button>
                        <button class="btn-remove-wing" title="Remove all logs in this group" onclick={() => openConfirm(`Remove "${item.bossName}"?`, `Remove all ${catLogs.length} log(s) in this group from the Uploads Feed view? They stay in Uploads History.`, () => deleteLogGroup(catLogs.map((l) => l.file_path)))}>
                          <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>

                    {#if !isCollapsed}
                      <div class="wing-body" transition:slide={{ duration: prefersReducedMotion ? 0 : 200 }}>
                        {#each item.bossBuckets as bucket}
                          <div class="wing-boss-label">{bucket.bossName}</div>
                        {#each bucket.logs as log (log.file_path)}
                          {@const id = cardId(log)}
                          {@const isExpanded = !!expanded[id]}
                          {@const isSelected = selectedLogs.has(log.file_path)}
                          <div class="log-card card" class:menu-open={activeMenuCard === id} class:is-expanded={isExpanded} class:uploading={log.status === "Uploading"} class:is-selected={isSelected} class:deleting={deletingLogPaths.has(log.file_path)} style="position: relative; cursor: context-menu;" oncontextmenu={(e) => handleLogContextMenu(e, log, false)} role="button" tabindex="0">
                            {#if log.status === "Uploading"}
                              <div class="upload-progress-top"></div>
                            {/if}
                            <button class="log-header" onclick={() => toggleExpand(id)}>
                              <input type="checkbox" class="log-select-check" checked={isSelected} onclick={(e) => { e.stopPropagation(); toggleSelectLog(log.file_path); }} />
                              {@render logHeaderLeft(log)}
                              <div class="log-right">
                                <span class="chevron" class:open={isExpanded}>›</span>
                              </div>
                            </button>
                            {@render logFooter(log, () => deleteLogRecord(log.file_path))}
                            {#if isExpanded}
                              {@const groups = log.players ? groupBySubgroup(log.players) : {}}
                              {@const subgroupNums = log.players ? sortedSubgroups(log.players) : []}
                              <div class="squad-section">
                                <div class="squad-title">Squad Composition</div>
                                {#if !log.players || log.players.length === 0}
                                  <p class="no-players">No player data available for this log.</p>
                                {:else}
                                  <div class="subgroups-grid">
                                    {#each subgroupNums as sgNum}
                                      <div class="subgroup-col">
                                        <div class="subgroup-label">Sub {sgNum}</div>
                                        {#each groups[sgNum] as player}
                                          <div class="player-row">
                                            <div class="prof-badge" class:img-loaded={playerIconsLoaded[player.display_name]} style="background-color: {getProfColor(player.profession)};" title="{getSpecName(player)}">
                                            <img src={getProfIcon(player)} alt="" class="prof-icon-img" onload={() => { playerIconsLoaded[player.display_name] = true; }} onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                              <span class="prof-abbr-fallback">{getSpecAbbr(player)}</span>
                                            </div>
                                            <div class="player-info">
                                              <span class="player-name">{#if isCommander(player)}<span class="commander-crown" title="Tank / Commander">👑</span>{/if}{player.display_name}</span>
                                              <span class="player-spec">{player.account}</span>
                                            </div>
                                            {#if player.role}<span class="role-chip role-{player.role.toLowerCase()}">{player.role}</span>{/if}
                                          </div>
                                        {/each}
                                      </div>
                                    {/each}
                                  </div>
                                {/if}
                              </div>
                            {/if}
                          </div>
                        {/each}
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
        {#if showFormatterPanel}
          <div class="formatter-sidebar-panel" style="flex: 0 0 35%; max-width: 35%; background: #10111a; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 16px; position: sticky; top: 0; display: flex; flex-direction: column; gap: 14px; box-sizing: border-box; max-height: calc(100vh - 90px); overflow-y: auto;">
            <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 8px;">
              <h3 style="margin: 0; font-size: 13px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 6px;">✍️ Smart Formatter</h3>
              <p style="margin: 3px 0 0 0; font-size: 10px; color: var(--text-muted);">Format combat log links for Discord share</p>
            </div>
            <div style="display: flex; flex-direction: column; gap: 5px;">
              <span style="font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.6);">Custom Header Text</span>
              <textarea placeholder="e.g. Raid night logs! @everyone..." bind:value={customFormatterHeader} style="width: 100%; height: 50px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #fff; padding: 6px 10px; font-size: 11px; resize: none; font-family: sans-serif; box-sizing: border-box; outline: none; transition: border-color 0.15s;"></textarea>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); padding: 10px; border-radius: 8px;">
              <span style="font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.4); margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px;">Include Info</span>
              <label style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.8); cursor: pointer;">
                <span>Show Victory / Failure Results</span>
                <input type="checkbox" bind:checked={formatterIncludeResults} onclick={() => { formatterKey++; }} style="accent-color: var(--accent); cursor: pointer;"/>
              </label>
              {#if hasConvergenceSelected}
              <label style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.8); cursor: pointer;">
                <span>Add Total Convergence Time</span>
                <input type="checkbox" bind:checked={formatterIncludeConvTime} onclick={() => { formatterKey++; }} style="accent-color: var(--accent); cursor: pointer;"/>
              </label>
              {/if}
              <label style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.8); cursor: pointer;">
                <span>Add Boss Time</span>
                <input type="checkbox" bind:checked={formatterIncludeBossTime} onclick={() => { formatterKey++; }} style="accent-color: var(--accent); cursor: pointer;"/>
              </label>
              <label style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.8); cursor: pointer;">
                <span>Show Dates</span>
                <input type="checkbox" bind:checked={formatterIncludeDates} onclick={() => { formatterKey++; }} style="accent-color: var(--accent); cursor: pointer;"/>
              </label>
              <label style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.8); cursor: pointer;">
                <span>Show Spec Compositions</span>
                <input type="checkbox" bind:checked={formatterIncludeSpecs} onclick={() => { formatterKey++; }} style="accent-color: var(--accent); cursor: pointer;"/>
              </label>
              <label style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.8); cursor: pointer;">
                <span>Best Pull (lowest HP left)</span>
                <input type="checkbox" bind:checked={formatterIncludeBestPull} onclick={() => { formatterKey++; }} style="accent-color: var(--accent); cursor: pointer;"/>
              </label>
              </div>
            <div style="display: flex; flex-direction: column; gap: 5px; flex: 1; min-height: 150px;">
              <span style="font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.6); display: flex; justify-content: space-between; align-items: center;">
                <span>Live Discord Format Preview (Editable ✍️)</span>
                <button type="button" onclick={resetFormatterText} style="background: none; border: none; color: var(--accent); font-size: 9px; cursor: pointer; padding: 0;" title="Reset edits to match settings above">Reset Edits</button>
              </span>
              <textarea bind:value={liveFormattedText} oninput={(e) => { manualEdit = (e.currentTarget as HTMLTextAreaElement).value; }} style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 10px; font-family: monospace; font-size: 10.5px; color: #a78bfa; height: 180px; resize: none; overflow-y: auto; margin: 0; box-sizing: border-box; outline: none; width: 100%;"></textarea>
            </div>
            <button class="creator-btn save" onclick={copyFormatterTextToClipboard} style="width: 100%; padding: 8px; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; border: none; border-radius: 6px; background: var(--accent); color: #fff; transition: background 0.15s;">
              <i class="fa-solid fa-copy"></i> Copy Formatted Logs
            </button>
            <div style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 10px; font-weight: 600; {formatterOverLimit ? 'color: #f87171;' : 'color: rgba(255,255,255,0.45);'}">
              <span>{formatterCharCount} / {DISCORD_CHAR_LIMIT} chars</span>
              {#if formatterOverLimit}
                <span style="color: #f87171;">⚠ Exceeds Discord's 2000-char limit — paste will prompt for a .txt file. Toggle off Dates/Specs or split the batch.</span>
              {/if}
            </div>
            {#if formatterCopyFeedback}
            <div style="margin-top: 8px; text-align: center; font-size: 11px; font-weight: 600; color: #4ade80; opacity: 1; transition: opacity 0.3s ease;">✓ Info Copied</div>
            {/if}
          </div>
        {/if}
      </div>
      </div>
    {:else if activeTab === "analytics"}
      <div style="display: flex; flex-direction: column; gap: inherit; min-height: 100%;" in:fly={{ y: 6, duration: prefersReducedMotion ? 0 : 200 }} out:fade={{ duration: prefersReducedMotion ? 0 : 150 }}>
        <AnalyticsDashboard logs={allHistory} onRefreshHistory={loadFullHistory} isLoading={isHistoryLoading} />
      </div>
    {:else if activeTab === "tracker"}
      <div style="display: flex; flex-direction: column; gap: inherit; min-height: 100%;" in:fly={{ y: 6, duration: prefersReducedMotion ? 0 : 200 }} out:fade={{ duration: prefersReducedMotion ? 0 : 150 }}>
        <ApiTracker accounts={gw2_accounts} onSaveAccounts={(val) => { gw2_accounts = val; }} uploadedLogs={allHistory} />
      </div>
    {:else if activeTab === "history"}
      {#if selectedLogs.size > 0}
        <div class="copy-toolbar" style="position: sticky; top: 0; z-index: 10; margin: 0 0 16px 0; border: 1px solid rgba(99, 102, 241, 0.25); background: rgba(15, 16, 28, 0.95); backdrop-filter: blur(8px);">
          <span class="copy-count">{selectedLogs.size} log{selectedLogs.size > 1 ? 's' : ''} selected</span>
          <button class="btn btn-copy" onclick={() => copySelectedLinks(filteredHistory)} title="Copy links for the selected logs">
            <i class="fa-solid fa-copy" style="margin-right: 4px;"></i> Copy Selected Links
          </button>
          <button class="btn btn-move" onclick={() => moveSelectedToFolder(filteredHistory)} title="Save selected logs into a Folder">
            <i class="fa-solid fa-folder-plus" style="margin-right: 4px;"></i> Move to Folder
          </button>
          <button class="btn btn-clear" onclick={() => selectedLogs = new Set()}>
            <i class="fa-solid fa-xmark" style="margin-right: 4px;"></i> Clear Selection
          </button>
        </div>
      {/if}
      <div style="display: flex; flex-direction: column; gap: inherit; min-height: 100%;" in:fly={{ y: 6, duration: prefersReducedMotion ? 0 : 200 }} out:fade={{ duration: prefersReducedMotion ? 0 : 150 }}>


<!-- repair badge UI removed -->
        <div class="feed-header-row">
        <div>
          <h2 class="feed-title">Uploads History</h2>
        </div>
        <FilterBar
          {filters}
          bosses={distinctBossOptions(allHistory)}
          vlRanks={vlCatalog.flatMap(e => e.ranks.map(r => ({ id: r.id, label: r.label, icon: r.icon })))}
          professions={PROFESSION_OPTIONS}
          professionGroups={PROFESSION_GROUPS}
          showCounts={true}
          resultCount={pagedHistory.length}
          totalCount={allHistory.length}
        />
        <div>
          <button class="action-btn btn-delete" onclick={() => copyAllLinks(filteredHistory)} title="Copy every uploaded link in history">
            <i class="fa-solid fa-copy" style="margin-right: 4px;"></i> Copy All Links
          </button>
          <button class="action-btn btn-delete" style="font-size: 11px; padding: 6px 12px; margin-left: 8px;" onclick={clearAllHistory}>
            <i class="fa-solid fa-trash-can" style="margin-right: 4px;"></i> Clear All History
          </button>
        </div>
      </div>



      {#if filteredHistory.length === 0}
        <div class="empty-state card">
          <div class="empty-icon"><i class="fa-solid fa-clock-rotate-left"></i></div>
          {#if allHistory.length === 0}
            <h3>History is empty</h3>
            <p>Successful and failed uploads will show up here permanently across app launches.</p>
          {:else}
            <h3>No logs match the current filters</h3>
            <p>Adjust or clear the filters above to see more results.</p>
          {/if}
        </div>
      {:else}
        <div class="records-list">
          {#each pagedHistory as log (log.file_path)}
          {@const id = cardId(log)}
          {@const isExpanded = !!expanded[id]}
          {@const isSelected = selectedLogs.has(log.file_path)}
          <div class="log-card card" class:menu-open={activeMenuCard === id} class:is-expanded={isExpanded} class:uploading={log.status === "Uploading"} class:is-selected={isSelected} class:deleting={deletingLogPaths.has(log.file_path)} style="position: relative; cursor: context-menu;" oncontextmenu={(e) => handleLogContextMenu(e, log, false)} role="button" tabindex="0">
            {#if log.status === "Uploading"}
              <div class="upload-progress-top"></div>
            {/if}
              <button class="log-header" onclick={() => toggleExpand(id)}>
                <input type="checkbox" class="log-select-check" checked={isSelected} onclick={(e) => { e.stopPropagation(); toggleSelectLog(log.file_path); }} />
                {@render logHeaderLeft(log)}
                <div class="log-right">
                  {#if getEncounterType(log.boss_name, log.num_players, log.is_convergence) !== 'convergence'}
                    <span class="chevron" class:open={isExpanded}>›</span>
                  {/if}
                </div>
              </button>
              {@render logFooter(log, () => deleteHistoryLog(log.file_path))}
              {#if isExpanded && getEncounterType(log.boss_name, log.num_players, log.is_convergence) !== 'convergence'}
                {@const groups = log.players ? groupBySubgroup(log.players) : {}}
                {@const subgroupNums = log.players ? sortedSubgroups(log.players) : []}
                <div class="squad-section">
                  <div class="squad-title">Squad Composition</div>
                  {#if !log.players || log.players.length === 0}
                    <p class="no-players">No player data available for this log.</p>
                  {:else}
                    <div class="subgroups-grid">
                      {#each subgroupNums as sgNum}
                        <div class="subgroup-col">
                          <div class="subgroup-label">Sub {sgNum}</div>
                          {#each groups[sgNum] as player}
                            <div class="player-row">
                              <div class="prof-badge" class:img-loaded={playerIconsLoaded[player.display_name]} style="background-color: {getProfColor(player.profession)};" title="{getSpecName(player)}">
                                <img src={getProfIcon(player)} alt="" class="prof-icon-img" onload={() => { playerIconsLoaded[player.display_name] = true; }} onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                <span class="prof-abbr-fallback">{getSpecAbbr(player)}</span>
                              </div>
                              <div class="player-info">
                                <span class="player-name">{#if isCommander(player)}<span class="commander-crown" title="Tank / Commander">👑</span>{/if}{player.display_name}</span>
                                <span class="player-spec">{player.account}</span>
                              </div>
                              {#if player.role}<span class="role-chip role-{player.role.toLowerCase()}">{player.role}</span>{/if}
                            </div>
                          {/each}
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
        <div class="pagination-container" style="position: sticky; bottom: 0; z-index: 5; display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 20px; padding: 14px; background: rgba(15, 16, 28, 0.95); backdrop-filter: blur(8px); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 8px; box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.4);">
          <button class="action-btn" onclick={() => historyPage = 0} disabled={historyPage === 0}>« First</button>
          <button class="action-btn" onclick={() => historyPage = Math.max(0, historyPage - 1)} disabled={historyPage === 0}>‹ Prev</button>
          <span style="font-size: 12px; color: rgba(255,255,255,0.7); font-weight: 500;">
            Page {historyPage + 1} of {Math.max(1, Math.ceil(historyTotalCount / historyLimit))} ({historyTotalCount}{historyHasMore ? "+" : ""} total logs)
          </span>
          <button class="action-btn" onclick={() => historyPage = historyPage + 1} disabled={(historyPage + 1) * historyLimit >= historyTotalCount}>Next ›</button>
          <button class="action-btn" onclick={() => historyPage = Math.max(0, Math.ceil(historyTotalCount / historyLimit) - 1)} disabled={(historyPage + 1) * historyLimit >= historyTotalCount}>Last »</button>
        </div>
      {/if}
      </div>
    {:else if SHOW_SQUAD_PLANNER && activeTab === "squad"}
      {@const currentLevel = squadFolderStack.length
        ? (squadFolderStack[squadFolderStack.length - 1].children ?? [])
        : squadPlans}
      {@const inFolder = squadFolderStack.length > 0}
      <div class="squad-planner-view" in:fly={{ y: 6, duration: prefersReducedMotion ? 0 : 200 }} out:fade={{ duration: prefersReducedMotion ? 0 : 150 }}>
        <div class="squad-planner-header">
          <div>
            <h2 class="squad-planner-h2">Squad Planner</h2>
            <p class="squad-planner-sub">
              {inFolder
                ? "This folder holds compositions. Click a card to open or edit it."
                : "Build and save squad compositions. Click New Composition to create a folder, then add rosters inside."}
            </p>
            {#if inFolder}
              <div class="squad-breadcrumb">
                <button class="squad-crumb" onclick={() => (squadFolderStack = [])}>Squad Planner</button>
                {#each squadFolderStack as f, fi (f.id)}
                  <span class="squad-crumb-sep">/</span>
                  {#if fi === squadFolderStack.length - 1}
                    <span class="squad-crumb current">{f.name}</span>
                  {:else}
                    <button class="squad-crumb" onclick={() => (squadFolderStack = squadFolderStack.slice(0, fi + 1))}>{f.name}</button>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
          <button class="squad-new-btn" onclick={() => {
            if (inFolder) {
              // Folders must never be nested inside other folders. Inside a folder,
              // "New Composition" can only create a roster — not a subfolder.
              editingPlan = newRoster("New Composition");
            } else {
              editingPlan = newFolder("New Folder");
            }
            creatingPlan = true;
          }}>
            <i class="fa-solid fa-plus"></i> New Composition
          </button>
        </div>

        {#if currentLevel.length === 0}
          <div class="squad-empty">
            <i class="fa-solid fa-users"></i>
            <p>
              {#if inFolder}
                No compositions in this folder yet. Click <strong class="squad-empty-strong">New Composition</strong> to add one.
              {:else}
                No compositions yet. Click <strong class="squad-empty-strong">New Composition</strong> to build your first squad.
              {/if}
            </p>
          </div>
        {:else}
          <div class="squad-grid">
            {#each currentLevel as plan (plan.id)}
              <SquadPlanCard
                {plan}
                onOpen={() => {
                  if (plan.kind === "folder" || (plan.children?.length ?? 0) > 0) squadFolderStack = [...squadFolderStack, plan];
                  else { editingPlan = JSON.parse(JSON.stringify(plan)) as SquadPlan; creatingPlan = false; }
                }}
                onEdit={() => {
                  editingPlan = JSON.parse(JSON.stringify(plan)) as SquadPlan; creatingPlan = false;
                }}
                onDuplicate={() => duplicatePlan(plan)}
                onDelete={() => deletePlan(plan.id)}
              />
            {/each}
          </div>
        {/if}

        </div>
        {:else if activeTab === "tracker"}
      <div style="display: flex; flex-direction: column; gap: inherit; min-height: 100%;" in:fly={{ y: 6, duration: prefersReducedMotion ? 0 : 200 }} out:fade={{ duration: prefersReducedMotion ? 0 : 150 }}>
        <AnalyticsDashboard logs={allHistory} onRefreshHistory={loadFullHistory} isLoading={isHistoryLoading} />
      </div>
    {:else if activeTab === "settings"}
      <div style="display: flex; flex-direction: column; gap: inherit; min-height: 100%;" in:fly={{ y: 6, duration: prefersReducedMotion ? 0 : 200 }} out:fade={{ duration: prefersReducedMotion ? 0 : 150 }}>
        <div class="page-header">
        <h1>Configuration</h1>
        <p>Manage watch folder, tokens, and integrations</p>
      </div>
      <div class="settings-stack">

        <!-- ─── CARD: Logs & Sources ─── -->
        <section class="settings-card">
          <header class="settings-card-head">
            <span class="settings-card-icon"><i class="fa-solid fa-folder-tree"></i></span>
            <div class="settings-card-titles">
              <h3>Logs &amp; Sources</h3>
              <p>Where logs come from and where they go.</p>
            </div>
          </header>
          <div class="settings-card-body">
            <div class="form-group">
              <label for="logs-dir">ArcDPS Logs Directory</label>
              <div style="display: flex; gap: 8px;">
                <input id="logs-dir" type="text" placeholder="e.g. C:\\Users\\...\\Documents\\Guild Wars 2\\addons\\arcdps\\arcdps.cbtlogs" bind:value={logs_directory} style="flex: 1;"/>
                <button class="action-btn" onclick={() => triggerFolderUpload()} style="padding: 0 16px;"><i class="fa-solid fa-folder-open"></i> Browse</button>
              </div>
              <span class="help">The folder where ArcDPS saves <code>.evtc</code> or <code>.zevtc</code> combat logs.</span>
            </div>
            <div class="form-group">
              <label for="dps-token">dps.report User Token <span class="optional">(optional)</span></label>
              <input id="dps-token" type="password" placeholder="Your dps.report token..." bind:value={dps_report_token}/>
              <span class="help">Links uploads to your dps.report account for persistent storage.</span>
            </div>
            <div class="form-group wh-group">
              <span class="group-label">Discord Webhooks <span class="optional">(optional)</span></span>
              <div class="wh-top-actions">
                <button class="wh-add" onclick={() => { discord_webhooks = [...discord_webhooks, { id: `wh_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, label: "", url: "", enabled: true, mention_roles: [], thread_id: null, filters: { kinds: [], outcomes: [], only_cm: null, only_lcm: null, bosses: [] }, _collapsed: false, _showAdvanced: false }]; }}>
                  <i class="fa-solid fa-plus"></i> Add Webhook
                </button>
                <button class="wh-log-btn" title="View the webhook delivery audit log" onclick={() => openWebhookLog()}>
                  <i class="fa-solid fa-clipboard-list"></i> Webhook Log
                </button>
                <button class="wh-resend-btn" title="Re-fire any queued (outage) posts and history records still pending delivery" onclick={() => resendFailedWebhooks()} disabled={resendingWebhooks}>
                  <i class="fa-solid fa-rotate-right"></i> {resendingWebhooks ? "Resending…" : "Resend failed"}
                </button>
              </div>
              <div class="wh-list">
                {#if discord_webhooks.length === 0}
                  <div class="wh-empty">
                    <i class="fa-solid fa-bell-slash"></i>
                    <p class="wh-empty-title">No webhooks yet</p>
                    <span class="wh-empty-sub">Add one to post upload embeds to Discord. Use “+ Add Webhook” above.</span>
                  </div>
                {:else}

                <!-- ═══════════════════════════════════════════════════════════════════════
                     WEBHOOK CARDS — each card = one Discord destination
                     State: wh._collapsed, wh._showFilters, wh._roleFormOpen, wh.enabled
                     Mentions: mention_roles[] → joined into Discord `content` payload
                     Thread:   wh.thread_id → appended as ?thread_id=<id> to POST URL
                     ═══════════════════════════════════════════════════════════════════════ -->
                {#each discord_webhooks as wh, i (wh.id)}
                  <div class="wh-card" class:collapsed={wh._collapsed}>
                    <div class="wh-card-head">
                      <button class="wh-chev" class:collapsed={wh._collapsed} title={wh._collapsed ? "Expand" : "Collapse"} onclick={() => { wh._collapsed = !wh._collapsed; discord_webhooks = [...discord_webhooks]; }} aria-label="Collapse or expand">
                        <i class="fa-solid fa-chevron-down"></i>
                      </button>
                      <button class="wh-toggle" class:on={wh.enabled} title={wh.enabled ? "Enabled" : "Disabled"} onclick={(e) => { e.stopPropagation(); wh.enabled = !wh.enabled; discord_webhooks = [...discord_webhooks]; }} aria-label="Toggle webhook">
                        {wh.enabled ? "ON" : "OFF"}
                      </button>
                      {#if wh._collapsed}
                      <span class="wh-card-name">{wh.label?.trim() || "Unnamed webhook"}</span>
                      <span class="wh-collapsed-chips">
                        {#if wh.thread_id}<span class="wh-chip wh-chip-thread">Thread</span>{/if}
                        {#if !wh.thread_id && wh.url?.trim()}<span class="wh-chip wh-chip-channel">Channel</span>{/if}
                        {#if !wh.url?.trim()}<span class="wh-chip wh-chip-empty">No link</span>{/if}
                        {#if wh.filters.kinds.length && wh.filters.kinds.length < 5}{#each wh.filters.kinds as k}<span class="wh-chip wh-chip-type">{k.charAt(0).toUpperCase() + k.slice(1)}</span>{/each}{/if}
                        {#if wh.filters.outcomes.length === 1}<span class="wh-chip wh-chip-outcome">{wh.filters.outcomes[0].charAt(0).toUpperCase() + wh.filters.outcomes[0].slice(1)}</span>{/if}
                        {#if wh.mention_roles?.length}<span class="wh-chip wh-chip-ping">{wh.mention_roles.length} ping{wh.mention_roles.length > 1 ? "s" : ""}</span>{/if}
                        {#if wh.filters?.only_cm === true}<span class="wh-chip wh-chip-cm">CM</span>{/if}
                        {#if wh.filters?.only_cm === false}<span class="wh-chip wh-chip-nocm">non-CM</span>{/if}
                        {#if wh.filters?.only_lcm === true}<span class="wh-chip wh-chip-lcm">LCM</span>{/if}
                      </span>
                      {:else}
                      <input class="wh-label" type="text" placeholder="Webhook Name" bind:value={wh.label} />
                      {/if}

                      <div class="wh-head-actions">

                        <button class="wh-dup" title="Duplicate this webhook (same filters/mention, blank thread)" onclick={() => duplicateWebhook(wh, i)}>
                          <i class="fa-solid fa-copy"></i>
                        </button>
                        <button class="wh-del" title="Remove webhook" onclick={() => { pendingDeleteWh = wh.id; }} aria-label="Remove webhook">
                          <i class="fa-solid fa-xmark"></i>
                        </button>
                      </div>
                    </div>
                    {#if pendingDeleteWh === wh.id}
                    <div class="wh-delete-confirm">
                      <span>Delete this webhook?</span>
                      <div class="wh-delete-confirm-actions">
                        <button class="wh-delete-cancel" onclick={() => { pendingDeleteWh = null; }}>Cancel</button>
                        <button class="wh-delete-confirm-btn" onclick={() => { discord_webhooks = discord_webhooks.filter((w) => w.id !== wh.id); pendingDeleteWh = null; }}>Delete</button>
                      </div>
                    </div>
                    {/if}
                    {#if !wh._collapsed}
                    <div class="wh-card-body">
                      <div class="wh-row wh-fields">
                        <div class="wh-field wh-field-url">
                          <label for="webhook-url">Webhook link</label>
                          <input id="webhook-url" class="wh-url" class:invalid={!!wh.url?.trim() && !whUrlValid(wh.url)} type="text" placeholder="https://discord.com/api/webhooks/..." bind:value={wh.url} />
                          <div class="wh-url-actions">
                            <button class="wh-test" title="Send a test embed to verify this webhook" onclick={async (e) => { e.stopPropagation(); await testWebhook(wh); }}><i class="fa-solid fa-paper-plane"></i> Test</button>
                            {#if whTest[wh.id]?.status === 'testing'}<span class="wh-status-inline">Testing…</span>{/if}
                            {#if whTest[wh.id]?.status === 'ok'}<span class="wh-status-inline wh-status-ok">✓ {whTest[wh.id].msg}</span>{/if}
                            {#if whTest[wh.id]?.status === 'err'}<span class="wh-status-inline wh-status-err">✗ {whTest[wh.id].msg}</span>{/if}
                          </div>
                          <div class="wh-field wh-field-thread">
                      <div class="wh-thread-label">
                        <span class="wh-thread-name">Thread ID</span>
                        <span class="wh-thread-badge">Optional</span>
                      </div>
                      <div class="wh-thread-input">
                        <input class="wh-thread" type="text" placeholder="optional e.g. 1234567890" bind:value={wh.thread_id} title="Optional Discord thread ID. When set, posts land inside that thread instead of the channel root. Append ?thread_id=<id> to the webhook URL." />
                        <button class="wh-help-btn" type="button" title="How do I get a Thread ID?" onclick={() => { whThreadHelp = { ...whThreadHelp, [wh.id]: !whThreadHelp[wh.id] }; }}><i class="fa-solid fa-question"></i></button>
                      </div>
                    </div>

                        </div>
                        <div class="wh-field wh-field-mention">
                          <div class="wh-field-label">Ping Roles
                            <span class="wh-subtle">— named Discord role pings (optional)</span>
                          </div>
                          {#if Array.isArray(wh.mention_roles) && wh.mention_roles.length}
                            <div class="wh-roles-list">
                              {#each wh.mention_roles as role, ri (wh.id + ":" + ri)}
                                {@const editKey = wh.id + ":" + ri}
                                <span class="wh-role-tag" title={role.token}>
                                  <span class="wh-role-name" role="button" tabindex="0" onclick={() => { whRoleEdit = { ...whRoleEdit, [editKey]: { label: role.label ?? "", raw: role.token ?? "" } }; }} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); whRoleEdit = { ...whRoleEdit, [editKey]: { label: role.label ?? "", raw: role.token ?? "" } }; } }}>{role.label}</span>
                                  <button class="wh-role-del" type="button" title="Delete" onclick={() => deleteRole(wh, ri)}>×</button>
                                </span>
                              {/each}
                              <button class="wh-role-add-toggle" type="button" onclick={() => { wh._roleFormOpen = true; whRoleDraft = { ...whRoleDraft, [wh.id]: { label: "", raw: "" } }; }}>+ Add ping role</button>
                            </div>
                          {:else}
                            <button class="wh-role-add-toggle" type="button" onclick={() => { wh._roleFormOpen = true; whRoleDraft = { ...whRoleDraft, [wh.id]: { label: "", raw: "" } }; }}>+ Add ping role</button>
                          {/if}
                          {#if wh._roleFormOpen}
                          <div class="wh-roles-add">
                            <input class="wh-role-label" type="text" placeholder="Name (e.g. Raid)" value={(whRoleDraft[wh.id] ?? {}).label ?? ""} oninput={(e) => { whRoleDraft = { ...whRoleDraft, [wh.id]: { label: e.currentTarget.value, raw: (whRoleDraft[wh.id] ?? {}).raw ?? "" } }; }} />
                            <input class="wh-role-id" type="text" placeholder="Role or user ID" value={(whRoleDraft[wh.id] ?? {}).raw ?? ""} oninput={(e) => { whRoleDraft = { ...whRoleDraft, [wh.id]: { label: (whRoleDraft[wh.id] ?? {}).label ?? "", raw: e.currentTarget.value } }; }} onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRole(wh); } }} />
                            <button class="wh-role-add-btn" type="button" onclick={() => addRole(wh)} disabled={!(whRoleDraft[wh.id] ?? {}).raw?.trim()}>Add</button>
                            <button class="wh-role-cancel-btn" type="button" onclick={() => { wh._roleFormOpen = false; whRoleDraft = { ...whRoleDraft, [wh.id]: { label: "", raw: "" } }; }}>Cancel</button>
                          </div>
                          {/if}
                          <div class="wh-section-divider"></div>
                          <div class="wh-global-mentions">
                            <span class="wh-global-label">Global mentions</span>
                            <div class="wh-mention-chips">
                              <button class="wh-mention-chip" type="button" onmousedown={(e) => e.preventDefault()} onclick={() => insertMention(wh, "@everyone")}>@everyone</button>
                              <button class="wh-mention-chip" type="button" onmousedown={(e) => e.preventDefault()} onclick={() => insertMention(wh, "@here")}>@here</button>
                            </div>
                          </div>
                        </div>
                    
                  </div>
              {#if !!wh.url?.trim() && !whUrlValid(wh.url)}
                <div class="wh-status wh-status-invalid">
                  ⚠ Invalid webhook URL
                </div>
              {/if}
              {#if whThreadHelp[wh.id]}
                <div class="wh-thread-help">Enable <b>Developer Mode</b> (User Settings → Advanced), right-click the thread, then <b>Copy Thread ID</b>. Paste it above.</div>
              {/if}
              {#if wh.filters && (wh.filters.kinds.length || wh.filters.outcomes.length || wh.filters.only_cm !== null || wh.filters.only_lcm !== null || wh.filters.bosses.length)}
                <div class="wh-filter-summary">
                  {#each wh.filters.kinds as k}<span class="wh-fchip">{k}</span>{/each}
                  {#each wh.filters.outcomes as o}<span class="wh-fchip">{o}</span>{/each}
                  {#if wh.filters.only_cm === true}<span class="wh-fchip">CM</span>{/if}
                  {#if wh.filters.only_cm === false}<span class="wh-fchip">non-CM</span>{/if}
                  {#if wh.filters.only_lcm === true}<span class="wh-fchip">LCM</span>{/if}
                  {#if wh.filters.bosses[0]}<span class="wh-fchip">boss: {wh.filters.bosses[0]}</span>{/if}
                </div>
              {/if}
<div class="wh-presets">
                  <button class="wh-preset" onclick={() => { wh.filters.kinds = ['raid', 'strike', 'fractal', 'convergence', 'golem']; wh.filters.outcomes = ['kill', 'wipe']; wh.filters.only_cm = null; wh.filters.only_lcm = null; discord_webhooks = [...discord_webhooks]; }}>All</button>
                  <button class="wh-preset" onclick={() => { wh.filters.kinds = ['raid']; wh.filters.outcomes = ['kill', 'wipe']; wh.filters.only_cm = null; wh.filters.only_lcm = null; discord_webhooks = [...discord_webhooks]; }}>Raids</button>
                  <button class="wh-preset" onclick={() => { wh.filters.kinds = ['strike']; wh.filters.outcomes = ['kill', 'wipe']; wh.filters.only_cm = null; wh.filters.only_lcm = null; discord_webhooks = [...discord_webhooks]; }}>Strikes</button>
                  <button class="wh-preset" onclick={() => { wh.filters.kinds = ['raid', 'strike', 'fractal', 'convergence', 'golem']; wh.filters.outcomes = ['kill', 'wipe']; wh.filters.only_cm = true; wh.filters.only_lcm = null; discord_webhooks = [...discord_webhooks]; }}>CM</button>
                </div>
                <button class="wh-filters-header" onclick={() => { wh._showFilters = !wh._showFilters; discord_webhooks = [...discord_webhooks]; }}>
                  <i class="fa-solid fa-filter"></i> More filters
                </button>
                {#if wh._showFilters}
                <div class="wh-filters-body">
                  <div class="wh-filter-row wh-filter-row-type">
                    <span class="wh-filter-label">Type</span>
                    <div class="chip-group">
                      {#each ["raid", "strike", "fractal", "convergence", "golem"] as k}
                        <button class="chip chip-type" class:on={wh.filters.kinds.includes(k)} onclick={() => { toggleArr(wh.filters.kinds, k); discord_webhooks = [...discord_webhooks]; }}>{k}</button>
                      {/each}
                    </div>
                  </div>
                  <div class="wh-filter-row wh-filter-row-outcome">
                    <span class="wh-filter-label">Outcome</span>
                    <div class="chip-group">
                      {#each ["kill", "wipe"] as o}
                        <button class="chip chip-outcome" class:on={wh.filters.outcomes.includes(o)} onclick={() => { toggleArr(wh.filters.outcomes, o); discord_webhooks = [...discord_webhooks]; }}>{o}</button>
                      {/each}
                    </div>
                  </div>
                  <div class="wh-filter-row wh-filter-row-mode">
                    <span class="wh-filter-label">Mode</span>
                    <div class="chip-group">
                      <button class="chip chip-mode" class:on={wh.filters.only_cm === true} onclick={() => { wh.filters.only_cm = wh.filters.only_cm === true ? null : true; discord_webhooks = [...discord_webhooks]; }}>CM</button>
                      <button class="chip chip-mode" class:on={wh.filters.only_cm === false} onclick={() => { wh.filters.only_cm = wh.filters.only_cm === false ? null : false; discord_webhooks = [...discord_webhooks]; }}>non-CM</button>
                      <button class="chip chip-lcm" class:on={wh.filters.only_lcm === true} onclick={() => { wh.filters.only_lcm = wh.filters.only_lcm === true ? null : true; discord_webhooks = [...discord_webhooks]; }}>LCM</button>
                    </div>
                  </div>
                  <div class="wh-filter-row wh-filter-row-boss">
                    <span class="wh-filter-label">Boss</span>
                    <input class="wh-boss" type="text" placeholder="substring e.g. ura (optional)" bind:value={wh.filters.bosses[0]} oninput={() => { wh.filters.bosses = wh.filters.bosses[0] ? [wh.filters.bosses[0]] : []; }} />
                  </div>
                  <span class="help">Empty filters = post everything. Selected filters are AND-ed; within a row, any match counts.</span>
                </div>
              {/if}
              </div>
            {/if}
              </div>
            {/each}
            {/if}
          </div>
          <span class="help">Posts a rich embed to each enabled channel on every upload. Legacy single URL (if any) was migrated into this list.</span>
          </div>
          </div>
        </section>



        <!-- ─── CARD: Integrations ─── -->
        <section class="settings-card">
          <header class="settings-card-head">
            <span class="settings-card-icon"><i class="fa-solid fa-plug"></i></span>
            <div class="settings-card-titles">
              <h3>Integrations</h3>
              <p>Connect Portal Protocol to external services.</p>
            </div>
          </header>
          <div class="settings-card-body">
            <div class="form-group" style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 16px; margin-top: 8px;">
              <div class="form-checkbox" style="margin-bottom: 8px;">
                <input id="wingman-watch" type="checkbox" bind:checked={wingman_enabled}/>
                <label for="wingman-watch">Enable Uploads to GW2 Wingman</label>
              </div>
              {#if wingman_enabled}
                <div style="padding-left: 24px; margin-top: 8px; animation: slideDown 0.15s ease-out;">
                  <label for="wingman-acc" style="display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">GW2 Account Name</label>
                  <input id="wingman-acc" type="text" placeholder="e.g. Username.1234" bind:value={wingman_account} style="width: 100%; max-width: 320px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); padding: 6px; border-radius: 4px; color: white; font-size: 11px; outline: none;"/>
                  <span class="help" style="display: block; margin-top: 4px;">Required by Wingman to link combat uploads directly to your account dashboard.</span>
                </div>
              {/if}
            </div>
            <div class="form-checkbox" style="margin-top: 12px;">
              <input id="wvw-watch" type="checkbox" bind:checked={wvw_enabled}/>
              <label for="wvw-watch">Show World vs World (WvW) Logs</label>
              <span class="help" style="display: block; margin-top: 2px;">When off (default), WvW logs are ignored entirely. When on, they appear as a separate "World vs World" group and are excluded from Wingman uploads.</span>
            </div>
          </div>
        </section>

        <!-- ─── CARD: Behavior ─── -->
        <section class="settings-card">
          <header class="settings-card-head">
            <span class="settings-card-icon"><i class="fa-solid fa-sliders"></i></span>
            <div class="settings-card-titles">
              <h3>Behavior</h3>
              <p>How the app runs and notifies you.</p>
            </div>
          </header>
          <div class="settings-card-body">
            <div class="form-checkbox">
              <input id="auto-watch" type="checkbox" bind:checked={auto_upload}/>
              <label for="auto-watch">Enable Automatic Background Uploading</label>
            </div>
            <div class="form-checkbox">
              <input id="autostart" type="checkbox" bind:checked={autostart}/>
              <label for="autostart">Start App Automatically on Windows Boot</label>
            </div>
            <div class="form-checkbox">
              <input id="sound-notif" type="checkbox" bind:checked={sound_notifications}/>
              <label for="sound-notif">Enable Sound Chime on Success</label>
            </div>
            <div class="form-checkbox">
              <input id="desktop-notif" type="checkbox" bind:checked={desktop_notifications}/>
              <label for="desktop-notif">Show Windows Desktop Notifications</label>
            </div>
            <div class="form-checkbox">
              <input id="hide-startup" type="checkbox" bind:checked={hide_on_startup}/>
              <label for="hide-startup">Start Hidden in System Tray</label>
              <span style="font-size: 10px; color: var(--text-muted);">App launches to the tray; click the icon to open.</span>
            </div>
            <div class="form-checkbox" style="display: flex; align-items: center; gap: 10px;">
              <label for="max-concurrent" style="min-width: 150px;">Max Simultaneous Uploads</label>
              <select id="max-concurrent" class="settings-select" bind:value={max_concurrent_uploads}>
                <option value={1}>1 (Strict queue)</option>
                <option value={2}>2 (Balanced)</option>
                <option value={3}>3 (Aggressive)</option>
                <option value={0}>Unlimited (legacy)</option>
              </select>
              <span style="font-size: 10px; color: var(--text-muted);">Caps how many logs upload to dps.report at once.</span>
            </div>
          </div>
        </section>

        <!-- ─── CARD: Appearance ─── -->
        <section class="settings-card">
          <header class="settings-card-head">
            <span class="settings-card-icon"><i class="fa-solid fa-palette"></i></span>
            <div class="settings-card-titles">
              <h3>Appearance</h3>
              <p>Personalize the look and motion.</p>
            </div>
          </header>
          <div class="settings-card-body">
            <div class="form-checkbox">
              <input id="reduce-motion" type="checkbox" bind:checked={reduce_motion} onchange={() => applyReduceMotion(reduce_motion)}/>
              <label for="reduce-motion">Reduce Motion (disable UI animations)</label>
            </div>
            <div class="form-checkbox">
              <input id="compact-mode" type="checkbox" bind:checked={compact_mode} onchange={() => applyCompactMode(compact_mode)}/>
              <label for="compact-mode">Compact Mode</label>
              <span style="font-size: 10px; color: var(--text-muted);">Tighter card spacing, smaller tabs, and denser upload rows.</span>
            </div>
            <div style="margin-top: 12px;">
              <span style="font-size: 12px; color: var(--text-muted); display: block; margin-bottom: 6px;">Accent Color</span>
              <button type="button" class="accent-customize-btn" onclick={() => openAccentPicker()} aria-haspopup="dialog">
                <span class="accent-customize-swatch" style="background: {accent};"></span>
                <span>Customize Accent</span>
                <span class="accent-customize-hex">{accent.toUpperCase()}</span>
              </button>
            </div>
            <div style="margin-top: 16px;">
              <label for="app-font-select" style="font-size: 12px; color: var(--text-muted); display: block; margin-bottom: 6px;">Font Family</label>
              <select id="app-font-select" class="settings-select" bind:value={app_font} onchange={() => applyFont(app_font)}>
                <option value="inter-outfit">Outfit &amp; Inter (Default)</option>
                <option value="inter">Inter (Sleek Sans)</option>
                <option value="outfit">Outfit (Rounded Elegant)</option>
                <option value="system">System UI (Native)</option>
                <option value="mono">Monospace (Terminal style)</option>
              </select>
              <span style="font-size: 10px; color: var(--text-muted);">Change the typography layout of the uploader application.</span>
            </div>
          </div>
        </section>

        <!-- ─── CARD: Storage & Cache ─── -->
        <section class="settings-card">
          <header class="settings-card-head">
            <span class="settings-card-icon"><i class="fa-solid fa-hard-drive"></i></span>
            <div class="settings-card-titles">
              <h3>Storage &amp; Cache Maintenance</h3>
              <p>Manage local JSON log cache, history database, and free up space.</p>
            </div>
          </header>
          <div class="settings-card-body" style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px;">
                <div>
                  <div style="font-size: 13px; font-weight: 600; color: var(--text);">dps.report Log Cache</div>
                  <div class="tabular-nums" style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                    {formatSize(logCacheSize)} accumulated across {logCacheCount} log files
                  </div>
                </div>
                <button
                  type="button"
                  class="cache-clear-btn"
                  onclick={openClearCacheModal}
                  disabled={logCacheCount === 0}
                  title="Clear local log JSON cache"
                >
                  <i class="fa-solid fa-trash-can"></i> Clear Cache
                </button>
              </div>
              <span style="font-size: 10px; color: var(--text-muted); display: block; margin-left: 4px;">
                Logs are cached locally so the Stats button opens instantly. Clearing cache will re-download logs on demand.
              </span>
            </div>

            <!-- Slider: how many cached logs to keep -->
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div style="font-size: 13px; font-weight: 600; color: var(--text);">Max Cached Logs to Keep</div>
                  <span class="custom-tooltip-container" aria-label="How many parsed log files the app keeps on disk for instant Stats re-opening. Older logs are auto-deleted. Set higher to keep more history at hand; lower to save space. 0 = keep all (unbounded).">
                    <i class="fa-solid fa-circle-info" style="font-size: 11px; color: var(--text-muted); cursor: help;"></i>
                    <span class="custom-tooltip custom-tooltip-box">How many parsed log files the app keeps on disk for instant Stats re-opening. Older logs are auto-deleted to free space. Higher = keep more history ready; lower = save disk. <b>0 = keep everything</b> (unbounded).</span>
                  </span>
                </div>
                <span class="tabular-nums" style="font-size: 12px; color: var(--accent); font-weight: 600;">{log_cache_max_files === 0 ? 'Unlimited' : log_cache_max_files + ' logs'}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 12px; padding: 0 4px;">
                <span style="font-size: 10px; color: var(--text-muted);">Off</span>
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="5"
                  bind:value={log_cache_max_files}
                  onchange={async () => { await persistConfig(); try { await invoke('prune_log_cache'); await refreshCacheSize(); } catch (e) { console.error('prune_log_cache failed', e); } }}
                  style="flex: 1; accent-color: var(--accent); cursor: pointer;"
                  title="Number of cached logs to retain (0 = unlimited)"
                />
                <span style="font-size: 10px; color: var(--text-muted);">200</span>
              </div>
              <span style="font-size: 10px; color: var(--text-muted); display: block; margin-left: 4px;">
                Changing this prunes older cached logs immediately. The Stats button still works for any log — it just re-fetches from dps.report when not cached.
              </span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 6px;">
              <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px;">
                <div>
                  <div style="font-size: 13px; font-weight: 600; color: var(--text);">Analytics &amp; History Cache</div>
                  <div class="tabular-nums" style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                    {formatSize(historyCacheSize)} accumulated across {historyCacheCount} uploaded records
                  </div>
                </div>
                <button
                  type="button"
                  class="cache-clear-btn"
                  onclick={openClearHistoryModal}
                  disabled={historyCacheCount === 0}
                  title="Clear local history database and analytics"
                >
                  <i class="fa-solid fa-trash-can"></i> Clear History
                </button>
              </div>
              <span style="font-size: 10px; color: var(--text-muted); display: block; margin-left: 4px;">
                Clear historical records database (`history.json`). This will clear your Analytics graphs and History logs list.
              </span>
            </div>
          </div>
        </section>

        <!-- ─── CARD: Upload & Network Resilience ─── -->
        <section class="settings-card">
          <header class="settings-card-head">
            <span class="settings-card-icon"><i class="fa-solid fa-shield-halved"></i></span>
            <div class="settings-card-titles">
              <h3>Upload &amp; Network Resilience</h3>
              <p>Survive outages and partial writes.</p>
            </div>
          </header>
          <div class="settings-card-body">
            <div class="form-checkbox">
              <input id="use-backup-dps" type="checkbox" bind:checked={use_backup_dps}/>
              <label for="use-backup-dps">Use b.dps.report fallback when dps.report is down</label>
              <span style="font-size: 10px; color: var(--text-muted);">Automatically reroutes uploads to the backup domain during a dps.report outage.</span>
            </div>
            <div class="form-checkbox" style="display: flex; align-items: center; gap: 10px;">
              <label for="stability-delay" style="min-width: 200px;">File-write settle delay</label>
              <input id="stability-delay" type="number" min="0" max="10000" step="100" bind:value={watch_stability_delay_ms} style="width: 90px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); padding: 6px; border-radius: 4px; color: white; font-size: 11px; outline: none;"/>
              <span style="font-size: 10px; color: var(--text-muted);">ms — debounce against ArcDPS partial writes. Default 500.</span>
            </div>
            <div class="form-checkbox" style="display: flex; align-items: center; gap: 10px;">
              <label for="upload-retries" style="min-width: 200px;">Upload retries</label>
              <input id="upload-retries" type="number" min="0" max="10" step="1" bind:value={max_upload_retries} style="width: 90px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); padding: 6px; border-radius: 4px; color: white; font-size: 11px; outline: none;"/>
              <span style="font-size: 10px; color: var(--text-muted);">extra attempts on dps.report outages (3s, 6s, 12s… backoff). Default 3.</span>
            </div>
            <div class="form-checkbox" style="display: flex; align-items: center; gap: 10px;">
              <label for="min-seconds" style="min-width: 200px;">Min fight seconds</label>
              <input id="min-seconds" type="number" min="0" max="600" step="1" bind:value={min_log_seconds} style="width: 90px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); padding: 6px; border-radius: 4px; color: white; font-size: 11px; outline: none;"/>
              <span style="font-size: 10px; color: var(--text-muted);">0 = off. Skip logs shorter than this (fast /gg, insta-wipe) → "Skipped".</span>
            </div>
          </div>
        </section>

        <!-- ─── CARD: Data & Portability ─── -->
        <section class="settings-card">
          <header class="settings-card-head">
            <span class="settings-card-icon"><i class="fa-solid fa-floppy-disk"></i></span>
            <div class="settings-card-titles">
              <h3>Data &amp; Portability</h3>
              <p>Back up or move your configuration.</p>
            </div>
          </header>
          <div class="settings-card-body">
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              <button class="cache-export-btn" style="padding: 8px 16px;" onclick={async () => { try { const p = await invoke<string>("export_config"); saveMessage = `Exported to ${p}`; setTimeout(() => { saveMessage = ""; }, 4000); } catch (e: any) { if (!String(e).includes("cancelled")) saveMessage = `Export failed: ${e}`; } }}>
                  <i class="fa-solid fa-file-export" style="margin-right: 4px;"></i> Export Settings
              </button>
              <button class="cache-export-btn" style="padding: 8px 16px;" onclick={async () => { try { await invoke("import_config"); await loadConfig(); saveMessage = "Settings imported!"; setTimeout(() => { saveMessage = ""; }, 4000); } catch (e: any) { if (!String(e).includes("cancelled")) saveMessage = `Import failed: ${e}`; } }}>
                  <i class="fa-solid fa-file-import" style="margin-right: 4px;"></i> Import Settings
              </button>
              <button class="cache-export-btn" style="padding: 8px 16px;" onclick={async () => { try { await invoke("open_settings_folder"); } catch (e: any) { saveMessage = `Couldn't open folder: ${e}`; } }}>
                  <i class="fa-solid fa-folder-open" style="margin-right: 4px;"></i> Open Settings Folder
              </button>
            </div>
            <span style="font-size: 10px; color: var(--text-muted); display: block; margin-top: 6px;">Exports all config + saved sessions/folders to a JSON file (portable backup). Import replaces current settings.</span>
          </div>
        </section>

        <!-- ─── CARD: Window ─── -->
        <section class="settings-card">
          <header class="settings-card-head">
            <span class="settings-card-icon"><i class="fa-solid fa-window-restore"></i></span>
            <div class="settings-card-titles">
              <h3>Window</h3>
              <p>Size, position, and tray behavior.</p>
            </div>
          </header>
          <div class="settings-card-body">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
              <span style="font-size: 11px; color: var(--text-muted);">Your last window size and position are remembered across restarts.</span>
              <button class="cache-export-btn" style="padding: 6px 14px;" onclick={async () => {
                try {
                  await invoke('reset_window_state');
                  saveMessage = 'Window size/position reset to default';
                  setTimeout(() => { saveMessage = ''; }, 4000);
                } catch (e: any) {
                  saveMessage = `Reset failed: ${e}`;
                }
              }}>
                <i class="fa-solid fa-rotate-left" style="margin-right: 4px;"></i> Reset saved window size/position
              </button>
            </div>
          </div>
        </section>

        <!-- ─── CARD: Version History & Patch Notes ─── -->
        <section class="settings-card">
          <header class="settings-card-head">
            <span class="settings-card-icon"><i class="fa-solid fa-clock-rotate-left"></i></span>
            <div class="settings-card-titles">
              <h3>Version History</h3>
              <p>Review release notes and feature logs.</p>
            </div>
          </header>
          <div class="settings-card-body" style="display: flex; flex-direction: column; gap: 14px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px;">
              <span style="font-size: 11px; color: var(--text-muted);">Select an installed or past release version to read its patch notes.</span>
              <div class="version-select-wrapper" style="position: relative; display: inline-block;">
                <select 
                  class="version-select-dropdown" 
                  bind:value={selectedPatchNotesVersion}
                  style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 6px 28px 6px 12px; color: var(--text); font-size: 12px; outline: none; cursor: pointer; appearance: none;"
                >
                  {#each PATCH_NOTES_DATA as p}
                    <option value={p.version} style="background: #1a1a24; color: white;">v{p.version}</option>
                  {/each}
                </select>
                <span class="dropdown-chevron-arrow" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 9px; color: rgba(255,255,255,0.4); pointer-events: none;">▼</span>
              </div>
            </div>

            {#if PATCH_NOTES_DATA.find(p => p.version === selectedPatchNotesVersion)}
              {@const viewNotes = PATCH_NOTES_DATA.find(p => p.version === selectedPatchNotesVersion)}
              {#if viewNotes}
                <div class="version-history-box scrollbar-custom" style="max-height: 250px; overflow-y: auto; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 16px;">
                  <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 8px; margin-bottom: 4px;">
                    <strong style="font-size: 13px; color: var(--text);">Portal Protocol v{viewNotes.version}</strong>
                    <span style="font-size: 10px; color: var(--text-muted); float: right; margin-top: 3px;">Released on {viewNotes.date}</span>
                  </div>
                  {#if viewNotes.image}
                    <img src={viewNotes.image} alt="Patch screenshot" style="width: 100%; max-height: 320px; object-fit: contain; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.3); margin-bottom: 4px;" />
                  {/if}
                  {#each viewNotes.notes as category}
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                      <div style="font-size: 11px; font-weight: 700; color: var(--accent); letter-spacing: 0.05em; text-transform: uppercase;">{category.category}</div>
                      <ul style="list-style: none; margin: 0; padding: 0 0 0 4px; display: flex; flex-direction: column; gap: 6px;">
                        {#each category.items as item}
                          <li style="font-size: 11px; line-height: 1.5; color: rgba(255,255,255,0.8);">
                            <strong style="color: var(--text);">{item.title}:</strong> {item.desc}
                          </li>
                        {/each}
                      </ul>
                    </div>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>
        </section>
        <div class="form-actions">
          <button class="cache-export-btn" style="padding: 8px 24px;" onclick={saveConfig}>
            <i class="fa-solid fa-floppy-disk" style="margin-right: 4px;"></i> Save Settings
          </button>
          <button class="cache-export-btn" style="padding: 8px 16px;" onclick={() => checkForUpdate(false)} disabled={updateChecking}>
            <i class="fa-solid fa-arrow-up-from-bracket" style="margin-right: 4px;"></i> Check for updates
          </button>
          {#if saveMessage}
            <span class="save-msg" style="color: #34d399; font-size: 11px; animation: fadeIn 0.2s;">{saveMessage}</span>
          {/if}
          <span style="font-size: 10px; color: var(--text-muted);">
            Installed: <strong style="color: var(--text);">v{appVersion}</strong>{#if updateAvailable} · Latest: <strong style="color: #34d399;">v{updateAvailable.version}</strong>{/if}
          </span>
        </div>
      </div>
      </div>
    {:else if activeTab === "folders"}
      <div style="display: flex; flex-direction: column; gap: inherit; min-height: 100%;" in:fly={{ y: 6, duration: prefersReducedMotion ? 0 : 200 }} out:fade={{ duration: prefersReducedMotion ? 0 : 150 }}>
        <div class="folders-view">
        <div class="feed-header-row" style="margin-bottom: 16px;">
          <div>
            <h2 class="feed-title" style="display: flex; align-items: center; gap: 8px;">
              <i class="fa-solid fa-folder" style="color: var(--accent);"></i> Folders
            </h2>
            <p class="feed-subtitle">Organize your logs into folders. Click a card to open it.</p>
          </div>
          <button class="action-btn btn-new" onclick={() => { editFolderId = null; newSessionName = ""; newSessionColor = "#14b8a6"; newFolderModalOpen = true; }} style="display: inline-flex; align-items: center; gap: 6px;">
            <i class="fa-solid fa-folder-plus"></i> New Folder
          </button>
        </div>

        {#if sessions.length === 0}
          <div class="empty-state card" style="margin-top: 12px;">
            <div class="empty-icon"><i class="fa-solid fa-folder-open"></i></div>
            <h3>No folders yet</h3>
            <p>Create a folder to organize raid-night or training logs. You can also use "Save to Folder" from any log in the Uploads Feed.</p>
          </div>
        {:else}
          <div class="folders-grid">
            {#each sessions as session (session.id)}
              <div class="folder-card" style="--folder-color: {swatchHex(session.color)};">
                <span class="folder-accent"></span>
                <button class="folder-card-open" onclick={() => { activeSessionId = session.id; subFolderId = null; activeTab = "session"; }}>
                  <span class="folder-card-icon"><i class="fa-solid fa-folder"></i></span>
                  <span class="folder-card-name">{session.name}</span>
                  <span class="folder-card-meta">
                    <span class="folder-card-count">{sessionTotalLogs(session)} {sessionTotalLogs(session) === 1 ? "log" : "logs"}</span>
                    {#if (session.subfolders ?? []).length > 0}
                      <span class="folder-card-subchip">{(session.subfolders ?? []).length} sub{(session.subfolders ?? []).length === 1 ? "" : "s"}</span>
                    {/if}
                  </span>
                  <span class="folder-card-last">Last log: {formatSessionLast(sessionLastLog(session))}</span>
                </button>
                <div class="folder-card-actions">
                  <button class="folder-card-action" title="Edit Folder" onclick={() => openEditFolder(session.id)}>
                    <i class="fa-solid fa-pen"></i>
                  </button>
                  <button class="folder-card-action danger" title="Delete" onclick={() => openConfirm(`Delete folder "${session.name}"?`, `All ${sessionTotalLogs(session)} logs in it (including subfolders) will be removed.`, () => deleteSession(session.id))}>
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
      </div>
    {:else if activeTab === "session"}
      {@const activeSession = sessions.find(s => s.id === activeSessionId)}
      {#if activeSession}
        <div style="display: flex; flex-direction: column; gap: inherit; min-height: 100%;" in:fly={{ y: 6, duration: prefersReducedMotion ? 0 : 200 }} out:fade={{ duration: prefersReducedMotion ? 0 : 150 }}>
          <div class="feed-header-row" style="margin-bottom: 8px;">
          <div>
            <h2 class="feed-title" style="display: flex; align-items: center; gap: 8px;">
              <svg class="folder-svg-icon" style="color: {swatchHex(activeSession.color)}; width: 20px; height: 20px;" viewBox="0 0 20 20" fill="currentColor">

                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              {activeSession.name}
            </h2>
            <FilterBar
              {filters}
              bosses={distinctBossOptions(sessionDisplayPool(activeSession))}
              vlRanks={vlCatalog.flatMap(e => e.ranks.map(r => ({ id: r.id, label: r.label, icon: r.icon })))}
              professions={PROFESSION_OPTIONS}
              professionGroups={PROFESSION_GROUPS}
              showCounts={true}
              resultCount={getFilteredSessionLogs(activeSession).length}
              totalCount={sessionDisplayPool(activeSession).length}
            />
            <button class="action-btn btn-delete" onclick={() => copyAllLinks(getFilteredSessionLogs(activeSession))} title="Copy every uploaded link in this folder">
              <i class="fa-solid fa-copy" style="margin-right: 4px;"></i> Copy All Links
            </button>
            <div class="subfolder-tabs" bind:this={subfolderTabsEl}>
              <span class="subfolder-underline" class:visible={subfolderIndicator.visible} style="left: {subfolderIndicator.left}px; top: {subfolderIndicator.top}px; width: {subfolderIndicator.width}px;"></span>
              <button class="filter-btn tab" class:active={subFolderId === null} onclick={() => subFolderId = null}><i class="fa-solid fa-folder" style="margin-right: 5px; color: var(--text-muted);"></i>Main Folder</button>
              {#each (activeSession.subfolders ?? []).filter(sf => !hasActiveFilter() || filterLogs(sf.logs).length > 0) as sf (sf.id)}
                <div class="subfolder-tab" class:active={subFolderId === sf.id} class:new-pulse={creatingSubFolderId === sf.id} out:fly={{ duration: prefersReducedMotion ? 0 : 150, y: -6 }}>
                  <button class="tab-label" onclick={() => subFolderId = sf.id} ondblclick={(e) => { e.stopPropagation(); renamingSubFolderId = sf.id; renameSubFolderValue = sf.name; }}>
                    <i class="fa-solid fa-folder folder-glyph" style="color: {swatchHex(sf.color)};"></i>
                    {#if renamingSubFolderId === sf.id}
                      <input class="tab-rename-input" bind:value={renameSubFolderValue} onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') renameSubFolder(activeSession.id, sf.id, renameSubFolderValue); if (e.key === 'Escape') { renamingSubFolderId = null; renameSubFolderValue = ''; } }} onblur={() => renameSubFolder(activeSession.id, sf.id, renameSubFolderValue)} />
                    {:else}
                      {sf.name}
                    {/if}
                    <span class="tab-count">{sf.logs.length}</span>
                  </button>
                  <button class="tab-delete" title="Delete subfolder" onclick={(e) => { e.stopPropagation(); pendingDeleteSubFolder = { sessionId: activeSession.id, subFolderId: sf.id, name: sf.name }; showConfirmDelete = true; }}>
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                </div>
              {/each}
              <button class="add-session-icon-btn btn-neutral" title="Create Subfolder" onclick={() => { isCreatingSubFolder = true; newSubFolderName = ''; newSubFolderColor = '#14b8a6'; }} style="font-size: 11px; padding: 2px 6px;">➕ Subfolder</button>
            </div>
          </div>
        </div>

        {#if selectedLogs.size > 0}
          <div class="copy-toolbar" style="position: sticky; top: 0; z-index: 10; margin: 0 0 16px 0; border: 1px solid rgba(99, 102, 241, 0.25); background: rgba(15, 16, 28, 0.95); backdrop-filter: blur(8px);">
            <span class="copy-count">{selectedLogs.size} log{selectedLogs.size > 1 ? 's' : ''} selected</span>
            <button class="btn btn-copy" onclick={() => copySelectedLinks(getFilteredSessionLogs(activeSession))} title="Copy links for the selected logs">
              <i class="fa-solid fa-copy" style="margin-right: 4px;"></i> Copy Selected Links
            </button>
            <button class="btn btn-move" onclick={() => moveSelectedToFolder(getFilteredSessionLogs(activeSession))} title="Move selected logs into a subfolder">
              <i class="fa-solid fa-folder-plus" style="margin-right: 4px;"></i> Move to Subfolder
            </button>
            <button class="btn btn-discord" onclick={() => showFormatterPanel = !showFormatterPanel}>
              <i class="fa-solid fa-wand-magic-sparkles" style="margin-right: 4px;"></i> Log Formatter
            </button>
            <button class="btn btn-clear" onclick={() => { selectedLogs = new Set(); showFormatterPanel = false; }}>
              <i class="fa-solid fa-xmark" style="margin-right: 4px;"></i> Close
            </button>
          </div>
        {/if}

        <div style="display: flex; gap: 20px; align-items: flex-start; width: 100%;">
          <div style="flex: {showFormatterPanel ? '0 0 65%' : '1 1 100%'}; min-width: 0;">
            {#if getFilteredSessionLogs(activeSession).length === 0}
              <div class="empty-state card" style="margin-top: 12px;">
                <div class="empty-icon"><i class="fa-solid fa-folder-open"></i></div>
                <h3>No logs in this folder yet</h3>
                <p>Drag .evtc/.zevtc files here or use <strong>Save to Session</strong> from the Uploads Feed to file them here.</p>
              </div>
            {:else}
              {@render recordsListRenderer(groupLogsForSession(getFilteredSessionLogs(activeSession)), subFolderId, activeSession)}
            {/if}
          </div>
          {#if showFormatterPanel}
            <!-- formatter panel (same as Feed) -->
            <div class="formatter-sidebar-panel" style="flex: 0 0 35%; max-width: 35%; background: #10111a; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 16px; position: sticky; top: 0; display: flex; flex-direction: column; gap: 14px; box-sizing: border-box; max-height: calc(100vh - 90px); overflow-y: auto;">
              <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 8px;">
                <h3 style="margin: 0; font-size: 13px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 6px;">✍️ Smart Formatter</h3>
                <p style="margin: 3px 0 0 0; font-size: 10px; color: var(--text-muted);">Format combat log links for Discord share</p>
              </div>
              <div style="display: flex; flex-direction: column; gap: 5px;">
                <span style="font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.6);">Custom Header Text</span>
                <textarea placeholder="e.g. Raid night logs! @everyone..." bind:value={customFormatterHeader} style="width: 100%; height: 50px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #fff; padding: 6px 10px; font-size: 11px; resize: none; font-family: sans-serif; box-sizing: border-box; outline: none; transition: border-color 0.15s;"></textarea>
              </div>
              <div style="display: flex; flex-direction: column; gap: 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); padding: 10px; border-radius: 8px;">
                <span style="font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.4); margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px;">Include Info</span>
                <label style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.8); cursor: pointer;">
                  <span>Show Victory / Failure Results</span>
                  <input type="checkbox" bind:checked={formatterIncludeResults} onclick={() => { formatterKey++; }} style="accent-color: var(--accent); cursor: pointer;"/>
                </label>
                {#if hasConvergenceSelected}
                <label style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.8); cursor: pointer;">
                  <span>Add Total Convergence Time</span>
                  <input type="checkbox" bind:checked={formatterIncludeConvTime} onclick={() => { formatterKey++; }} style="accent-color: var(--accent); cursor: pointer;"/>
                </label>
                {/if}
                <label style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.8); cursor: pointer;">
                  <span>Add Boss Time</span>
                  <input type="checkbox" bind:checked={formatterIncludeBossTime} onclick={() => { formatterKey++; }} style="accent-color: var(--accent); cursor: pointer;"/>
                </label>
                <label style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.8); cursor: pointer;">
                  <span>Show Dates</span>
                  <input type="checkbox" bind:checked={formatterIncludeDates} onclick={() => { formatterKey++; }} style="accent-color: var(--accent); cursor: pointer;"/>
                </label>
                <label style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.8); cursor: pointer;">
                  <span>Show Spec Compositions</span>
                  <input type="checkbox" bind:checked={formatterIncludeSpecs} onclick={() => { formatterKey++; }} style="accent-color: var(--accent); cursor: pointer;"/>
                </label>
                <label style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.8); cursor: pointer;">
                  <span>Best Pull (lowest HP left)</span>
                  <input type="checkbox" bind:checked={formatterIncludeBestPull} onclick={() => { formatterKey++; }} style="accent-color: var(--accent); cursor: pointer;"/>
                </label>
              </div>
              <div style="display: flex; flex-direction: column; gap: 5px; flex: 1; min-height: 150px;">
                <span style="font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.6); display: flex; justify-content: space-between; align-items: center;">
                  <span>Live Discord Format Preview (Editable ✍️)</span>
                  <button type="button" onclick={resetFormatterText} style="background: none; border: none; color: var(--accent); font-size: 9px; cursor: pointer; padding: 0;" title="Reset edits to match settings above">Reset Edits</button>
                </span>
                <textarea bind:value={liveFormattedText} oninput={(e) => { manualEdit = (e.currentTarget as HTMLTextAreaElement).value; }} style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 10px; font-family: monospace; font-size: 10.5px; color: #a78bfa; height: 180px; resize: none; overflow-y: auto; margin: 0; box-sizing: border-box; outline: none; width: 100%;"></textarea>
              </div>
              <button class="creator-btn save" onclick={copyFormatterTextToClipboard} style="width: 100%; padding: 8px; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; border: none; border-radius: 6px; background: var(--accent); color: #fff; transition: background 0.15s;">
                <i class="fa-solid fa-copy"></i> Copy Formatted Logs
              </button>
              <div style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 10px; font-weight: 600; {formatterOverLimit ? 'color: #f87171;' : 'color: rgba(255,255,255,0.45);'}">
                <span>{formatterCharCount} / {DISCORD_CHAR_LIMIT} chars</span>
                {#if formatterOverLimit}
                  <span style="color: #f87171;">⚠ Exceeds Discord's 2000-char limit — paste will prompt for a .txt file. Toggle off Dates/Specs or split the batch.</span>
                {/if}
              </div>
              {#if formatterCopyFeedback}
              <div style="margin-top: 8px; text-align: center; font-size: 11px; font-weight: 600; color: #4ade80; opacity: 1; transition: opacity 0.3s ease;">✓ Info Copied</div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
      {/if}
    {/if}
  </section>
  <!-- ─── Bottom API Health Status Bar ─── -->
  <footer class="app-status-bar">
    <div class="sb-item" title="File watcher status">
      <span class="status-dot {auto_upload ? 'online' : 'offline'}"></span>
      <span class="sb-label">{auto_upload ? 'Watcher Active' : 'Watcher Inactive'}</span>
    </div>
    <button class="sb-path" title="Open folder in File Explorer" onpointerdown={() => openPathInExplorer(logs_directory)}>
      {logs_directory || 'No folder configured'}
    </button>

    <div class="sb-divider"></div>

    <!-- dps.report -->
    <div class="sb-item" title="Checking upload API health at https://dps.report/uploadContent">
      <span class="status-dot {dpsReportStatus === 'online' ? 'online' : dpsReportStatus === 'offline' ? 'offline' : dpsReportStatus === 'outage_dps' ? 'offline' : dpsReportStatus.startsWith('degraded_') ? 'degraded' : 'checking'}"></span>
      <span class="sb-label">dps.report</span>
      <span class="sb-badge {dpsReportStatus === 'online' ? 'ok' : dpsReportStatus.startsWith('degraded_') ? 'warn' : dpsReportStatus === 'checking' ? 'muted' : 'err'}">
        {#if dpsReportStatus === 'online'}Online
        {:else if dpsReportStatus === 'outage_dps'}Outage
        {:else if dpsReportStatus.startsWith('degraded_')}Degraded
        {:else if dpsReportStatus === 'offline'}Offline
        {:else}…{/if}
      </span>
    </div>

    <!-- b.dps.report (only when primary is down) -->
    {#if dpsReportStatus !== 'online'}
    <div class="sb-divider"></div>
    <div class="sb-item" title="Fallback API: b.dps.report">
      <span class="status-dot {bDpsReportStatus === 'online' ? 'online' : bDpsReportStatus === 'offline' ? 'offline' : bDpsReportStatus.startsWith('degraded_') ? 'degraded' : 'checking'}"></span>
      <span class="sb-label">b.dps.report</span>
      <span class="sb-badge {bDpsReportStatus === 'online' ? 'ok' : bDpsReportStatus.startsWith('degraded_') ? 'warn' : 'err'}">
        {#if bDpsReportStatus === 'online'}Online
        {:else if bDpsReportStatus.startsWith('degraded_')}Degraded
        {:else if bDpsReportStatus === 'offline'}Down
        {:else}…{/if}
      </span>
    </div>
    {/if}

    <div class="sb-divider"></div>

    <!-- Wingman -->
    <div class="sb-item" title="Checking upload API health at https://gw2wingman.com/runupload">
      <span class="status-dot {wingmanStatus === 'online' ? 'online' : wingmanStatus === 'offline' ? 'offline' : wingmanStatus === 'degraded' ? 'degraded' : 'checking'}"></span>
      <span class="sb-label">Wingman</span>
      <span class="sb-badge {wingmanStatus === 'online' ? 'ok' : wingmanStatus === 'degraded' ? 'warn' : wingmanStatus === 'unknown' ? 'muted' : 'err'}">
        {#if wingmanStatus === 'online'}Online
        {:else if wingmanStatus === 'degraded'}Degraded
        {:else if wingmanStatus === 'offline'}Down
        {:else}…{/if}
      </span>
    </div>

    <!-- Right-aligned: queue info + retry buttons -->
    <div class="sb-right">
      {#if uploadQueue.length > 0 || uploadPaused}
        <button
          class="sb-queue-pill upload-queue-pill"
          class:queue-pulsing={queuePulse && !queueDrawerOpen}
          class:queue-paused={uploadPaused}
          title={uploadPaused ? 'Paused — click body to resume · click arrow to view queue' : 'Click body to pause · click arrow to view queue'}
          onclick={togglePauseUploads}
          oncontextmenu={(e) => { e.preventDefault(); queueDrawerOpen = !queueDrawerOpen; }}
        >
          {#if uploadPaused}
            <i class="fa-solid fa-pause sb-pause"></i> Paused
          {:else}
            <i class="fa-solid fa-layer-group"></i> {activeCount} active
          {/if}
          {#if queuedCount > 0}<span class="sb-queue-count">{queuedCount} queued</span>{/if}
          <i
            class="fa-solid fa-chevron-up sb-chevron"
            class:open={queueDrawerOpen}
            role="button"
            tabindex="0"
            title="Show upload queue"
            onclick={(e) => { e.stopPropagation(); queueDrawerOpen = !queueDrawerOpen; }}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); queueDrawerOpen = !queueDrawerOpen; } }}
          ></i>
        </button>

        {#if queueDrawerOpen}
          <div class="queue-drawer" transition:fly={{ y: 8, duration: prefersReducedMotion ? 0 : 180 }}>
            <div class="queue-drawer-head">
              <span>Upload Queue</span>
              <span class="queue-drawer-meta">{activeCount} active · {queuedCount} queued · {doneCount} done · {skippedCount} skipped</span>
            </div>
            <div class="queue-drawer-list">
              {#each uploadQueue as q (q.file_path)}
                <div class="queue-row queue-{q.state}" transition:fly={{ x: -8, duration: prefersReducedMotion ? 0 : 150 }}>
                  <i class="fa-solid {q.state === 'active' ? 'fa-spinner fa-spin' : q.state === 'done' ? 'fa-check' : q.state === 'skipped' ? 'fa-ban' : 'fa-clock'} queue-row-icon"></i>
                  <span class="queue-row-name" title={q.file_name}>{q.file_name}</span>
                  <span class="queue-row-state">{q.state === 'active' ? 'Uploading' : q.state === 'done' ? 'Done' : q.state === 'skipped' ? 'Skipped' : 'Queued'}</span>
                </div>
              {/each}
            </div>
            <button class="queue-drawer-pause" onclick={togglePauseUploads}>
              {uploadPaused ? '▶ Resume Uploads' : '⏸ Pause Uploads'}
            </button>
          </div>
        {/if}
      {/if}

      {#if dpsQueue.length > 0 || dpsQueueRunning}
        <span class="sb-queue-pill">
          <i class="fa-solid fa-rotate sb-spin"></i>
          dps.report re-upload {dpsQueueRunning ? `${dpsQueueDone}/${dpsQueueDone + dpsQueue.length}` : dpsQueue.length}
        </span>
      {:else if onHoldCount > 0 && !dpsQueueRunning && dpsQueue.length === 0}
        <button class="sb-retry-btn" onclick={retryOnHoldLogs} disabled={dpsReportStatus !== 'online'}
          title={dpsReportStatus === 'online' ? 'Re-upload all On Hold logs now.' : 'dps.report offline — retry paused'}>
          <i class="fa-solid fa-rotate-right"></i> Retry On Hold ({onHoldCount})
        </button>
      {/if}
      {#if wingmanQueue.length > 0 || wingmanQueueRunning}
        <span class="sb-queue-pill">
          <i class="fa-solid fa-rotate sb-spin"></i>
          Wingman retry {wingmanQueueRunning ? `${wingmanQueueDone}/${wingmanQueueDone + wingmanQueue.length}` : wingmanQueue.length}
        </span>
      {:else if failedWingmanCount > 0 && !wingmanQueueRunning && wingmanQueue.length === 0}
        <button class="sb-retry-btn" onclick={retryAllFailedWingman} disabled={wingmanStatus === 'offline'}
          title={wingmanStatus === 'offline' ? 'Wingman down — retry will resume when it recovers.' : 'Re-send all failed Wingman imports now.'}>
          <i class="fa-solid fa-rotate-right"></i> Retry Wingman ({failedWingmanCount})
        </button>
      {/if}
    </div>
  </footer>
</main>

{#if activeReplayUrl}
  <div class="replay-modal-overlay" role="button" tabindex="0" aria-label="Close replay" onclick={(e) => { if (e.target === e.currentTarget) closeReplayModal(); }} onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') closeReplayModal(); }}>
    <div class="replay-modal">
      <div class="replay-modal-header">
        <span class="replay-modal-title"><i class="fa-solid fa-gamepad" style="margin-right:6px;"></i>2D Replay</span>
        <div class="replay-modal-controls">
          <div class="custom-tooltip-container">
            <button class="replay-ctrl-btn" title="" aria-label="Zoom out" onclick={() => zoomLevel = Math.max(0.3, +(zoomLevel - 0.1).toFixed(2))}><i class="fa-solid fa-magnifying-glass-minus"></i></button>
            <div class="custom-tooltip">Zoom out</div>
          </div>
          <span class="replay-zoom-label">{Math.round(zoomLevel * 100)}%</span>
          <div class="custom-tooltip-container">
            <button class="replay-ctrl-btn" title="" aria-label="Zoom in" onclick={() => zoomLevel = Math.min(2.5, +(zoomLevel + 0.1).toFixed(2))}><i class="fa-solid fa-magnifying-glass-plus"></i></button>
            <div class="custom-tooltip">Zoom in</div>
          </div>
          <div class="custom-tooltip-container">
            <button class="replay-ctrl-btn" title="" aria-label="Open in browser" onclick={() => { if (activeReplayUrl) openExternalUrl(activeReplayUrl); }}><i class="fa-solid fa-arrow-up-right-from-square"></i></button>
            <div class="custom-tooltip">Open in browser</div>
          </div>
          <div class="custom-tooltip-container" style="cursor: pointer;">
            <button class="replay-ctrl-btn close" title="" aria-label="Close" onclick={closeReplayModal}><i class="fa-solid fa-xmark"></i></button>
            <div class="custom-tooltip">Close</div>
          </div>
        </div>
      </div>
      <div class="replay-modal-body">
        {#if isIframeLoading}
          <div class="replay-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading replay…</div>
        {/if}
        <iframe
          src={activeReplayUrl}
          title="dps.report 2D Replay"
          class="replay-iframe"
          style="zoom: {zoomLevel};"
          onload={() => isIframeLoading = false}
        ></iframe>
      </div>
    </div>
  </div>
{/if}

{#if confirmDialog}
  <div class="confirm-modal-overlay" role="button" tabindex="0" aria-label="Cancel" onclick={(e) => { if (e.target === e.currentTarget) closeConfirm(); }} onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') closeConfirm(); }}>
    <div class="confirm-modal">
      <div class="confirm-modal-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <h3 class="confirm-modal-title">{confirmDialog.title}</h3>
      <p class="confirm-modal-message">{confirmDialog.message}</p>
      <div class="confirm-modal-actions">
        <button class="creator-btn cancel" onclick={closeConfirm}>Cancel</button>
        <button class="creator-btn save confirm-danger" onclick={() => { confirmDialog?.onConfirm(); closeConfirm(); }}>Delete</button>
      </div>
    </div>
  </div>
{/if}

{#if showConfirmDelete && pendingDeleteSubFolder}
  <div class="confirm-modal-overlay" role="button" tabindex="0" aria-label="Cancel" onclick={(e) => { if (e.target === e.currentTarget) showConfirmDelete = false; }} onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') showConfirmDelete = false; }}>
    <div class="confirm-modal">
      <div class="confirm-modal-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <h3 class="confirm-modal-title">Delete subfolder "{pendingDeleteSubFolder.name}"?</h3>
      <p class="confirm-modal-message">Its logs move back to Main Folder.</p>
      <div class="confirm-modal-actions">
        <button class="creator-btn cancel" onclick={() => showConfirmDelete = false}>Cancel</button>
        <button class="creator-btn save confirm-danger" onclick={() => {
          deletingSubFolderId = pendingDeleteSubFolder!.subFolderId;
          const sid = pendingDeleteSubFolder!.subFolderId;
          const ssid = pendingDeleteSubFolder!.sessionId;
          showConfirmDelete = false;
          pendingDeleteSubFolder = null;
          setTimeout(() => { deleteSubFolder(ssid, sid); }, 150);
        }}>Delete</button>
      </div>
    </div>
  </div>
{/if}

{#if showConfirmDelete && pendingDeleteSubFolder}
  <div class="confirm-modal-overlay" role="button" tabindex="0" aria-label="Cancel" onclick={(e) => { if (e.target === e.currentTarget) showConfirmDelete = false; }} onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') showConfirmDelete = false; }}>
    <div class="confirm-modal">
      <div class="confirm-modal-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <h3 class="confirm-modal-title">Delete subfolder "{pendingDeleteSubFolder.name}"?</h3>
      <p class="confirm-modal-message">Its logs move back to Main Folder.</p>
      <div class="confirm-modal-actions">
        <button class="creator-btn cancel" onclick={() => showConfirmDelete = false}>Cancel</button>
        <button class="creator-btn save confirm-danger" onclick={() => {
          deletingSubFolderId = pendingDeleteSubFolder!.subFolderId;
          const sid = pendingDeleteSubFolder!.subFolderId;
          const ssid = pendingDeleteSubFolder!.sessionId;
          showConfirmDelete = false;
          pendingDeleteSubFolder = null;
          setTimeout(() => { deleteSubFolder(ssid, sid); }, 150);
        }}>Delete</button>
      </div>
    </div>
  </div>
{/if}

{#if isCreatingSubFolder && activeSession}
  <div class="subfolder-modal-overlay" role="button" tabindex="0" aria-label="Cancel" onclick={(e) => { if (e.target === e.currentTarget) { isCreatingSubFolder = false; newSubFolderName = ''; } }} onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') { isCreatingSubFolder = false; newSubFolderName = ''; } }}>
    <div class="subfolder-modal" role="dialog" aria-modal="true">
      <div class="subfolder-modal-head">
        <div class="subfolder-modal-title"><i class="fa-solid fa-folder-plus"></i> New Subfolder</div>
        <button class="subfolder-modal-close" onclick={() => { isCreatingSubFolder = false; newSubFolderName = ''; }} aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <label class="sf-field-label" for="sf-name-input">Name</label>
      <input
        id="sf-name-input"
        class="sf-name-input"
        type="text"
        placeholder="Subfolder name..."
        bind:value={newSubFolderName}
        onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') createSubFolder(activeSession.id, newSubFolderName, newSubFolderColor); if (e.key === 'Escape') { isCreatingSubFolder = false; newSubFolderName = ''; } }}
        use:focusOnMount
      />

      <span class="sf-field-label" role="group" aria-label="Subfolder color">Color</span>
      <div class="sf-swatches">
        {#each FOLDER_PALETTE as p}
          <button
            class="sf-swatch"
            class:selected={newSubFolderColor === p.hex}
            aria-label={`Use ${p.name}`}
            title={p.name}
            style={`background:${p.hex};`}
            onclick={() => newSubFolderColor = p.hex}
          ></button>
        {/each}
      </div>
      <div class="sf-custom-color">
        <input
          type="color"
          class="sf-color-input"
          aria-label="Custom color"
          value={newSubFolderColor}
          oninput={(e) => { newSubFolderColor = (e.currentTarget as HTMLInputElement).value; }}
        />
        <span class="sf-custom-label">Custom</span>
        <span class="sf-custom-hex">{newSubFolderColor.toUpperCase()}</span>
      </div>

      <div class="sf-preview">
        <span class="sf-preview-label">Preview</span>
        <span class="subfolder-tab" style="pointer-events: none;">
          <button class="tab-label">
            <i class="fa-solid fa-folder folder-glyph" style="color: {swatchHex(newSubFolderColor)};"></i>
            {newSubFolderName.trim() || 'New Subfolder'}
            <span class="tab-count">0</span>
          </button>
        </span>
      </div>

      <div class="subfolder-modal-actions">
        <button class="creator-btn cancel btn-neutral" onclick={() => { isCreatingSubFolder = false; newSubFolderName = ''; }}>Cancel</button>
        <button class="creator-btn save" disabled={!newSubFolderName.trim()} onclick={() => createSubFolder(activeSession.id, newSubFolderName, newSubFolderColor)}>Create</button>
      </div>
    </div>
  </div>
{/if}

{#if newFolderModalOpen}
  <div class="subfolder-modal-overlay" role="button" tabindex="0" aria-label="Cancel" onclick={(e) => { if (e.target === e.currentTarget) { newFolderModalOpen = false; editFolderId = null; } }} onkeydown={(e) => { if (e.key === 'Escape') { newFolderModalOpen = false; editFolderId = null; } }}>
    <div class="subfolder-modal" role="dialog" aria-modal="true">
      <div class="subfolder-modal-head">
        <div class="subfolder-modal-title">
          <i class="fa-solid {editFolderId ? 'fa-pen-to-square' : 'fa-folder-plus'}"></i>
          {editFolderId ? 'Edit Folder' : 'New Folder'}
        </div>
        <button class="subfolder-modal-close" onclick={() => { newFolderModalOpen = false; editFolderId = null; }} aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <label class="sf-field-label" for="folder-name-input">Name</label>
      {#if editFolderId}
        <input
          id="folder-name-input"
          class="sf-name-input"
          type="text"
          placeholder="Folder name..."
          bind:value={editFolderName}
          onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') applyEditFolder(); if (e.key === 'Escape') { newFolderModalOpen = false; editFolderId = null; } }}
          use:focusOnMount
        />
      {:else}
        <input
          id="folder-name-input"
          class="sf-name-input"
          type="text"
          placeholder="Folder name..."
          bind:value={newSessionName}
          onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') createSession(); if (e.key === 'Escape') { newFolderModalOpen = false; editFolderId = null; } }}
          use:focusOnMount
        />
      {/if}

      <span class="sf-field-label" role="group" aria-label="Folder color">Color</span>
      <div class="sf-swatches">
        {#each FOLDER_PALETTE as p}
          <button
            class="sf-swatch"
            class:selected={(editFolderId ? editFolderColor : newSessionColor) === p.hex}
            aria-label={`Use ${p.name}`}
            title={p.name}
            style={`background:${p.hex};`}
            onclick={() => { if (editFolderId) editFolderColor = p.hex; else newSessionColor = p.hex; }}
          ></button>
        {/each}
      </div>
      <div class="sf-custom-color">
        <input
          type="color"
          class="sf-color-input"
          aria-label="Custom color"
          value={editFolderId ? editFolderColor : newSessionColor}
          oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; if (editFolderId) editFolderColor = v; else newSessionColor = v; }}
        />
        <span class="sf-custom-label">Custom</span>
        <span class="sf-custom-hex">{(editFolderId ? editFolderColor : newSessionColor).toUpperCase()}</span>
      </div>

      <div class="sf-preview">
        <span class="sf-preview-label">Preview</span>
        <span class="folder-card" style="--folder-color: {swatchHex(editFolderId ? editFolderColor : newSessionColor)}; width: 100%; cursor: default;">
          <span class="folder-accent"></span>
          <span class="folder-card-icon" style="font-size: 18px;"><i class="fa-solid fa-folder"></i></span>
          <span class="folder-card-name" style="font-size: 13px;">{(editFolderId ? editFolderName : newSessionName).trim() || (editFolderId ? 'Folder name' : 'New Folder')}</span>
        </span>
      </div>

      <div class="subfolder-modal-actions">
        <button class="creator-btn cancel" onclick={() => { newFolderModalOpen = false; editFolderId = null; }}>Cancel</button>
        {#if editFolderId}
          <button class="creator-btn save" disabled={!editFolderName.trim()} onclick={applyEditFolder}>Save</button>
        {:else}
          <button class="creator-btn save" disabled={!newSessionName.trim()} onclick={createSession}>Create</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if pickerModal}
  {@const pm = pickerModal}
  <div class="picker-modal-overlay" role="button" tabindex="0" aria-label="Close" onclick={(e) => { if (e.target === e.currentTarget) { pickerModal = null; creatingNewFolderInPicker = false; } }} onkeydown={(e) => { if (e.key === 'Escape') { pickerModal = null; creatingNewFolderInPicker = false; } }}>
    <div class="picker-modal" role="dialog" aria-modal="true">
      <div class="picker-modal-head">
        <div class="picker-modal-title"><i class="fa-solid fa-folder-open"></i> {pm.title}</div>
        <button class="picker-modal-close" onclick={() => { pickerModal = null; creatingNewFolderInPicker = false; }} aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>

      {#if pm.logs.length > 1}
        <div class="picker-modal-sub">{pm.logs.length} logs selected</div>
      {:else if pm.logs[0]?.boss_name}
        <div class="picker-modal-sub">{pm.logs[0].boss_name}</div>
      {/if}

      <!-- End-Session only: rename + pick subfolder color before filing -->
      {#if pm.title === "File Session To…" && captureSession}
        <div class="session-meta-edit">
          <label class="session-meta-label" for="session-name-input">Subfolder name</label>
          <input
            id="session-name-input"
            class="session-name-input"
            bind:value={captureSession.name}
            placeholder="Session name…"
            maxlength="60"
          />
          <span class="session-meta-label">Color</span>
          <div class="color-picker-row">
            {#each FOLDER_PALETTE as p}
              <button
                class="color-dot-btn"
                class:selected={sessionColor === p.hex}
                aria-label={`Choose ${p.name}`}
                title={p.name}
                onclick={() => (sessionColor = p.hex)}
                style={`width: 18px; height: 18px; border-radius: 50%; border: ${sessionColor === p.hex ? '2px solid white' : 'none'}; cursor: pointer; background: ${p.hex};`}
              ></button>
            {/each}
            <input
              type="color"
              class="sf-color-input"
              aria-label="Custom color"
              value={sessionColor}
              oninput={(e) => { sessionColor = (e.currentTarget as HTMLInputElement).value; }}
              style="width:18px; height:18px; padding:0; border:none; background:none; cursor:pointer;"
            />
          </div>
        </div>
      {/if}

      <!-- Move flow: pick a target subfolder (or [Main Folder]) -->
      {#if pm.title.startsWith("Move")}
        {#if pm.excludeSubFolderId != null}
          <button class="picker-item" onclick={() => pm.onPick(null)}>
            📂 [Main Folder]
          </button>
        {/if}
        {#each sessions.find(s => s.id === pm.sessionId)?.subfolders ?? [] as sf}
          {#if sf.id !== pm.excludeSubFolderId}
            <button class="picker-item" onclick={() => pm.onPick(sf.id)}>
              <span class="folder-dot" style="color: {swatchHex(sf.color)};">●</span> {sf.name}
            </button>
          {/if}
        {/each}
      <!-- Save / End-Session flow: pick a destination Folder (or create one inline) -->
      {:else}
        {#if creatingNewFolderInPicker}
          <!-- Inline Create-Folder form (same modal surface) -->
          <div class="picker-create-folder">
            <label class="session-meta-label" for="picker-new-folder-name">Folder name</label>
            <input
              id="picker-new-folder-name"
              class="session-name-input"
              bind:value={newSessionName}
              placeholder="Folder name…"
              maxlength="32"
              onkeydown={(e) => { if (e.key === "Enter" && newSessionName.trim()) { const id = createSession(); creatingNewFolderInPicker = false; if (id) pm.onPick(id); } }}
            />
            <span class="session-meta-label">Color</span>
            <div class="color-picker-row">
              {#each FOLDER_PALETTE as p}
                <button
                  class="color-dot-btn"
                  class:selected={newSessionColor === p.hex}
                  aria-label={`Choose ${p.name}`}
                  title={p.name}
                  onclick={() => (newSessionColor = p.hex)}
                  style={`width: 18px; height: 18px; border-radius: 50%; border: ${newSessionColor === p.hex ? '2px solid white' : 'none'}; cursor: pointer; background: ${p.hex};`}
                ></button>
              {/each}
              <input
                type="color"
                class="sf-color-input"
                aria-label="Custom color"
                value={newSessionColor}
                oninput={(e) => { newSessionColor = (e.currentTarget as HTMLInputElement).value; }}
                style="width:18px; height:18px; padding:0; border:none; background:none; cursor:pointer;"
              />
            </div>
            <div class="picker-create-actions">
              <button
                class="creator-btn confirm"
                disabled={!newSessionName.trim()}
                onclick={() => { const id = createSession(); creatingNewFolderInPicker = false; if (id) pm.onPick(id); }}
              >Create</button>
              <button class="creator-btn cancel" onclick={() => { creatingNewFolderInPicker = false; newSessionName = ""; }}>Cancel</button>
            </div>
          </div>
        {:else if sessions.length === 0}
          <div class="picker-empty">No folders created yet.<br/>Create one below to file this session.</div>
          <button class="picker-item picker-create-btn" onclick={() => { creatingNewFolderInPicker = true; }}>
            <i class="fa-solid fa-folder-plus"></i> Create Folder
          </button>
        {:else}
          <button class="picker-item picker-create-btn" onclick={() => { creatingNewFolderInPicker = true; }}>
            <i class="fa-solid fa-folder-plus"></i> Create new folder
          </button>
          {#each sessions as s}
            <button class="picker-item" onclick={() => pm.onPick(s.id)}>
              <span class="folder-dot" style="color: {swatchHex(s.color)};">●</span> {s.name}
            </button>
          {/each}
        {/if}
      {/if}
    </div>
  </div>
{/if}

{#if vlModal}
  <div class="vl-modal-overlay" role="button" tabindex="0" aria-label="Close" onclick={(e) => { if (e.target === e.currentTarget) vlModal = null; }} onkeydown={(e) => { if (e.key === 'Escape') vlModal = null; }}>
    <div class="vl-modal">
      <div class="vl-modal-head">
        <div>
          <div class="vl-modal-title"><i class="fa-solid fa-medal"></i> Void Lounge Rank</div>
          <div class="vl-modal-sub">{vlModal.encounter.display}</div>
        </div>
        <button class="vl-modal-close" onclick={() => (vlModal = null)} aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="vl-rank-grid">
        {#each vlModal.encounter.ranks as rank}
          {@const selected = vlRanksOf(vlModal.log).includes(rank.id)}
          <button class="vl-rank-card" class:selected onclick={() => setVlRanks(rank.id, !selected)} style="--vl-text: {rank.text_color}; --vl-bg: {rank.bg_color};">
            <div class="vl-rank-card-top">
              <span class="vl-rank-icon">{rank.icon}</span>
              <span class="vl-rank-label">{rank.label}</span>
              {#if selected}<span class="vl-rank-check"><i class="fa-solid fa-circle-check"></i></span>{/if}
            </div>
            <p class="vl-rank-desc">{rank.description}</p>
            {#if rank.auto}<span class="vl-rank-auto">Auto-awarded on a successful {rank.auto === 'lcm' ? 'Legendary CM' : 'CM'} kill</span>{/if}
          </button>
        {/each}
      </div>
      {#if vlRanksOf(vlModal.log).length}
        <div class="vl-modal-foot">
          <button class="creator-btn cancel" onclick={() => { for (const id of vlRanksOf(vlModal?.log)) setVlRanks(id, false); }}>Clear all ranks</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if webhookLogOpen}
  <div class="confirm-modal-overlay" role="button" tabindex="0" aria-label="Close webhook log" onclick={(e) => { if (e.target === e.currentTarget) webhookLogOpen = false; }} onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') webhookLogOpen = false; }}>
    <div class="wh-log-modal" role="dialog" aria-modal="true" aria-label="Webhook delivery log" tabindex="-1">
      <div class="wh-log-head">
        <div class="wh-log-title">
          <span class="wh-log-icon"><i class="fa-solid fa-clipboard-list"></i></span>
          <div>
            <h3>Webhook Delivery Log</h3>
            <p class="wh-log-sub">Every delivery decision — why a log did or didn't post. Capped at the last 1000 entries.</p>
          </div>
        </div>
        <button class="wh-log-close" onclick={() => (webhookLogOpen = false)} aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      {#if webhookLogLoading}
        <div class="wh-log-empty">Loading…</div>
      {:else if webhookLogRows.length === 0}
        <div class="wh-log-empty">No webhook activity recorded yet. Upload a log (or hit Test) to populate this.</div>
      {:else}
        <div class="wh-log-table-wrap">
          <table class="wh-log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Webhook</th>
                <th>Boss</th>
                <th>Result</th>
                <th>Mode</th>
                <th>Evaluated</th>
                <th>Reason</th>
                <th>Delivered</th>
              </tr>
            </thead>
            <tbody>
              {#each webhookLogRows as row}
                <tr class:wh-row-skip={!row.evaluated}>
                  <td class="wh-cell-ts"><span class="wh-ts-dot"></span>{row.ts.split('.')[0].replace('T', ' ')}</td>
                  <td><span class="wh-pill wh-pill-wh">{row.webhook_label || row.webhook_id}</span></td>
                  <td class="wh-cell-boss">{row.boss || "—"}</td>
                  <td><span class="wh-pill {row.outcome === 'kill' ? 'wh-pill-kill' : row.outcome === 'wipe' ? 'wh-pill-wipe' : 'wh-pill-muted'}">{row.outcome || "—"}</span></td>
                  <td><span class="wh-pill wh-pill-mode">{row.mode || "—"}</span></td>
                  <td><span class="wh-pill {row.evaluated ? 'wh-yes' : 'wh-no'}">{row.evaluated ? "yes" : "no"}</span></td>
                  <td class="wh-cell-reason">{row.reason || "—"}</td>
                  <td>
                    {#if row.delivered === true}<span class="wh-deliv wh-deliv-ok"><i class="fa-solid fa-check"></i></span>
                    {:else if row.delivered === false}<span class="wh-deliv wh-deliv-bad"><i class="fa-solid fa-xmark"></i></span>
                    {:else}<span class="wh-deliv wh-deliv-na">—</span>{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if ctxMenu}
  <div class="ctx-menu" style="left:{ctxMenu.x}px; top:{ctxMenu.y}px;" role="menu">
    {#each ctxMenu.items as item}
      <button class="ctx-item {item.danger ? 'danger' : ''}" role="menuitem" onclick={() => { item.onSelect(); closeContextMenu(); }}>
        {#if item.icon}<i class="fa-solid {item.icon}"></i>{/if}
        {item.label}
      </button>
    {/each}
  </div>
{/if}

{#if editingPlan}
  <SquadPlannerModal
    plan={editingPlan}
    onSave={(p) => savePlan(p)}
    onCancel={() => { editingPlan = null; creatingPlan = false; }}
    encounterContext={inFolder ? resolveWingLabel(squadFolderStack[squadFolderStack.length - 1]?.encounterTag) : undefined}
  />
{/if}

{#if statsModal}
  <StatsModal
    permalink={statsModal.permalink}
    bossName={statsModal.bossName}
    localPath={statsModal.localPath}
    onClose={() => { statsModal = null; refreshCacheSize(); }}
  />
{/if}

{#if showClearCacheModal}
  <div
    class="confirm-modal-overlay"
    role="button"
    tabindex="0"
    aria-label="Close cache confirm modal"
    onclick={(e) => { if (e.target === e.currentTarget) showClearCacheModal = false; }}
    onkeydown={(e) => { if (e.key === 'Escape') showClearCacheModal = false; }}
  >
    <div class="confirm-modal-card" role="dialog" aria-modal="true" aria-label="Clear cache confirmation" tabindex="-1">
      <div class="confirm-modal-head">
        <span class="confirm-modal-icon danger"><i class="fa-solid fa-triangle-exclamation"></i></span>
        <div>
          <h3 class="confirm-modal-title">Clear Log JSON Cache?</h3>
          <p class="confirm-modal-sub">This action will delete {logCacheCount} cached log files ({formatSize(logCacheSize)}).</p>
        </div>
      </div>
      <div class="confirm-modal-body">
        <p>Log details are stored on your disk so the <strong>Stats</strong> button opens instantly. Clearing the cache will free up disk space, and logs will be re-downloaded on-demand when clicked.</p>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="confirm-btn cancel" onclick={() => (showClearCacheModal = false)}>
          Cancel
        </button>
        <button type="button" class="confirm-btn danger" onclick={confirmPurgeLogCache}>
          <i class="fa-solid fa-trash-can" style="margin-right: 4px;"></i> Clear Cache
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showClearHistoryModal}
  <div
    class="confirm-modal-overlay"
    role="button"
    tabindex="0"
    aria-label="Close history confirm modal"
    onclick={(e) => { if (e.target === e.currentTarget) showClearHistoryModal = false; }}
    onkeydown={(e) => { if (e.key === 'Escape') showClearHistoryModal = false; }}
  >
    <div class="confirm-modal-card" role="dialog" aria-modal="true" aria-label="Clear history confirmation" tabindex="-1">
      <div class="confirm-modal-head">
        <span class="confirm-modal-icon danger"><i class="fa-solid fa-triangle-exclamation"></i></span>
        <div>
          <h3 class="confirm-modal-title">Purge Analytics &amp; History?</h3>
          <p class="confirm-modal-sub">This action will delete {historyCacheCount} uploaded records ({formatSize(historyCacheSize)}).</p>
        </div>
      </div>
      <div class="confirm-modal-body">
        <p>This action will completely empty your local history database (`history.json`). Your Analytics Dashboard graphs, wipe statistics, and the History Log list will be cleared. This action cannot be undone.</p>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="confirm-btn cancel" onclick={() => (showClearHistoryModal = false)}>
          Cancel
        </button>
        <button type="button" class="confirm-btn danger" onclick={confirmPurgeHistoryCache}>
          <i class="fa-solid fa-trash-can" style="margin-right: 4px;"></i> Purge History
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showPatchNotesModal}
  {@const currentNotes = PATCH_NOTES_DATA.find(p => p.version === currentAppVersion)}
  <div
    class="confirm-modal-overlay patch-notes-overlay"
    role="button"
    tabindex="0"
    aria-label="Close patch notes"
    onclick={(e) => { if (e.target === e.currentTarget) { showPatchNotesModal = false; localStorage.setItem("last_seen_patch_notes", currentAppVersion); } }}
    onkeydown={(e) => { if (e.key === 'Escape') { showPatchNotesModal = false; localStorage.setItem("last_seen_patch_notes", currentAppVersion); } }}
  >
    <div class="patch-notes-modal" role="dialog" aria-modal="true" aria-label="Patch Notes" tabindex="-1">
      <div class="patch-notes-header">
        <div class="patch-notes-title-row">
          <h2>What's New</h2>
          <span class="patch-version-badge">v{currentNotes?.version}</span>
        </div>
        <p class="patch-notes-subtitle">Released on {currentNotes?.date}</p>
      </div>

      {#if currentNotes?.image}
        <img src={currentNotes.image} alt="Patch screenshot" style="width: 100%; max-height: 260px; object-fit: contain; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.3); margin-bottom: 4px;" />
      {/if}

      <div class="patch-notes-body scrollbar-custom">
        {#if currentNotes}
          {#each currentNotes.notes as category}
            <div class="patch-section">
              <h3 class="patch-section-title">{category.category}</h3>
              <div class="patch-items-list">
                {#each category.items as item}
                  <div class="patch-item">
                    <span class="patch-item-bullet">•</span>
                    <div class="patch-item-content">
                      <strong class="patch-item-title">{item.title}</strong>
                      <p class="patch-item-desc">{item.desc}</p>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <div class="patch-notes-footer">
        <button type="button" class="btn patch-notes-confirm-btn" onclick={() => { showPatchNotesModal = false; localStorage.setItem("last_seen_patch_notes", currentAppVersion); }}>
          Got It
        </button>
      </div>
    </div>
  </div>
{/if}

{#if isDragging}
  <div class="drag-overlay" class:no-motion={prefersReducedMotion} aria-hidden="true">
    <div class="drag-panel">
      <span class="drag-glyph"><i class="fa-solid fa-file-zipper"></i></span>
      <span class="drag-title">Drop arcdps logs to upload</span>
      <span class="drag-sub">.evtc / .zevtc</span>
    </div>
  </div>
{/if}

{#if accentPickerOpen}
  <div class="accent-picker-overlay" role="button" tabindex="0" aria-label="Close accent picker" onclick={(e) => { if (e.target === e.currentTarget) closeAccentPicker(); }} onkeydown={(e) => { if (e.key === 'Escape') closeAccentPicker(); }}>
    <div class="accent-picker-modal" role="dialog" aria-modal="true" aria-label="Accent color picker">
      <div class="accent-picker-head">
        <div class="accent-picker-title"><i class="fa-solid fa-palette"></i> Accent Color</div>
        <button type="button" class="accent-picker-close" onclick={closeAccentPicker} aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <!-- Preset dots -->
      <div class="accent-picker-presets">
        {#each ACCENT_PRESETS as c}
          <button type="button" class="accent-picker-dot" class:selected={pickerDraft.toLowerCase() === c.toLowerCase()} style="background: {c};" title={c} aria-label={`Preset ${c}`} onclick={() => pickPreset(c)}></button>
        {/each}
      </div>

      <!-- Custom hue / saturation picker -->
      <div
        class="accent-picker-sv"
        style="background-color: hsl({pickerHue}, 100%, 50%);"
        role="slider"
        aria-label="Saturation and lightness"
        aria-valuenow={Math.round(pickerLight)}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuetext={pickerDraft}
        tabindex="0"
        onpointerdown={(e) => {
          const svEl = e.currentTarget as HTMLDivElement;
          const compute = (ev: PointerEvent) => {
            const rect = svEl.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
            const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
            pickerDraft = hslToHex(pickerHue, x * 100, (1 - y) * 100);
          };
          const up = () => { window.removeEventListener('pointermove', compute); window.removeEventListener('pointerup', up); };
          window.addEventListener('pointermove', compute);
          window.addEventListener('pointerup', up);
          compute(e);
        }}
      >
        <span class="accent-picker-sv-cursor" style="left: {pickerSat}%; top: {100 - pickerLight}%; background: {pickerDraft};"></span>
      </div>

      <div class="accent-picker-hue-row">
        <span class="accent-picker-slider-icon"><i class="fa-solid fa-sliders"></i></span>
        <input
          type="range"
          class="accent-picker-hue"
          min="0" max="360" step="1"
          value={pickerHue}
          oninput={setHue}
          aria-label="Hue"
          style="--hue: {pickerHue}deg;"
        />
      </div>

      <!-- Live preview (only this chip repaints) + hex readout -->
      <div class="accent-picker-preview-row">
        <span class="accent-picker-preview" style="background: {pickerDraft};"></span>
        <span class="accent-picker-hex">{pickerDraft.toUpperCase()}</span>
      </div>

      <div class="accent-picker-footer">
        <button type="button" class="accent-picker-cancel" onclick={closeAccentPicker}>Cancel</button>
        <button type="button" class="accent-picker-apply" onclick={applyAccentFromPicker} style="background: {pickerDraft};">Apply</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── Global Upload Queue pill (footer, visible on every tab) ── */
  .upload-queue-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: #fff;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: 7px;
    padding: 4px 9px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    position: relative;
    transition: background .15s ease, box-shadow .15s ease;
  }
  .upload-queue-pill:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .sb-queue-count {
    background: color-mix(in srgb, #fff 12%, transparent);
    border-radius: 10px;
    padding: 1px 7px;
    font-size: 10px;
    font-weight: 700;
  }
  .sb-chevron { font-size: 9px; transition: transform .2s ease; opacity: .7; }
  .sb-chevron.open { transform: rotate(180deg); }

  /* Paused state — amber pulse to signal uploads are held */
  .queue-paused {
    background: color-mix(in srgb, #f59e0b 18%, transparent);
    border-color: color-mix(in srgb, #f59e0b 55%, transparent);
    color: #fde68a;
  }
  .queue-paused .sb-pause { color: #f59e0b; }
  .queue-paused.queue-pulsing { animation: queue-pulse 1.2s ease-in-out infinite; }
  @keyframes queue-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, #f59e0b 0%, transparent); }
    50% { box-shadow: 0 0 0 4px color-mix(in srgb, #f59e0b 35%, transparent); }
  }
  /* Active "logs just landed" cascade pulse (accent) */
  .upload-queue-pill.queue-pulsing:not(.queue-paused) {
    animation: queue-pulse-accent .6s ease-out 1;
  }
  @keyframes queue-pulse-accent {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); }
    100% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 0%, transparent); }
  }

  /* ── Queue drawer (expands upward) ── */
  .queue-drawer {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    width: 320px;
    max-height: 320px;
    background: var(--bg-elev, #0f1722);
    border: 1px solid var(--border, #2a3744);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 50;
  }
  .queue-drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 700;
    border-bottom: 1px solid var(--border, #2a3744);
    color: var(--text, #e2e8f0);
  }
  .queue-drawer-meta { font-size: 10px; color: var(--text-muted, #94a3b8); font-weight: 600; }
  .queue-drawer-list {
    overflow-y: auto;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .queue-row {
    display: grid;
    grid-template-columns: 16px 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 11px;
    background: color-mix(in srgb, #fff 3%, transparent);
  }
  .queue-row-icon { font-size: 10px; }
  .queue-queued .queue-row-icon { color: var(--text-muted, #94a3b8); }
  .queue-active .queue-row-icon { color: var(--accent, #38bdf8); }
  .queue-done .queue-row-icon { color: #4ade80; }
  .queue-done .queue-row-name { color: var(--text-muted, #94a3b8); }
  .queue-skipped .queue-row-icon { color: #f59e0b; }
  .queue-skipped .queue-row-name { color: var(--text-muted, #94a3b8); }
  .queue-row-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text, #e2e8f0);
  }
  .queue-row-state { font-size: 10px; color: var(--text-muted, #94a3b8); font-weight: 600; }
  .queue-drawer-pause {
    margin: 6px 8px 8px;
    padding: 6px;
    border-radius: 7px;
    border: 1px solid var(--border, #2a3744);
    background: color-mix(in srgb, #fff 5%, transparent);
    color: var(--text, #e2e8f0);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
  .queue-drawer-pause:hover { background: color-mix(in srgb, var(--accent) 16%, transparent); }

  /* Respect the user's reduce-motion setting */
  :global(.reduce-motion) .queue-pulsing,
  :global(.reduce-motion) .upload-queue-pill.queue-pulsing {
    animation: none !important;
  }
  :global(.reduce-motion) .sb-chevron { transition: none; }
</style>

