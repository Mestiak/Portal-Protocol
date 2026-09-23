<!-- Portal Protocol - Log Uploader & Log Manager Suite -->
<!-- Copyright (C) 2026 Mestiak -->
<!-- Licensed under MIT License -->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fly, fade } from "svelte/transition";

  interface Gw2Account {
    name: string;
    api_key: string;
  }

  interface Props {
    accounts: Gw2Account[];
    onSaveAccounts: (newAccounts: Gw2Account[]) => void;
    uploadedLogs?: any[];
  }

  let { accounts = [], onSaveAccounts, uploadedLogs = [] }: Props = $props();

  let prefersReducedMotion = $state(false);
  onMount(() => {
    prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  let activeAccountIdx = $state<number>(0);
  let showAddModal = $state(false);
  let newAccName = $state("");
  let newApiKey = $state("");
  let isCheckingKey = $state(false);
  let keyError = $state("");

  // API Clearance State
  let loadingClears = $state(false);
  let accountName = $state("");
  let clearedRaids = $state<string[]>([]);
  let clearedStrikes = $state<string[]>([]);
  let apiError = $state("");

  // Daily/Weekly Rotations
  let emboldenedWing = $state<number>(5);
  let callOfTheMistsWing = $state<number>(6);
  let dailyBounties = $state<string[]>([]);
  let nextDailyBounties = $state<string[]>([]);

  // Countdowns
  let dailyResetStr = $state("00:00:00");
  let weeklyResetStr = $state("0d 00:00:00");
  let timerInterval: any = null;

  // Copy Feedback state
  let copyFeedbackToday = $state(false);
  let copyFeedbackNext = $state(false);

  // Structure of Raids (Wings 1-8) with keyword sets for fuzzy matching
  const RAIDS_DATA = [
    {
      wing: 1,
      name: "Spirit Vale",
      bosses: [
        {
          id: "vale_guardian",
          label: "Vale Guardian",
          keys: ["vale_guardian", "vg"],
        },
        {
          id: "spirit_woods",
          label: "Spirit Woods (Run)",
          keys: ["spirit_woods", "woods", "run_event"],
        },
        { id: "gorseval", label: "Gorseval", keys: ["gorseval"] },
        { id: "sabetha", label: "Sabetha", keys: ["sabetha"] },
      ],
    },
    {
      wing: 2,
      name: "Salvation Pass",
      bosses: [
        { id: "slothasor", label: "Slothasor", keys: ["slothasor", "sloth"] },
        {
          id: "bandit_trio",
          label: "Bandit Trio",
          keys: ["bandit_trio", "trio", "berg", "zane", "narella"],
        },
        {
          id: "matthias",
          label: "Matthias Gabrel",
          keys: ["matthias", "matthias_gabrel"],
        },
      ],
    },
    {
      wing: 3,
      name: "Stronghold of the Faithful",
      bosses: [
        {
          id: "escort",
          label: "Siege the Stronghold (Escort)",
          keys: [
            "escort",
            "siege the stronghold",
            "siege_the_stronghold",
            "mcleod",
          ],
        },
        {
          id: "keep_construct",
          label: "Keep Construct (KC)",
          keys: ["keep_construct", "kc"],
        },
        {
          id: "twisted_castle",
          label: "Twisted Castle",
          keys: ["twisted_castle", "castle", "tc"],
        },
        { id: "xera", label: "Xera", keys: ["xera"] },
      ],
    },
    {
      wing: 4,
      name: "Bastion of the Penitent",
      bosses: [
        { id: "cairn", label: "Cairn the Indomitable", keys: ["cairn"] },
        {
          id: "mursaat_overseer",
          label: "Mursaat Overseer (MO)",
          keys: ["mursaat_overseer", "mo"],
        },
        { id: "samarog", label: "Samarog", keys: ["samarog"] },
        { id: "deimos", label: "Deimos", keys: ["deimos"] },
      ],
    },
    {
      wing: 5,
      name: "Hall of Chains",
      bosses: [
        {
          id: "soulless_horror",
          label: "Soulless Horror (SH)",
          keys: ["soulless_horror", "sh", "desmina"],
        },
        {
          id: "river_of_souls",
          label: "River of Souls",
          keys: ["river_of_souls", "river"],
        },
        {
          id: "statues_of_grenth",
          label: "Statues of Grenth",
          keys: [
            "statues_of_grenth",
            "statues",
            "broken_king",
            "eater_of_souls",
            "eyes",
          ],
        },
        { id: "dhuum", label: "Dhuum", keys: ["dhuum", "voice_in_the_void"] },
      ],
    },
    {
      wing: 6,
      name: "Mythwright Gambit",
      bosses: [
        {
          id: "conjured_amalgamate",
          label: "Conjured Amalgamate (CA)",
          keys: ["conjured_amalgamate", "ca"],
        },
        {
          id: "twin_largos",
          label: "Twin Largos",
          keys: ["twin_largos", "largos", "nikare", "kenut"],
        },
        { id: "qadim", label: "Qadim", keys: ["qadim"] },
      ],
    },
    {
      wing: 7,
      name: "The Key of Ahdashim",
      bosses: [
        {
          id: "cardinal_adina",
          label: "Cardinal Adina",
          keys: ["cardinal_adina", "adina"],
        },
        {
          id: "cardinal_sabir",
          label: "Cardinal Sabir",
          keys: ["cardinal_sabir", "sabir"],
        },
        {
          id: "qadim_the_peerless",
          label: "Qadim the Peerless (qTP)",
          keys: ["qadim_the_peerless", "qtp", "peerless"],
        },
      ],
    },
    {
      wing: 8,
      name: "Mount Balrior",
      bosses: [
        {
          id: "decima",
          label: "Decima",
          keys: ["decima", "decima_the_stormsinger", "storm_singer"],
        },
        {
          id: "greer",
          label: "Greer",
          keys: ["greer", "greer_the_diminished", "diminished"],
        },
        {
          id: "ura",
          label: "Ura",
          keys: ["ura", "ura_the_ironresplendent", "ironresplendent"],
        },
      ],
    },
  ];

  // Structure of Strikes (IBS, EoD, SotO, Visions of Eternity)
  const STRIKES_DATA = [
    {
      category: "Icebrood Saga (IBS)",
      missions: [
        {
          id: "shiverpeak_pass",
          label: "Shiverpeak Pass",
          keys: ["shiverpeak_pass", "shiverpeak", "icebrood_construct"],
        },
        {
          id: "kodan_brothers",
          label: "Voice & Claw of the Fallen",
          keys: [
            "weekly_strike_brothers",
            "voice_and_claw",
            "kodan_brothers",
            "brothers",
            "voice",
            "claw",
          ],
        },
        {
          id: "fraenir_of_jormag",
          label: "Fraenir of Jormag",
          keys: ["fraenir_of_jormag", "fraenir", "kodans"],
        },
        { id: "boneskinner", label: "Boneskinner", keys: ["boneskinner"] },
        {
          id: "whisper_of_jormag",
          label: "Whisper of Jormag",
          keys: ["whisper_of_jormag", "whisper"],
        },
        {
          id: "cold_war",
          label: "Cold War",
          keys: ["cold_war", "coldwar", "varinia"],
        },
      ],
    },
    {
      category: "End of Dragons (EoD)",
      missions: [
        {
          id: "aetherblade_hideout",
          label: "Aetherblade Hideout",
          keys: ["aetherblade_hideout", "aetherblade", "mai_trin"],
        },
        {
          id: "xunlai_junkyard",
          label: "Xunlai Jade Junkyard",
          keys: ["xunlai_junkyard", "xunlai", "junkyard", "ankka"],
        },
        {
          id: "kaineng_overlook",
          label: "Kaineng Overlook",
          keys: ["kaineng_overlook", "kaineng", "overlook", "minister_li"],
        },
        {
          id: "harvest_temple",
          label: "Harvest Temple",
          keys: ["harvest_temple", "harvest", "temple", "dragon_void"],
        },
        {
          id: "old_lions_court",
          label: "Old Lion's Court",
          keys: ["old_lions_court", "old_lion", "olc", "vermilion"],
        },
      ],
    },
    {
      category: "Secrets of the Obscure (SotO)",
      missions: [
        {
          id: "cosmic_observatory",
          label: "Cosmic Observatory (Dagda)",
          keys: ["cosmic_observatory", "cosmic", "observatory", "dagda"],
        },
        {
          id: "temple_of_febe",
          label: "Temple of Febe (Cerus)",
          keys: ["temple_of_febe", "febe", "cerus"],
        },
      ],
    },
    {
      category: "Visions of Eternity",
      missions: [
        {
          id: "kela",
          label: "Kela",
          keys: ["kela", "visions_of_eternity_kela"],
        },
        {
          id: "nexus_of_eternity",
          label: "Nexus of Eternity (Vloxx)",
          keys: [
            "nexus_of_eternity",
            "nexus",
            "vloxx",
            "visions_of_eternity_vloxx",
            "visions_of_eternity_nexus",
          ],
        },
      ],
    },
  ];

  function getMostRecentWeeklyReset(): Date {
    const now = new Date();
    const day = now.getUTCDay();
    const hours = now.getUTCHours();
    const minutes = now.getUTCMinutes();

    let daysToSubtract = (day - 1 + 7) % 7;
    if (day === 1 && (hours < 7 || (hours === 7 && minutes < 30))) {
      daysToSubtract = 7;
    }

    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - daysToSubtract,
        7,
        30,
        0,
      ),
    );
  }

  function parseLocalTimestamp(ts: string): Date | null {
    if (!ts) return null;
    const parts = ts.split(/[- :T]/);
    if (parts.length < 6) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const h = parseInt(parts[3], 10);
    const min = parseInt(parts[4], 10);
    const s = parseInt(parts[5], 10);
    return new Date(y, m, d, h, min, s);
  }

  function getLocalClearStatus(
    logs: any[],
    keywords: string[],
    isRaid: boolean = false,
  ): { cleared: boolean; isCM: boolean; isLCM: boolean } {
    if (!logs || logs.length === 0)
      return { cleared: false, isCM: false, isLCM: false };

    const lastReset = getMostRecentWeeklyReset();
    let cleared = false;
    let isCM = false;
    let isLCM = false;

    for (const log of logs) {
      if (log.status !== "Completed" || log.success !== true) continue;
      // Ignore convergence logs when checking raid bosses
      if (isRaid && log.is_convergence === true) continue;

      // Parse local timestamp robustly
      if (!log.timestamp) continue;
      const logDate = parseLocalTimestamp(log.timestamp);
      if (!logDate || isNaN(logDate.getTime())) continue;

      // Skip logs from previous weeks
      if (logDate.getTime() < lastReset.getTime()) continue;

      const name = (log.boss_name ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const matches = keywords.some((key) => {
        const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (k === "escort") {
          return name === "escort" || name === "siegethestronghold";
        }
        // Qadim vs Qadim the Peerless: different bosses in different wings
        // (Mythwright Gambit W6 vs Key of Ahdashim W7). Both normalize to
        // "qadim" and "qadimthepeerless" — substring matching between them is
        // always wrong because "qadim" is a prefix of "qadimthepeerless".
        // Require exact equality for either side so a W7 (Peerless) log never
        // marks W6 (Qadim) clear and vice-versa.
        if (k === "qadim" || name === "qadim") {
          return name === k;
        }
        // Substring matching for everything else: a shorter keyword stem inside
        // the cleaned boss name (e.g. "sloth" ⊆ "slothasor", "cairn" ⊆
        // "cairntheindomitable"). Also covers the reverse (keyword is the longer
        // name, boss_name is an alias stem) for completeness.
        if (k.length > 3) {
          return name === k || name.includes(k) || k.includes(name);
        }
        return false;
      });

      if (matches) {
        cleared = true;
        if (log.is_lcm) {
          isLCM = true;
        } else if (log.is_cm) {
          isCM = true;
        }
      }
    }

    return { cleared, isCM, isLCM };
  }

  // Helper for checking clear status including CM / LCM difficulties
  function getClearStatus(
    clearedList: string[],
    keywords: string[],
  ): { cleared: boolean; isCM: boolean; isLCM: boolean } {
    if (!clearedList || clearedList.length === 0)
      return { cleared: false, isCM: false, isLCM: false };
    const lowerList = clearedList.map((s) => s.toLowerCase());

    let cleared = false;
    let isCM = false;
    let isLCM = false;

    for (const item of lowerList) {
      const matchesKeyword = keywords.some((key) => {
        const k = key.toLowerCase();
        return item === k;
      });

      if (matchesKeyword) {
        cleared = true;
        // Check for LCM or CM variants in the API string
        if (item.includes("lcm") || item.includes("legendary")) {
          isLCM = true;
        } else if (
          item.includes("cm") ||
          item.includes("challenge") ||
          item.endsWith("_cm")
        ) {
          isCM = true;
        }
      }
    }
    return { cleared, isCM, isLCM };
  }

  function getCombinedClearStatus(
    apiList: string[],
    localLogs: any[],
    keywords: string[],
    isRaid: boolean = false,
  ): { cleared: boolean; isCM: boolean; isLCM: boolean } {
    const apiStatus = getClearStatus(apiList, keywords);
    if (apiStatus.cleared) {
      const localStatus = getLocalClearStatus(localLogs, keywords, isRaid);
      return {
        cleared: true,
        isCM: apiStatus.isCM || localStatus.isCM,
        isLCM: apiStatus.isLCM || localStatus.isLCM,
      };
    }
    return getLocalClearStatus(localLogs, keywords, isRaid);
  }

  function getEffectiveClearedRaids(
    raids: string[],
    strikes: string[],
    logs: any[],
  ): string[] {
    if (!raids || raids.length === 0) return [];

    const lastReset = getMostRecentWeeklyReset();

    // Check if we have any raid kill logs recorded since the most recent weekly reset
    const hasRecentRaidLogs = (logs || []).some((log) => {
      if (log.status !== "Completed" || log.success !== true) return false;
      if (log.is_convergence === true || log.is_wvw === true) return false;
      if (!log.timestamp) return false;
      const logDate = parseLocalTimestamp(log.timestamp);
      if (!logDate || isNaN(logDate.getTime())) return false;
      return logDate.getTime() >= lastReset.getTime();
    });

    // If strikes endpoint is empty (which resets automatically at 07:30 UTC on Mondays)
    // AND there are no local raid kill logs uploaded since the weekly reset,
    // then ANet's raid API endpoint is returning stale data from last week!
    if (strikes.length === 0 && !hasRecentRaidLogs) {
      return [];
    }

    return raids;
  }

  function isCleared(
    clearedList: string[],
    keywords: string[],
    isRaid: boolean = false,
  ): boolean {
    return getCombinedClearStatus(clearedList, uploadedLogs, keywords, isRaid)
      .cleared;
  }

  // Normalize a boss name for daily-bounty comparison: drop any "(...)" tag
  // and trailing title suffixes that aren't part of the real encounter name.
  // We deliberately KEEP " the Peerless" / " the Stormsinger" etc. — those are
  // part of the actual boss name (e.g. "Qadim the Peerless" != "Qadim").
  function normalizeBossName(name: string): string {
    let n = name
      .replace(/\(.*?\)/g, "") // strip "(CA)", "(qTP)", "(SH)"…
      .replace(/\bthe Indomitable\b/i, "") // Cairn's label is "Cairn the Indomitable"
      .trim()
      .toLowerCase();
    
    // Handle special cases where rotation names differ from boss labels
    // Matches: "Voice and Claw", "Voice & Claw", "Voice and Claw of the Fallen", etc.
    n = n.replace(/\bvoice\s*(?:and|&)\s*claw(?:\s*of\s*the\s*fallen)?\b/i, "voice & claw");
    n = n.replace(/\bmatthias\s+gabrel\b/i, "matthias");
    
    return n;
  }

  function isDailyBounty(label: string): boolean {
    const l = normalizeBossName(label);
    return dailyBounties.some((b) => normalizeBossName(b) === l);
  }

  // Calculate rotations strictly using wiki anchor dates
  function calculateRotations() {
    const now = new Date();

    // Weekly Reset / Rotation shift anchor: Monday, Aug 3, 2026 at 08:30 UTC (03:30 UTC-5)
    const anchorWeek = new Date(Date.UTC(2026, 7, 3, 8, 30, 0));
    const diffMs = now.getTime() - anchorWeek.getTime();

    // Calculate total weeks passed since anchor week
    let weeksPassed = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    if (diffMs < 0) {
      weeksPassed = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) - 1;
    }

    // Call of the Mists (COTM) rotates W1-W8. Aug 3rd week active: Wing 6.
    // Order: W6 (index 0) -> W7 -> W8 -> W1 -> W2 -> W3 -> W4 -> W5
    const cotmSequence = [6, 7, 8, 1, 2, 3, 4, 5];
    let cotmIdx = weeksPassed % 8;
    if (cotmIdx < 0) cotmIdx += 8;
    callOfTheMistsWing = cotmSequence[cotmIdx];

    // Emboldened Mode rotates W1-W8. Aug 3rd week active: Wing 5.
    // Order: W5 (index 0) -> W6 -> W7 -> W8 -> W1 -> W2 -> W3 -> W4
    const embSequence = [5, 6, 7, 8, 1, 2, 3, 4];
    let embIdx = weeksPassed % 8;
    if (embIdx < 0) embIdx += 8;
    emboldenedWing = embSequence[embIdx];

    // Daily Bounties rotation (12-day cycle)
    const anchorDate = new Date(Date.UTC(2026, 7, 9, 0, 0, 0)); // Aug 9, 2026 00:00 UTC
    const diffDays = Math.floor(
      (now.getTime() - anchorDate.getTime()) / (24 * 60 * 60 * 1000),
    );

    const set1 = [
      "Shiverpeak Pass",
      "Voice & Claw",
      "Fraenir of Jormag",
      "Gorseval",
      "Cairn",
      "Mursaat Overseer",
    ];
    const set2 = [
      "Aetherblade Hideout",
      "Cardinal Sabir",
      "Whisper of Jormag",
      "Vale Guardian",
      "Cosmic Observatory",
      "Cold War",
      "Boneskinner",
      "Sabetha",
      "Xunlai Junkyard",
      "Temple of Febe",
      "Keep Construct",
      "Kela",
    ];
    const set3 = [
      "Slothasor",
      "Matthias",
      "Xera",
      "Samarog",
      "Conjured Amalgamate",
      "Twin Largos",
      "Decima",
      "Cardinal Adina",
      "Old Lion's Court",
      "Ura",
      "Kaineng Overlook",
      "Deimos",
    ];
    const set4 = [
      "Qadim",
      "Qadim the Peerless",
      "Soulless Horror",
      "Harvest Temple",
      "Dhuum",
      "Greer",
    ];

    // Today's indices
    const cycleIndexToday = (5 + diffDays) % 12;
    const index12Today =
      cycleIndexToday >= 0 ? cycleIndexToday : cycleIndexToday + 12;
    const index6Today = index12Today % 6;

    dailyBounties = [
      set1[index6Today],
      set2[index12Today],
      set3[index12Today],
      set4[index6Today],
    ];

    // Next Day's indices
    const cycleIndexNext = (5 + diffDays + 1) % 12;
    const index12Next =
      cycleIndexNext >= 0 ? cycleIndexNext : cycleIndexNext + 12;
    const index6Next = index12Next % 6;

    nextDailyBounties = [
      set1[index6Next],
      set2[index12Next],
      set3[index12Next],
      set4[index6Next],
    ];
  }

  // Copy names to clipboard helper
  function copyBounties(list: string[], isNext: boolean) {
    const textToCopy = list.join(", ");
    navigator.clipboard.writeText(textToCopy).then(() => {
      if (isNext) {
        copyFeedbackNext = true;
        setTimeout(() => {
          copyFeedbackNext = false;
        }, 2000);
      } else {
        copyFeedbackToday = true;
        setTimeout(() => {
          copyFeedbackToday = false;
        }, 2000);
      }
    });
  }

  let lastCalculatedReset = 0;

  // Ticking countdown timers for resets
  function updateCountdowns() {
    const now = new Date();

    // 1. Daily Reset (00:00 UTC next day)
    const nextDaily = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0,
        0,
        0,
      ),
    );
    const dailyDiff = nextDaily.getTime() - now.getTime();

    const dailyHrs = Math.floor(dailyDiff / (1000 * 60 * 60));
    const dailyMins = Math.floor((dailyDiff / (1000 * 60)) % 60);
    const dailySecs = Math.floor((dailyDiff / 1000) % 60);
    dailyResetStr = `${String(dailyHrs).padStart(2, "0")}:${String(dailyMins).padStart(2, "0")}:${String(dailySecs).padStart(2, "0")}`;

    // 2. Weekly Reset (Next Monday at 07:30 UTC)
    let daysUntilMonday = (1 - now.getUTCDay() + 7) % 7;
    if (
      daysUntilMonday === 0 &&
      (now.getUTCHours() > 7 ||
        (now.getUTCHours() === 7 && now.getUTCMinutes() >= 30))
    ) {
      daysUntilMonday = 7;
    }
    const nextWeekly = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + daysUntilMonday,
        7,
        30,
        0,
      ),
    );
    const weeklyDiff = nextWeekly.getTime() - now.getTime();

    const weeklyDays = Math.floor(weeklyDiff / (1000 * 60 * 60 * 24));
    const weeklyHrs = Math.floor((weeklyDiff / (1000 * 60 * 60)) % 24);
    const weeklyMins = Math.floor((weeklyDiff / (1000 * 60)) % 60);
    const weeklySecs = Math.floor((weeklyDiff / 1000) % 60);
    weeklyResetStr = `${weeklyDays}d ${String(weeklyHrs).padStart(2, "0")}:${String(weeklyMins).padStart(2, "0")}:${String(weeklySecs).padStart(2, "0")}`;

    // 3. Auto-refresh on weekly reset crossing
    const currentWeeklyReset = getMostRecentWeeklyReset().getTime();
    if (
      lastCalculatedReset !== 0 &&
      lastCalculatedReset !== currentWeeklyReset
    ) {
      calculateRotations();
      if (accounts.length > 0 && accounts[activeAccountIdx]) {
        fetchClears(accounts[activeAccountIdx].api_key);
      }
    }
    lastCalculatedReset = currentWeeklyReset;
  }

  async function fetchClears(apiKey: string) {
    if (!apiKey) return;
    loadingClears = true;
    apiError = "";
    try {
      const accRes = await fetch(
        `https://api.guildwars2.com/v2/account?access_token=${apiKey}&v=${Date.now()}`,
      );
      if (!accRes.ok) throw new Error("Invalid API key or network error");
      const accData = await accRes.json();
      accountName = accData.name;

      const raidRes = await fetch(
        `https://api.guildwars2.com/v2/account/raids?access_token=${apiKey}&v=${Date.now()}`,
      );
      if (raidRes.ok) {
        clearedRaids = await raidRes.json();
      } else {
        clearedRaids = [];
      }

      const strikeRes = await fetch(
        `https://api.guildwars2.com/v2/account/weeklyclears?access_token=${apiKey}&v=${Date.now()}`,
      );
      if (strikeRes.ok) {
        clearedStrikes = await strikeRes.json();
      } else {
        clearedStrikes = [];
      }
    } catch (e: any) {
      apiError = e.message || "Failed to load clears";
      console.error(e);
    } finally {
      loadingClears = false;
    }
  }

  async function addNewAccount() {
    if (!newAccName.trim() || !newApiKey.trim()) {
      keyError = "Both nickname and API key are required.";
      return;
    }
    isCheckingKey = true;
    keyError = "";
    try {
      const res = await fetch(
        `https://api.guildwars2.com/v2/account?access_token=${newApiKey.trim()}`,
      );
      if (!res.ok) {
        throw new Error(
          "Invalid API Key. Ensure key has 'progression' permission.",
        );
      }
      const data = await res.json();
      const finalName = `${newAccName.trim()} (${data.name})`;

      const newAccList = [
        ...accounts,
        { name: finalName, api_key: newApiKey.trim() },
      ];
      onSaveAccounts(newAccList);

      showAddModal = false;
      newAccName = "";
      newApiKey = "";
      activeAccountIdx = newAccList.length - 1;
      fetchClears(newAccList[activeAccountIdx].api_key);
    } catch (err: any) {
      keyError = err.message || "Connection error. Try again.";
    } finally {
      isCheckingKey = false;
    }
  }

  function removeAccount(idx: number, e: Event) {
    e.stopPropagation();
    const filtered = accounts.filter((_, i) => i !== idx);
    onSaveAccounts(filtered);
    if (activeAccountIdx >= filtered.length) {
      activeAccountIdx = Math.max(0, filtered.length - 1);
    }
    if (filtered.length > 0) {
      fetchClears(filtered[activeAccountIdx].api_key);
    } else {
      clearedRaids = [];
      clearedStrikes = [];
      accountName = "";
    }
  }

  const effectiveClearedRaids = $derived(
    getEffectiveClearedRaids(clearedRaids, clearedStrikes, uploadedLogs),
  );

  const totalRaidBosses = RAIDS_DATA.reduce(
    (sum, w) => sum + w.bosses.length,
    0,
  );
  const clearedRaidBossesCount = $derived(
    RAIDS_DATA.reduce(
      (sum, w) =>
        sum +
        w.bosses.filter(
          (b) =>
            getCombinedClearStatus(
              effectiveClearedRaids,
              uploadedLogs,
              b.keys,
              true,
            ).cleared,
        ).length,
      0,
    ),
  );

  const totalStrikeMissions = STRIKES_DATA.reduce(
    (sum, c) => sum + c.missions.length,
    0,
  );
  const clearedStrikesCount = $derived(
    STRIKES_DATA.reduce(
      (sum, c) =>
        sum +
        c.missions.filter(
          (m) =>
            getCombinedClearStatus(clearedStrikes, uploadedLogs, m.keys, false)
              .cleared,
        ).length,
      0,
    ),
  );

  onMount(() => {
    calculateRotations();
    updateCountdowns();

    timerInterval = setInterval(() => {
      updateCountdowns();
    }, 1000);

    if (accounts.length > 0) {
      fetchClears(accounts[activeAccountIdx].api_key);
    }
  });

  onDestroy(() => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  });

  $effect(() => {
    if (accounts.length > 0 && accounts[activeAccountIdx]) {
      fetchClears(accounts[activeAccountIdx].api_key);
    }
  });
</script>

<div class="tracker-container" in:fade={{ duration: prefersReducedMotion ? 0 : 180 }}>
  <!-- Top Navigation / Account Selector Strip -->
  <div class="tracker-header">
    <div class="account-selector-strip" role="tablist" aria-label="GW2 accounts">
      {#each accounts as acc, i}
        <div
          class="account-tab"
          class:active={activeAccountIdx === i}
          onclick={() => (activeAccountIdx = i)}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") activeAccountIdx = i;
          }}
          role="tab"
          aria-selected={activeAccountIdx === i}
          aria-label={acc.name}
          id={"api-account-tab-" + i}
          tabindex="0"
        >
          <span class="acc-dot"></span>
          <span class="acc-name">{acc.name}</span>
          <button
            class="acc-remove"
            onclick={(e) => removeAccount(i, e)}
            title="Remove account"
            aria-label={"Remove account " + acc.name}>✕</button
          >
        </div>
      {/each}
      <button class="add-api-key-btn" onclick={() => (showAddModal = true)}>
        <i class="fa-solid fa-plus"></i> Add API Key
      </button>
    </div>

    <!-- Apple Design: Real-time ticking countdown headers -->
    <div class="countdown-clocks-strip">
      <div class="countdown-clock daily">
        <span class="countdown-label">DAILY RESET:</span>
        <span class="countdown-time">{dailyResetStr}</span>
      </div>
      <div class="countdown-clock weekly">
        <span class="countdown-label">WEEKLY RESET:</span>
        <span class="countdown-time">{weeklyResetStr}</span>
      </div>
    </div>
  </div>

  <!-- Main View -->
  {#if accounts.length === 0}
    <div class="empty-tracker card">
      <div class="empty-icon"><i class="fa-solid fa-key"></i></div>
      <h3>No GW2 API Keys Configured</h3>
      <p>
        Add a Guild Wars 2 API Key with <strong>progression</strong> permissions
        to track your weekly raid &amp; strike clearances across all accounts.
      </p>
      <button class="configure-btn" onclick={() => (showAddModal = true)}>
        <i class="fa-solid fa-plus" style="margin-right: 6px;"></i> Configure API
        Key
      </button>
    </div>
  {:else if loadingClears}
    <div class="empty-tracker card">
      <i
        class="fa-solid fa-rotate fa-spin fa-2x"
        style="color: var(--accent); margin-bottom: 12px;"
      ></i>
      <h3>Fetching Weekly API Progress...</h3>
      <p>Loading weekly clearances from Guild Wars 2 API servers.</p>
    </div>
  {:else}
    <div class="bento-grid">
      <!-- Card 1: Active Weekly Bonuses & Daily Rotations -->
      <div class="bento-card bento-bonuses card">
        <h4 class="bento-title">
          <i class="fa-solid fa-gift"></i> Active Weekly Bonuses
        </h4>
        <div class="bonuses-row">
          <div class="bonus-box mist-bonus">
            <span class="bonus-label">CALL OF THE MISTS</span>
            <span class="bonus-val">Wing {callOfTheMistsWing}</span>
            <span class="bonus-desc"
              >Double gold, bonus experience &amp; magic find.</span
            >
          </div>
          <div class="bonus-box shield-bonus">
            <span class="bonus-label">EMBOLDENED MODE</span>
            <span class="bonus-val">Wing {emboldenedWing}</span>
            <span class="bonus-desc"
              >Bonus health &amp; damage stacks on wipes.</span
            >
          </div>
        </div>

        <!-- Rotations Lists for Today and Next Dailies -->
        <div class="rotation-double-rows">
          <!-- Row A: Today's Daily Bosses -->
          <div class="rotation-row-container">
            <div class="rotation-row-header">
              <span class="rotation-row-title">Current Daily Bosses</span>
              <button
                class="copy-bounty-btn"
                onclick={() => copyBounties(dailyBounties, false)}
                aria-label="Copy current daily bosses">
                {#if copyFeedbackToday}
                  <i class="fa-solid fa-check" style="color: #34d399;"></i> Copied!
                {:else}
                  <i class="fa-solid fa-copy"></i> Copy
                {/if}
              </button>
            </div>
            <div class="daily-strike-row">
              {#each dailyBounties as bounty, idx}
                <div class="daily-item">
                  <span class="daily-title">Boss {idx + 1}</span>
                  <span class="daily-name">{bounty || "Loading..."}</span>
                </div>
              {/each}
            </div>
          </div>

          <!-- Row B: Next Daily Bosses -->
          <div
            class="rotation-row-container"
            style="margin-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.04); padding-top: 12px;"
          >
            <div class="rotation-row-header">
              <span class="rotation-row-title">Next Daily Bosses</span>
              <button
                class="copy-bounty-btn"
                onclick={() => copyBounties(nextDailyBounties, true)}
                aria-label="Copy next daily bosses">
                {#if copyFeedbackNext}
                  <i class="fa-solid fa-check" style="color: #34d399;"></i> Copied!
                {:else}
                  <i class="fa-solid fa-copy"></i> Copy
                {/if}
              </button>
            </div>
            <div class="daily-strike-row">
              {#each nextDailyBounties as bounty, idx}
                <div class="daily-item">
                  <span class="daily-title">Boss {idx + 1}</span>
                  <span
                    class="daily-name"
                    style="color: rgba(255, 255, 255, 0.65);"
                    >{bounty || "Loading..."}</span
                  >
                </div>
              {/each}
            </div>
          </div>
        </div>
      </div>

      <!-- Card 2: Summary Stats / Cleared Totals -->
      <div class="bento-card card bento-progress">
        <h4 class="bento-title">
          <i class="fa-solid fa-chart-pie"></i> Weekly Clearance Summary
        </h4>
        <div class="progress-columns">
          <div class="prog-col-item">
            <div class="prog-label">Raid Bosses</div>
            <div class="prog-score">
              {clearedRaidBossesCount} / {totalRaidBosses}
            </div>
            <div class="prog-bar-container">
              <div
                class="prog-bar-fill"
                style="width: {(clearedRaidBossesCount / totalRaidBosses) *
                  100}%"
              ></div>
            </div>
          </div>
          <div class="prog-col-item">
            <div class="prog-label">Strike Missions</div>
            <div class="prog-score">
              {clearedStrikesCount} / {totalStrikeMissions}
            </div>
            <div class="prog-bar-container">
              <div
                class="prog-bar-fill strike-color"
                style="width: {(clearedStrikesCount / totalStrikeMissions) *
                  100}%"
              ></div>
            </div>
          </div>
        </div>
        {#if apiError}
          <div class="api-status-warning">
            <i class="fa-solid fa-triangle-exclamation"></i>
            {apiError}
          </div>
        {:else}
          <div class="api-status-ok" role="status" aria-live="polite">
            <i class="fa-solid fa-circle-check"></i> Connected as
            <strong>{accountName || "Unknown"}</strong>
          </div>
        {/if}
      </div>

      <!-- Card 3: Raid Progression Grid (Wings 1-8) -->
      <div class="bento-card bento-full card">
        <h4 class="bento-title">
          <i class="fa-solid fa-shield-halved"></i> Raid Weekly Clears (Wings 1 -
          8)
        </h4>
        <div class="wings-grid">
          {#each RAIDS_DATA as wingData}
            {@const clearedInWing = wingData.bosses.filter((b) =>
              isCleared(effectiveClearedRaids, b.keys, true),
            ).length}
            {@const isWingCall = callOfTheMistsWing === wingData.wing}
            {@const isWingEmboldened = emboldenedWing === wingData.wing}
            {@const wingPct = (clearedInWing / wingData.bosses.length) * 100}
            <div
              class="wing-card"
              class:call-active={isWingCall}
              class:emboldened-active={isWingEmboldened}
            >
              <div class="wing-card-header">
                <div class="wing-info-side">
                  <span class="w-num">W{wingData.wing}</span>
                  <span class="w-name">{wingData.name}</span>
                </div>
                <div class="wing-stat-side">
                  {#if isWingCall}
                    <span class="w-badge call" title="Call of the Mists active!"
                      ><i class="fa-solid fa-wind"></i> COTM</span
                    >
                  {/if}
                  {#if isWingEmboldened}
                    <span class="w-badge emb" title="Emboldened mode active!"
                      ><i class="fa-solid fa-shield"></i> EMB</span
                    >
                  {/if}
                  <span class="w-fraction"
                    >{clearedInWing}/{wingData.bosses.length}</span
                  >
                </div>
              </div>

              <!-- Card progress bar visual indicator -->
              <div class="wing-card-progress">
                <div
                  class="wing-card-progress-bar"
                  style="width: {wingPct}%; background: {wingPct === 100
                    ? '#34d399'
                    : 'var(--accent)'}"
                ></div>
              </div>

              <div class="bosses-capsule-row">
                {#each wingData.bosses as boss}
                  {@const status = getCombinedClearStatus(
                    effectiveClearedRaids,
                    uploadedLogs,
                    boss.keys,
                    true,
                  )}
                  {@const isDaily = isDailyBounty(boss.label)}
                  <div class="boss-list-item" class:cleared={status.cleared}>
                    <span class="boss-checkbox">
                      {#if status.cleared}
                        <i class="fa-solid fa-circle-check"></i>
                      {:else}
                        <i class="fa-regular fa-circle"></i>
                      {/if}
                    </span>
                    <span class="boss-label-text">{boss.label}</span>
                    {#if status.isLCM}
                      <span class="difficulty-badge lcm">LCM</span>
                    {:else if status.isCM}
                      <span class="difficulty-badge cm">CM</span>
                    {/if}
                    {#if isDaily}
                      <span class="daily-badge">DAILY</span>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>

      <!-- Card 4: Strike Missions Progression -->
      <div class="bento-card bento-full card">
        <h4 class="bento-title">
          <i class="fa-solid fa-bolt"></i> Strike Missions Clears
        </h4>
        <div class="strikes-grid">
          {#each STRIKES_DATA as strikeCat}
            <div class="strike-cat-card">
              <div class="strike-cat-title">{strikeCat.category}</div>
              <div class="strike-list-rows">
                {#each strikeCat.missions as mission}
                  {@const status = getCombinedClearStatus(
                    clearedStrikes,
                    uploadedLogs,
                    mission.keys,
                  )}
                  {@const isDaily = isDailyBounty(mission.label)}
                  <div class="strike-row-item" class:cleared={status.cleared}>
                    <div class="strike-row-left">
                      <span class="strike-status-check">
                        {#if status.cleared}
                          <i class="fa-solid fa-circle-check"></i>
                        {:else}
                          <i class="fa-regular fa-circle"></i>
                        {/if}
                      </span>
                      <span class="strike-row-label">{mission.label}</span>
                      {#if status.isLCM}
                        <span
                          class="difficulty-badge lcm"
                          style="margin-left: 6px;">LCM</span
                        >
                      {:else if status.isCM}
                        <span
                          class="difficulty-badge cm"
                          style="margin-left: 6px;">CM</span
                        >
                      {/if}
                    </div>
                    {#if isDaily}
                      <span class="daily-badge">DAILY</span>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- Add API Key Modal -->
  {#if showAddModal}
    <div class="update-overlay" transition:fade={{ duration: prefersReducedMotion ? 0 : 120 }}>
      <div
        class="update-modal"
        style="max-width: 420px; padding: 24px;"
        transition:fly={{ y: 10, duration: prefersReducedMotion ? 0 : 180 }}
      >
        <h3
          class="update-title"
          style="margin-bottom: 6px; text-align: center;"
        >
          <i
            class="fa-solid fa-key"
            style="margin-right: 6px; color: var(--accent);"
          ></i> Add GW2 API Key
        </h3>
        <p class="update-sub" style="margin-bottom: 18px; text-align: center;">
          Configure your API Key. Key must have <strong>progression</strong> permissions
          enabled.
        </p>

        <div
          class="modal-form-fields"
          style="display: flex; flex-direction: column; gap: 14px; width: 100%;"
        >
          <label
            style="display: flex; flex-direction: column; gap: 6px; text-align: left;"
          >
            <span
              style="font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.7);"
              >Account Nickname (e.g. Main Account)</span
            >
            <input
              type="text"
              class="modal-input"
              bind:value={newAccName}
              placeholder="Main Account"
            />
          </label>

          <label
            style="display: flex; flex-direction: column; gap: 6px; text-align: left;"
          >
            <span
              style="font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.7);"
              >Guild Wars 2 API Key</span
            >
            <input
              type="text"
              class="modal-input monospace"
              bind:value={newApiKey}
              placeholder="e.g. XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXXXXXXXXXX"
            />
          </label>
        </div>

        {#if keyError}
          <div
            class="api-status-warning"
            style="margin-top: 14px; width: 100%; box-sizing: border-box; text-align: left;"
          >
            <i class="fa-solid fa-triangle-exclamation"></i>
            {keyError}
          </div>
        {/if}

        <div class="modal-btn-row">
          <button
            class="modal-action-btn cancel"
            onclick={() => {
              showAddModal = false;
              keyError = "";
            }}>Cancel</button
          >
          <button
            class="modal-action-btn primary"
            onclick={addNewAccount}
            disabled={isCheckingKey}
          >
            {isCheckingKey ? "Verifying..." : "Add Account"}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .tracker-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 2px 0 10px;
    height: 100%;
    box-sizing: border-box;
  }

  .tracker-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    padding-bottom: 12px;
    flex-wrap: wrap;
    gap: 12px;
  }

  .account-selector-strip {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .account-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    font-family: var(--font);
    user-select: none;
  }
  .account-tab:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }
  .account-tab.active {
    background: rgba(168, 85, 247, 0.15);
    border-color: rgba(168, 85, 247, 0.35);
    color: #c084fc;
  }

  .acc-dot {
    width: 6px;
    height: 6px;
    background: #34d399;
    border-radius: 50%;
  }

  .acc-remove {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 10px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    margin-left: 4px;
    transition: color 0.15s ease;
  }
  .acc-remove:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
  }

  .add-api-key-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    user-select: none;
  }
  .add-api-key-btn:hover {
    background: rgba(168, 85, 247, 0.12);
    border-color: rgba(168, 85, 247, 0.35);
    color: #c084fc;
  }

  /* Countdown Clocks design (Apple style) */
  .countdown-clocks-strip {
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .countdown-clock {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.02);
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.03);
  }

  .countdown-label {
    font-size: 8px;
    font-weight: 800;
    color: var(--text-muted);
    letter-spacing: 0.5px;
  }

  .countdown-time {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.95);
    font-family: monospace;
    font-weight: 600;
  }

  .empty-tracker {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 50px 30px;
    text-align: center;
    min-height: 250px;
  }

  /* Bento Grid Styles */
  .bento-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
    width: 100%;
  }

  .bento-card {
    display: flex;
    flex-direction: column;
    padding: 16px;
    box-sizing: border-box;
  }
  .bento-full {
    grid-column: 1 / -1;
  }

  .bento-title {
    margin: 0 0 14px;
    font-size: 13px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.9);
    letter-spacing: 0.2px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    padding-bottom: 8px;
  }
  .bento-title i {
    color: #a855f7;
  }

  /* Bonuses Box layout */
  .bonuses-row {
    display: flex;
    gap: 12px;
    margin-bottom: 14px;
  }

  .bonus-box {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    position: relative;
    overflow: hidden;
  }

  .mist-bonus {
    background: rgba(168, 85, 247, 0.05);
    border-color: rgba(168, 85, 247, 0.2);
  }
  .shield-bonus {
    background: rgba(251, 191, 36, 0.04);
    border-color: rgba(251, 191, 36, 0.15);
  }

  .bonus-label {
    font-size: 9px;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--text-muted);
    margin-bottom: 4px;
  }

  .bonus-val {
    font-size: 18px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 4px;
  }
  .mist-bonus .bonus-val {
    color: #c084fc;
  }
  .shield-bonus .bonus-val {
    color: #fbbf24;
  }

  .bonus-desc {
    font-size: 10px;
    color: var(--text-muted);
    line-height: 1.3;
  }

  /* Dual rotations rows */
  .rotation-double-rows {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .rotation-row-container {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .rotation-row-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .rotation-row-title {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
  }

  .copy-bounty-btn {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-muted);
    font-size: 9px;
    font-weight: 700;
    font-family: var(--font);
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .copy-bounty-btn:hover {
    background: rgba(168, 85, 247, 0.12);
    border-color: rgba(168, 85, 247, 0.35);
    color: #c084fc;
  }

  .daily-strike-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .daily-item {
    flex: 1 1 calc(25% - 12px);
    min-width: 90px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .daily-title {
    font-size: 9px;
    color: var(--text-muted);
    font-weight: 700;
    text-transform: uppercase;
  }

  .daily-name {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.85);
  }

  /* Weekly Clear Summary progress bars */
  .progress-columns {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 12px;
  }

  .prog-col-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .prog-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
  }

  .prog-score {
    font-size: 18px;
    font-weight: 700;
    color: #fff;
  }

  .prog-bar-container {
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
    overflow: hidden;
  }

  .prog-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 4px;
    transition: width 0.3s ease;
  }
  .prog-bar-fill.strike-color {
    background: #34d399;
  }

  .api-status-warning {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 6px;
    color: #fca5a5;
    font-size: 11px;
    font-weight: 500;
    margin-top: 16px;
  }

  .api-status-ok {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(52, 211, 153, 0.06);
    border: 1px solid rgba(52, 211, 153, 0.15);
    border-radius: 6px;
    color: #a7f3d0;
    font-size: 11px;
    font-weight: 500;
    margin-top: 16px;
  }

  /* Wings Grid (Raid) */
  .wings-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }

  .wing-card {
    background: rgba(255, 255, 255, 0.015);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition:
      border-color 0.2s ease,
      background 0.2s ease;
    position: relative;
    overflow: hidden;
  }
  .wing-card:hover {
    border-color: rgba(255, 255, 255, 0.1);
  }
  .wing-card.call-active {
    border-color: rgba(168, 85, 247, 0.35);
    background: rgba(168, 85, 247, 0.03);
  }
  .wing-card.emboldened-active {
    border-color: rgba(251, 191, 36, 0.25);
    background: rgba(251, 191, 36, 0.02);
  }

  .wing-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 2px;
  }

  .wing-info-side {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .w-num {
    font-size: 11px;
    font-weight: 700;
    color: var(--accent);
  }
  .w-name {
    font-size: 11px;
    font-weight: 600;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wing-stat-side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }

  .w-badge {
    font-size: 8px;
    font-weight: 800;
    padding: 1px 4px;
    border-radius: 3px;
    text-transform: uppercase;
  }
  .w-badge.call {
    background: rgba(168, 85, 247, 0.15);
    color: #c084fc;
  }
  .w-badge.emb {
    background: rgba(251, 191, 36, 0.15);
    color: #fbbf24;
  }

  .w-fraction {
    font-size: 10px;
    color: var(--text-muted);
    font-weight: 600;
  }

  /* Card Progress Line Indicator */
  .wing-card-progress {
    width: 100%;
    height: 3px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 6px;
  }
  .wing-card-progress-bar {
    height: 100%;
    transition: width 0.3s ease;
  }

  .bosses-capsule-row {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  /* List item with visual checks and strikethroughs */
  .boss-list-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 4px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.85);
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }
  .boss-list-item.cleared {
    color: rgba(255, 255, 255, 0.3);
  }
  .boss-list-item.cleared .boss-label-text {
    text-decoration: line-through;
  }

  .boss-checkbox {
    display: flex;
    align-items: center;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.25);
  }
  .boss-list-item.cleared .boss-checkbox {
    color: #34d399;
  }

  .boss-label-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .daily-badge {
    background: rgba(52, 211, 153, 0.15);
    color: #34d399;
    font-size: 8px;
    font-weight: 800;
    padding: 1px 4px;
    border-radius: 3px;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }

  .difficulty-badge {
    font-size: 8px;
    font-weight: 800;
    padding: 1px 4px;
    border-radius: 3px;
    letter-spacing: 0.5px;
    flex-shrink: 0;
    line-height: 1;
    margin-right: 4px;
  }
  .difficulty-badge.cm {
    background: #fbbf24;
    color: #1e1b4b;
  }
  .difficulty-badge.lcm {
    background: #8b5cf6;
    color: #ffffff;
  }

  /* Strikes Grid styling */
  .strikes-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }

  .strike-cat-card {
    background: rgba(255, 255, 255, 0.015);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .strike-cat-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    padding-bottom: 4px;
  }

  .strike-list-rows {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .strike-row-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 6px;
    border-radius: 4px;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.85);
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }
  .strike-row-item.cleared {
    color: rgba(255, 255, 255, 0.3);
  }
  .strike-row-item.cleared .strike-row-label {
    text-decoration: line-through;
  }

  .strike-row-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .strike-status-check {
    display: flex;
    align-items: center;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.25);
  }
  .strike-row-item.cleared .strike-status-check {
    color: #34d399;
  }

  .strike-row-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Modal Form Controls & High Contrast Action Buttons */
  .modal-input {
    width: 100%;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    color: #fff;
    font-size: 12px;
    font-family: var(--font);
    outline: none;
    box-sizing: border-box;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }
  .modal-input:focus {
    border-color: var(--accent);
    background: rgba(0, 0, 0, 0.5);
  }
  .modal-input.monospace {
    font-family: monospace;
  }

  .modal-btn-row {
    display: flex;
    gap: 10px;
    margin-top: 22px;
    width: 100%;
  }

  .configure-btn {
    margin-top: 16px;
    height: 30px;
    padding: 0 16px;
    background: var(--accent);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }
  .configure-btn:hover {
    filter: brightness(1.1);
    box-shadow: 0 2px 8px rgba(168, 85, 247, 0.25);
  }

  .modal-action-btn {
    flex: 1;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    box-sizing: border-box;
    border: none;
  }
  .modal-action-btn.cancel {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.85);
  }
  .modal-action-btn.cancel:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }
  .modal-action-btn.primary {
    background: var(--accent);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #fff;
  }
  .modal-action-btn.primary:hover {
    filter: brightness(1.15);
    box-shadow: 0 2px 10px rgba(168, 85, 247, 0.3);
  }
  .modal-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Responsive settings */
  @media (max-width: 900px) {
    .bento-grid {
      grid-template-columns: 1fr;
    }
    .wings-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    .strikes-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
