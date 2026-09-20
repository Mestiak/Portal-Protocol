import { a4 as attr, a5 as attr_class, e as escape_html, a6 as ensure_array_like, a3 as derived, a7 as attr_style, a8 as stringify } from "../../chunks/index.js";
import { invoke } from "@tauri-apps/api/core";
import "@tauri-apps/api/event";
import "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import "@tauri-apps/plugin-updater";
import "@tauri-apps/plugin-process";
import "@tauri-apps/plugin-notification";
function FilterBar($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      filters,
      bosses = [],
      vlRanks = [],
      professions = [],
      professionGroups = [],
      showCounts = false,
      resultCount = 0,
      totalCount = 0,
      onchange
    } = $$props;
    let collapsed = true;
    const selectedProf = derived(() => typeof filters.profession === "number" ? professions.find((p) => p.value === filters.profession) : void 0);
    const selectedSpec = derived(() => {
      if (typeof filters.profession !== "number") return void 0;
      for (const g of professionGroups) {
        const s = g.specs.find((s2) => s2.id === filters.profession);
        if (s) return s;
      }
      return void 0;
    });
    const RESULT_OPTS = [
      { v: "all", label: "All Results" },
      { v: "success", label: "Success" },
      { v: "failure", label: "Failure" }
    ];
    const TYPE_OPTS = [
      { v: "all", label: "All Types" },
      { v: "raid", label: "Raid" },
      { v: "strike", label: "Strike" },
      { v: "fractal", label: "Fractal" },
      { v: "convergence", label: "Convergence" }
    ];
    const CM_OPTS = [
      { v: "all", label: "Any Mode" },
      { v: "cm", label: "CM" },
      { v: "lcm", label: "LCM" },
      { v: "normal", label: "Normal" },
      { v: "quickplay", label: "Quick Play" }
    ];
    const DATE_OPTS = [
      { v: "all", label: "Any Date" },
      { v: "today", label: "Today" },
      { v: "7d", label: "Last 7d" },
      { v: "30d", label: "Last 30d" },
      { v: "month", label: "This Month" },
      { v: "custom", label: "Custom" }
    ];
    const hasActive = derived(() => filters.result !== "all" || filters.type !== "all" || filters.boss !== "all" || filters.vlRank !== "all" || filters.cmMode !== "all" || filters.datePreset !== "all" || filters.dateFrom !== "" || filters.dateTo !== "" || filters.timeFrom !== "" || filters.timeTo !== "" || filters.profession !== "all");
    const activeFiltersCount = derived(() => {
      let count = 0;
      if (filters.result !== "all") count++;
      if (filters.type !== "all") count++;
      if (filters.cmMode !== "all") count++;
      if (filters.datePreset !== "all") count++;
      if (filters.timeFrom || filters.timeTo) count++;
      if (filters.profession !== "all") count++;
      if (filters.boss !== "all") count++;
      if (filters.vlRank !== "all") count++;
      return count;
    });
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const activeChips = derived(() => {
      const chips = [];
      if (filters.result !== "all") chips.push({
        key: "result",
        label: cap(filters.result),
        clear: () => {
          filters.result = "all";
        }
      });
      if (filters.type !== "all") chips.push({
        key: "type",
        label: cap(filters.type),
        clear: () => {
          filters.type = "all";
        }
      });
      if (filters.cmMode !== "all") chips.push({
        key: "cm",
        label: filters.cmMode.toUpperCase(),
        clear: () => {
          filters.cmMode = "all";
        }
      });
      if (filters.datePreset !== "all") {
        const d = DATE_OPTS.find((o) => o.v === filters.datePreset);
        let label = d ? d.label : filters.datePreset;
        if (filters.datePreset === "custom" && (filters.dateFrom || filters.dateTo)) label = `Custom ${filters.dateFrom || "…"}–${filters.dateTo || "…"}`;
        chips.push({
          key: "date",
          label,
          clear: () => {
            filters.datePreset = "all";
            filters.dateFrom = "";
            filters.dateTo = "";
          }
        });
      }
      if (filters.boss !== "all") {
        const b = bosses.find((x) => x.key === filters.boss);
        chips.push({
          key: "boss",
          label: `Boss: ${b ? b.label : filters.boss}`,
          clear: () => {
            filters.boss = "all";
          }
        });
      }
      if (filters.vlRank !== "all") {
        const label = filters.vlRank === "none" ? "No Rank" : filters.vlRank === "any" ? "Has Rank" : vlRanks.find((r) => r.id === filters.vlRank)?.label ?? filters.vlRank;
        chips.push({
          key: "vl",
          label: `Rank: ${label}`,
          clear: () => {
            filters.vlRank = "all";
          }
        });
      }
      if (filters.profession !== "all") {
        const label = selectedSpec()?.name ?? selectedProf()?.name ?? String(filters.profession);
        chips.push({
          key: "prof",
          label: `Prof: ${label}`,
          clear: () => {
            filters.profession = "all";
          }
        });
      }
      if (filters.timeFrom || filters.timeTo) {
        const label = `${filters.timeFrom || "00:00"}–${filters.timeTo || "23:59"}`;
        chips.push({
          key: "time",
          label: `Time ${label}`,
          clear: () => {
            filters.timeFrom = "";
            filters.timeTo = "";
          }
        });
      }
      if (filters.search.trim() !== "") chips.push({
        key: "search",
        label: `“${filters.search.trim()}”`,
        clear: () => {
          filters.search = "";
        }
      });
      return chips;
    });
    $$renderer2.push(`<div class="filter-bar-component svelte-tph1t1"><div class="filter-top-row svelte-tph1t1"><div class="search-container svelte-tph1t1"><i class="fa-solid fa-magnifying-glass search-icon-left svelte-tph1t1"></i> <input type="text" class="search-input svelte-tph1t1" placeholder="Search boss, player, or spec…"${attr("value", filters.search)}/> `);
    if (filters.search.trim() !== "") {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<button class="search-clear svelte-tph1t1" title="Clear search" aria-label="Clear search">✕</button>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div> <button${attr_class("filter-toggle-btn svelte-tph1t1", void 0, {
      "drawer-open": !collapsed,
      "has-active": activeFiltersCount() > 0
    })} title="Filter options"><i class="fa-solid fa-sliders"></i> <span>Filters</span> `);
    if (activeFiltersCount() > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="active-count-badge svelte-tph1t1">${escape_html(activeFiltersCount())}</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></button> `);
    if (showCounts) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="filter-count tabular-nums svelte-tph1t1">Showing ${escape_html(resultCount)} of ${escape_html(totalCount)}</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div> <div${attr_class("filter-drawer svelte-tph1t1", void 0, { "collapsed": collapsed })}><div class="filter-drawer-inner svelte-tph1t1"><div class="drawer-row svelte-tph1t1"><div class="filter-group svelte-tph1t1"><!--[-->`);
    const each_array = ensure_array_like(RESULT_OPTS);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let o = each_array[$$index];
      $$renderer2.push(`<button${attr_class("filter-btn svelte-tph1t1", void 0, { "active": filters.result === o.v })}>${escape_html(o.label)}</button>`);
    }
    $$renderer2.push(`<!--]--></div> <div class="filter-group svelte-tph1t1"><!--[-->`);
    const each_array_1 = ensure_array_like(TYPE_OPTS);
    for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
      let o = each_array_1[$$index_1];
      $$renderer2.push(`<button${attr_class("filter-btn svelte-tph1t1", void 0, { "active": filters.type === o.v })}>${escape_html(o.label)}</button>`);
    }
    $$renderer2.push(`<!--]--></div> <div class="filter-group svelte-tph1t1"><!--[-->`);
    const each_array_2 = ensure_array_like(CM_OPTS);
    for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
      let o = each_array_2[$$index_2];
      $$renderer2.push(`<button${attr_class("filter-btn svelte-tph1t1", void 0, { "active": filters.cmMode === o.v })}>${escape_html(o.label)}</button>`);
    }
    $$renderer2.push(`<!--]--></div></div> <div class="drawer-row svelte-tph1t1"><div class="filter-group svelte-tph1t1"><!--[-->`);
    const each_array_3 = ensure_array_like(DATE_OPTS);
    for (let $$index_3 = 0, $$length = each_array_3.length; $$index_3 < $$length; $$index_3++) {
      let o = each_array_3[$$index_3];
      $$renderer2.push(`<button${attr_class("filter-btn svelte-tph1t1", void 0, { "active": filters.datePreset === o.v })}>${escape_html(o.label)}</button>`);
    }
    $$renderer2.push(`<!--]--></div> `);
    if (filters.datePreset === "custom") {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="date-range svelte-tph1t1"><input type="date" class="filter-date svelte-tph1t1"${attr("value", filters.dateFrom)}${attr("max", filters.dateTo || void 0)} aria-label="From date"/> <span class="date-sep svelte-tph1t1">→</span> <input type="date" class="filter-date svelte-tph1t1"${attr("value", filters.dateTo)}${attr("min", filters.dateFrom || void 0)} aria-label="To date"/></div> <div class="time-range svelte-tph1t1"><input type="time" class="filter-time svelte-tph1t1"${attr("value", filters.timeFrom)} step="60" aria-label="From time"/> <span class="date-sep svelte-tph1t1">→</span> <input type="time" class="filter-time svelte-tph1t1"${attr("value", filters.timeTo)} step="60" aria-label="To time"/></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div> <div class="drawer-row selects-row svelte-tph1t1">`);
    $$renderer2.select(
      {
        class: "filter-select",
        value: filters.boss,
        onchange: (e) => {
          filters.boss = e.currentTarget.value;
          onchange?.();
        }
      },
      ($$renderer3) => {
        $$renderer3.option(
          { value: "all", class: "" },
          ($$renderer4) => {
            $$renderer4.push(`All Bosses`);
          },
          "svelte-tph1t1"
        );
        $$renderer3.push(`<!--[-->`);
        const each_array_4 = ensure_array_like(bosses);
        for (let $$index_4 = 0, $$length = each_array_4.length; $$index_4 < $$length; $$index_4++) {
          let b = each_array_4[$$index_4];
          $$renderer3.option(
            { value: b.key, class: "" },
            ($$renderer4) => {
              $$renderer4.push(`${escape_html(b.label)}`);
            },
            "svelte-tph1t1"
          );
        }
        $$renderer3.push(`<!--]-->`);
      },
      "svelte-tph1t1"
    );
    $$renderer2.push(` `);
    $$renderer2.select(
      {
        class: "filter-select",
        value: filters.vlRank,
        onchange: (e) => {
          filters.vlRank = e.currentTarget.value;
          onchange?.();
        }
      },
      ($$renderer3) => {
        $$renderer3.option(
          { value: "all", class: "" },
          ($$renderer4) => {
            $$renderer4.push(`Any Rank`);
          },
          "svelte-tph1t1"
        );
        $$renderer3.option(
          { value: "none", class: "" },
          ($$renderer4) => {
            $$renderer4.push(`No Rank`);
          },
          "svelte-tph1t1"
        );
        $$renderer3.option(
          { value: "any", class: "" },
          ($$renderer4) => {
            $$renderer4.push(`Has Rank`);
          },
          "svelte-tph1t1"
        );
        $$renderer3.push(`<!--[-->`);
        const each_array_5 = ensure_array_like(vlRanks);
        for (let $$index_5 = 0, $$length = each_array_5.length; $$index_5 < $$length; $$index_5++) {
          let r = each_array_5[$$index_5];
          $$renderer3.option(
            { value: r.id, class: "" },
            ($$renderer4) => {
              $$renderer4.push(`${escape_html(r.icon)} ${escape_html(r.label)}`);
            },
            "svelte-tph1t1"
          );
        }
        $$renderer3.push(`<!--]-->`);
      },
      "svelte-tph1t1"
    );
    $$renderer2.push(` <button${attr_class("prof-filter-btn svelte-tph1t1", void 0, { "active": filters.profession !== "all" })} title="Filter by profession">`);
    if (selectedSpec()) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<img${attr("src", selectedSpec().icon)} alt="" class="pb-icon svelte-tph1t1"/> ${escape_html(selectedSpec().name)}`);
    } else if (selectedProf()) {
      $$renderer2.push("<!--[1-->");
      $$renderer2.push(`<img${attr("src", selectedProf().icon)} alt="" class="pb-icon svelte-tph1t1"/> ${escape_html(selectedProf().name)}`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`All Professions`);
    }
    $$renderer2.push(`<!--]--> <i class="fa-solid fa-chevron-down pb-caret svelte-tph1t1"></i></button> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (hasActive()) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<button class="clear-filters-btn svelte-tph1t1" title="Clear all filters">✕ Clear All Filters</button>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div></div></div> `);
    if (activeChips().length > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="filter-chips svelte-tph1t1"><!--[-->`);
      const each_array_8 = ensure_array_like(activeChips());
      for (let $$index_8 = 0, $$length = each_array_8.length; $$index_8 < $$length; $$index_8++) {
        let c = each_array_8[$$index_8];
        $$renderer2.push(`<button class="filter-chip svelte-tph1t1" title="Remove filter"><span>${escape_html(c.label)}</span> <span class="chip-x svelte-tph1t1">✕</span></button>`);
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
const PROFESSIONS = {
  1: { name: "Guardian", icon: "/professions/guardian.png", color: "#2d6cdf", abbr: "Gd" },
  2: { name: "Warrior", icon: "/professions/warrior.png", color: "#c2410c", abbr: "Wr" },
  3: { name: "Engineer", icon: "/professions/engineer.png", color: "#ca8a04", abbr: "En" },
  4: { name: "Ranger", icon: "/professions/ranger.png", color: "#16a34a", abbr: "Rg" },
  5: { name: "Thief", icon: "/professions/thief.png", color: "#6b7280", abbr: "Th" },
  6: { name: "Elementalist", icon: "/professions/elementalist.png", color: "#dc2626", abbr: "El" },
  7: { name: "Mesmer", icon: "/professions/mesmer.png", color: "#7c3aed", abbr: "Ms" },
  8: { name: "Necromancer", icon: "/professions/necromancer.png", color: "#15803d", abbr: "Nc" },
  9: { name: "Revenant", icon: "/professions/revenant.png", color: "#0f766e", abbr: "Rv" }
};
const ELITE_SPEC_ICONS = {
  // Core professions (fallback handled separately)
  5: "/professions/druid.png",
  // Ranger
  7: "/professions/daredevil.png",
  // Thief
  18: "/professions/berserker.png",
  // Warrior
  27: "/professions/dragonhunter.png",
  // Guardian
  34: "/professions/reaper.png",
  // Necromancer
  40: "/professions/chronomancer.png",
  // Mesmer
  43: "/professions/scrapper.png",
  // Engineer
  48: "/professions/tempest.png",
  // Elementalist
  52: "/professions/herald.png",
  // Revenant
  55: "/professions/soulbeast.png",
  // Ranger
  56: "/professions/weaver.png",
  // Elementalist
  57: "/professions/holosmith.png",
  // Engineer
  58: "/professions/deadeye.png",
  // Thief
  59: "/professions/mirage.png",
  // Mesmer
  60: "/professions/scourge.png",
  // Necromancer
  61: "/professions/spellbreaker.png",
  // Warrior
  62: "/professions/firebrand.png",
  // Guardian
  63: "/professions/renegade.png",
  // Revenant
  64: "/professions/harbinger.png",
  // Necromancer
  65: "/professions/willbender.png",
  // Guardian
  66: "/professions/virtuoso.png",
  // Mesmer
  67: "/professions/catalyst.png",
  // Elementalist
  68: "/professions/bladesworn.png",
  // Warrior
  69: "/professions/vindicator.png",
  // Revenant
  70: "/professions/mechanist.png",
  // Engineer
  71: "/professions/specter.png",
  // Thief
  72: "/professions/untamed.png",
  // Ranger
  73: "/professions/troubadour.png",
  // (Janthir)
  74: "/professions/paragon.png",
  75: "/professions/amalgam.png",
  76: "/professions/ritualist.png",
  77: "/professions/antiquary.png",
  78: "/professions/galeshot.png",
  79: "/professions/conduit.png",
  80: "/professions/evoker.png",
  81: "/professions/luminary.png"
};
const SPEC_CORE = {
  5: 4,
  55: 4,
  72: 4,
  // Ranger: Druid, Soulbeast, Untamed
  7: 5,
  58: 5,
  71: 5,
  // Thief: Daredevil, Deadeye, Specter
  18: 2,
  61: 2,
  68: 2,
  // Warrior: Berserker, Spellbreaker, Bladesworn
  27: 1,
  62: 1,
  65: 1,
  81: 1,
  // Guardian: Dragonhunter, Firebrand, Willbender, Luminary
  34: 8,
  60: 8,
  64: 8,
  // Necromancer: Reaper, Scourge, Harbinger
  40: 7,
  59: 7,
  66: 7,
  // Mesmer: Chronomancer, Mirage, Virtuoso
  43: 3,
  57: 3,
  70: 3,
  // Engineer-focused; clarified below
  48: 6,
  56: 6,
  67: 6,
  // Elementalist: Tempest, Weaver, Catalyst
  52: 9,
  63: 9,
  69: 9,
  // Revenant: Herald, Renegade, Vindicator
  73: 7,
  74: 2,
  75: 3,
  76: 8,
  77: 5,
  78: 4,
  79: 9,
  80: 6
  // Janthir: Troubadour(Mes), Paragon(War), Amalgam(Eng),
  // Ritualist(Nec), Antiquary(Thf), Galeshot(Rgr),
  // Conduit(Rev), Evoker(Ele)
};
function buildProfessionGroups() {
  return Object.entries(PROFESSIONS).map(([id, p]) => {
    const coreId = Number(id);
    const specs = Object.entries(SPEC_CORE).filter(([, c]) => c === coreId).map(([sid]) => {
      const specId = Number(sid);
      const icon = ELITE_SPEC_ICONS[specId] ?? p.icon;
      const name = (icon.split("/").pop() ?? "core").replace(".png", "").replace(/^\w/, (c) => c.toUpperCase());
      return { id: specId, name, icon };
    });
    return { id: coreId, name: p.name, icon: p.icon, specs };
  });
}
const PROFESSION_GROUPS = buildProfessionGroups();
(() => {
  const out = {};
  for (const g of buildProfessionGroups()) for (const s of g.specs) out[s.id] = s.name;
  return out;
})();
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let discord_webhooks = [];
    let activeMenuCard = null;
    let tabIndicator = { left: 0, top: 0, width: 0, height: 0, visible: false };
    let footerIndicator = { left: 0, top: 0, width: 0, height: 0, visible: false };
    let manualFilePath = "";
    let expanded = {};
    let notesOpen = {};
    let wingmanQueue = [];
    let wingmanQueueRunning = false;
    let dpsQueue = [];
    let dpsQueueRunning = false;
    let uploadQueue = [];
    let uploadPaused = false;
    let queueDrawerOpen = false;
    let queuePulse = false;
    let queuedCount = derived(() => uploadQueue.filter((q) => q.state === "queued").length);
    let activeCount = derived(() => uploadQueue.filter((q) => q.state === "active").length);
    let vlCatalog = [];
    invoke("get_vl_rank_catalog").then((c) => {
      vlCatalog = c;
    }).catch(() => {
    });
    let appVersion = "…";
    getVersion().then((v) => {
      appVersion = v;
    }).catch(() => {
    });
    function normalizeBoss(name) {
      return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    }
    function vlEncounterFor(log) {
      const key = normalizeBoss(log.boss_name);
      return vlCatalog.find((e) => e.key === key || (e.aliases ?? []).includes(key));
    }
    function vlAvailableFor(log) {
      const enc = vlEncounterFor(log);
      if (!enc) return false;
      return log.is_cm === true || log.is_lcm === true;
    }
    function vlCurrentRanks(log) {
      const enc = vlEncounterFor(log);
      if (!enc || !log.vl_rank) return [];
      const ids = Array.isArray(log.vl_rank) ? log.vl_rank : [log.vl_rank];
      return enc.ranks.filter((r) => ids.includes(r.id));
    }
    function vlRanksOf(log) {
      if (!log?.vl_rank) return [];
      return Array.isArray(log.vl_rank) ? log.vl_rank : [log.vl_rank];
    }
    let playerIconsLoaded = {};
    let filters = {
      result: "all",
      type: "all",
      boss: "all",
      // "all" or normalized boss key
      vlRank: "all",
      // "all" | "none" | "any" | specific id
      cmMode: "all",
      search: "",
      datePreset: "all",
      dateFrom: "",
      // "YYYY-MM-DD" (from custom range)
      dateTo: "",
      // "YYYY-MM-DD" (from custom range)
      timeFrom: "",
      // "HH:MM" optional time-of-day lower bound
      timeTo: "",
      // "HH:MM" optional time-of-day upper bound
      profession: "all",
      // "all" or a PROFESSIONS key / elite_spec id
      professionKind: "all"
    };
    const RAID_BOSSES = /* @__PURE__ */ new Set([
      // Wing 1 – Spirit Vale
      "valeguardian",
      "spiritrun",
      "spiritrace",
      "spiritwoods",
      // pre-event variants
      "gorsevalthemultifarious",
      "gorseval",
      "sabethathesaboteur",
      "sabetha",
      // Wing 2 – Salvation Pass
      "slothasor",
      "bandittrio",
      "banditescort",
      "escort",
      // Bandit Trio + pre-event name variants
      "matthiasgabrel",
      "matthias",
      // Wing 3 – Stronghold of the Faithful
      "siegethestronghold",
      "escorttw",
      "mcleod",
      "mcleodthesilent",
      // Escort/Siege pre-event/boss variants
      "keepconstruct",
      "twistedcastle",
      // pre-event
      "xera",
      // Wing 4 – Bastion of the Penitent
      "cairntheindomitable",
      "cairn",
      "mursaatoverseer",
      "samarog",
      "deimos",
      // Wing 5 – Hall of Chains
      "soullesshorror",
      "desmina",
      "riverofsouls",
      // pre-event
      "statuegrenth",
      "statueofgrenth",
      "statues",
      // Statues of Grenth pre-event
      "eyeoffate",
      "eyesoffate",
      "eyesofjudgment",
      "eyesofjudgement",
      "eyes",
      // Statue of Darkness
      "brokenking",
      "statueofice",
      // Statue of Ice
      "souleater",
      "eaterofsouls",
      "statueofdeath",
      // Statue of Death
      "dhuum",
      // Wing 6 – Mythwright Gambit
      "conjuredamalgamate",
      "largostwins",
      "twinlargos",
      "nikare",
      "nikarerenut",
      "nikareandkenut",
      "qadim",
      // Wing 7 – The Key of Ahdashim
      "cardinalsabir",
      "cardinaladina",
      "qadimthepeerless",
      "gate",
      "keyofahdashimgate",
      "keyofahdashim",
      // Gate pre-event/escort
      // Wing 8 – Mount Balrior
      "greer",
      "greerthebightbringer",
      "greertheblightbringer",
      "decima",
      "decimathestormsinger",
      "ura",
      "urathesteamshrieker"
    ]);
    const HPLESS_ENCOUNTERS = /* @__PURE__ */ new Set([
      "spiritrun",
      "spiritrace",
      "spiritwoods",
      // W1 — Spirit Run pre-event
      "twistedcastle",
      // W3 — Twisted Castle pre-event
      "riverofsouls",
      // W5 — River of Souls pre-event
      "gate",
      "keyofahdashimgate",
      "keyofahdashim"
      // W7 — Key of Ahdashim Gate pre-event/escort
    ]);
    function shouldShowHpLeft(log) {
      if (isStoryBoss(log.boss_name, log)) return false;
      return !HPLESS_ENCOUNTERS.has(clean(log.boss_name));
    }
    const FRACTAL_BOSSES = /* @__PURE__ */ new Set([
      "mama",
      "siaxthecorrupted",
      "ensolyssoftheendlesstorment",
      "ensolyssofendlesstorment",
      "skorvaldtheshattered",
      "artsariiv",
      "arkk",
      "aikeeperofthepeak",
      "ai",
      "kanaxaiscytheofsouls",
      "kanaxai",
      "eparchthelonelyking",
      "eparch",
      "captainmaitrin",
      "maitrin",
      "horrik",
      "aetherbladelet",
      "frizz",
      "jellyfishbeast",
      "jellyfish",
      "archdiviner",
      "thevoice",
      "deepstonevoice",
      "moltenberserker",
      "moltenfirestorm",
      "moltenboss",
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
    const BOSS_ICONS = /* @__PURE__ */ new Set([
      "aetherbladehideout",
      "bandittrio",
      "boneskinner",
      "brokenking",
      "cairntheindomitable",
      "cardinaladina",
      "cardinalsabir",
      "conjuredamalgamate",
      "cosmicobservatory",
      "decima",
      "deimos",
      "dhuum",
      "dragonvoid",
      "eaterofsouls",
      "eyeoffate",
      "eyes",
      "eyesoffate",
      "fraenirofjormag",
      "gorseval",
      "gorsevalthemultifarious",
      "greer",
      "harvesttemple",
      "icebroodconstruct",
      "kainengoverlook",
      "keepconstruct",
      "kela",
      "largostwins",
      "maitrin",
      "matthiasgabrel",
      "mcleodthesilent",
      "ministerli",
      "mursaatoverseer",
      "oldlionscourt",
      "prototypevermilion",
      "qadim",
      "qadimthepeerless",
      "riverofsouls",
      "sabethathesaboteur",
      "samarog",
      "slothasor",
      "souleater",
      "soullesshorror",
      "spiritrace",
      "standardkittygolem",
      "templeoffebe",
      "twinlargos",
      "twistedcastle",
      "ura",
      "valeguardian",
      "variniastormsounder",
      "voiceandclaw",
      "whisperingshadow",
      "whisperofjormag",
      "xera",
      "xunlaijadejunkyard",
      "nexusofeternity",
      "solitarythrone"
    ]);
    const WINGS = [
      {
        name: "Wing 1 · Spirit Vale",
        bosses: [
          "valeguardian",
          "spiritrun",
          "spiritrace",
          "spiritwoods",
          "gorsevalthemultifarious",
          "gorseval",
          "sabethathesaboteur",
          "sabetha"
        ]
      },
      {
        name: "Wing 2 · Salvation Pass",
        bosses: [
          "slothasor",
          "bandittrio",
          "banditescort",
          "escort",
          "matthiasgabrel",
          "matthias"
        ]
      },
      {
        name: "Wing 3 · Stronghold of the Faithful",
        bosses: [
          "siegethestronghold",
          "escorttw",
          "mcleod",
          "mcleodthesilent",
          "keepconstruct",
          "twistedcastle",
          "xera"
        ]
      },
      {
        name: "Wing 4 · Bastion of the Penitent",
        bosses: [
          "cairntheindomitable",
          "cairn",
          "mursaatoverseer",
          "samarog",
          "deimos"
        ]
      },
      {
        name: "Wing 5 · Hall of Chains",
        bosses: [
          "soullesshorror",
          "desmina",
          "riverofsouls",
          "statuegrenth",
          "statueofgrenth",
          "statues",
          "eyeoffate",
          "eyesoffate",
          "eyesofjudgment",
          "eyesofjudgement",
          "eyes",
          "brokenking",
          "statueofice",
          "souleater",
          "eaterofsouls",
          "statueofdeath",
          "dhuum"
        ]
      },
      {
        name: "Wing 6 · Mythwright Gambit",
        bosses: [
          "conjuredamalgamate",
          "largostwins",
          "twinlargos",
          "nikare",
          "nikarekenut",
          "nikareandkenut",
          "qadim"
        ]
      },
      {
        name: "Wing 7 · The Key of Ahdashim",
        bosses: [
          "gate",
          "keyofahdashimgate",
          "keyofahdashim",
          "cardinalsabir",
          "cardinaladina",
          "qadimthepeerless"
        ]
      },
      {
        name: "Wing 8 · Mount Balrior",
        bosses: [
          "greer",
          "greerthebightbringer",
          "greertheblightbringer",
          "decima",
          "decimathestormsinger",
          "ura",
          "urathesteamshrieker"
        ]
      }
    ];
    const BOSS_CATEGORIES = {
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
    const BOSS_TO_WING = {};
    WINGS.forEach((w, i) => w.bosses.forEach((b) => {
      BOSS_TO_WING[b] = i;
    }));
    function getFractalName(bossName, numPlayers) {
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
    function getEncounterType(bossName, numPlayers, isConvergence) {
      if (!bossName) return "raid";
      if (isConvergence === true) return "convergence";
      const c = clean(bossName);
      if ([
        "sorrow",
        "demonknight",
        "dreadwing",
        "hellsister",
        "umbriel",
        "convergenceouternayos"
      ].includes(c)) {
        return "convergence";
      }
      if ([
        "greer",
        "greerthebightbringer",
        "greertheblightbringer",
        "decima",
        "decimathestormsinger",
        "ura",
        "urathesteamshrieker",
        "convergencemountbalrior"
      ].includes(c)) {
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
    let selectedLogs = /* @__PURE__ */ new Set();
    let wingCollapsed = {};
    let categoryCollapsed = {};
    let uploads = [];
    let deletedPaths = /* @__PURE__ */ new Set();
    function clean(s) {
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
    function isDragonvoid(bossName) {
      const c = (bossName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return c === "dragonvoid" || c === "harvesttemple" || c === "thedragonvoid";
    }
    function isKainengOverlook(bossName) {
      if (!bossName) return false;
      const c = clean(bossName);
      return c === "kainengoverlook" || c === "ministerli";
    }
    const STRIKE_REGISTRY = {
      // Icebrood Saga
      shiverpeakspass: {
        expansion: "Icebrood Saga",
        strike: "Shiverpeak Pass",
        boss: "Whisper of Jormag"
      },
      variniastormsounder: {
        expansion: "Icebrood Saga",
        strike: "Cold War",
        boss: "Varinia Stormsounder"
      },
      icebroodconstruct: {
        expansion: "Icebrood Saga",
        strike: "Icebrood Construct",
        boss: "Icebrood Construct"
      },
      voiceofthefallen: {
        expansion: "Icebrood Saga",
        strike: "Voice of the Fallen",
        boss: "Voice and Claw of the Fallen"
      },
      clawofthefallen: {
        expansion: "Icebrood Saga",
        strike: "Claw of the Fallen",
        boss: "Voice and Claw of the Fallen"
      },
      voiceandclaw: {
        expansion: "Icebrood Saga",
        strike: "Voice and Claw of the Fallen",
        boss: "Voice and Claw of the Fallen"
      },
      kodanbrothers: {
        expansion: "Icebrood Saga",
        strike: "Kodan Brothers",
        boss: "Kodan Brothers"
      },
      fraenirofjormag: {
        expansion: "Icebrood Saga",
        strike: "Fraenir of Jormag",
        boss: "Fraenir of Jormag"
      },
      fraenir: {
        expansion: "Icebrood Saga",
        strike: "Fraenir of Jormag",
        boss: "Fraenir of Jormag"
      },
      boneskinner: {
        expansion: "Icebrood Saga",
        strike: "Boneskinner",
        boss: "Boneskinner"
      },
      whisperofjormag: {
        expansion: "Icebrood Saga",
        strike: "Whisper of Jormag",
        boss: "Whisper of Jormag"
      },
      whisper: {
        expansion: "Icebrood Saga",
        strike: "Whisper of Jormag",
        boss: "Whisper of Jormag"
      },
      coldwar: {
        expansion: "Icebrood Saga",
        strike: "Cold War",
        boss: "Cold War"
      },
      // End of Dragons
      captainmaitrin: {
        expansion: "End of Dragons",
        strike: "Aetherblade Hideout",
        boss: "Captain Mai Trin"
      },
      maitrin: {
        expansion: "End of Dragons",
        strike: "Aetherblade Hideout",
        boss: "Captain Mai Trin"
      },
      aetherbladehideout: {
        expansion: "End of Dragons",
        strike: "Aetherblade Hideout",
        boss: "Captain Mai Trin"
      },
      xunlaijadejunkyard: {
        expansion: "End of Dragons",
        strike: "Xunlai Jade Junkyard",
        boss: "Ankka"
      },
      ankka: {
        expansion: "End of Dragons",
        strike: "Xunlai Jade Junkyard",
        boss: "Ankka"
      },
      kainengoverlook: {
        expansion: "End of Dragons",
        strike: "Kaineng Overlook",
        boss: "Minister Li"
      },
      ministerli: {
        expansion: "End of Dragons",
        strike: "Kaineng Overlook",
        boss: "Minister Li"
      },
      thedragonvoid: {
        expansion: "End of Dragons",
        strike: "Harvest Temple",
        boss: "The Dragonvoid"
      },
      dragonvoid: {
        expansion: "End of Dragons",
        strike: "Harvest Temple",
        boss: "The Dragonvoid"
      },
      harvesttemple: {
        expansion: "End of Dragons",
        strike: "Harvest Temple",
        boss: "The Dragonvoid"
      },
      oldlionscourt: {
        expansion: "End of Dragons",
        strike: "Old Lion's Court",
        boss: "Prototype Watchknights"
      },
      oldlion: {
        expansion: "End of Dragons",
        strike: "Old Lion's Court",
        boss: "Prototype Watchknights"
      },
      prototypevermilion: {
        expansion: "End of Dragons",
        strike: "Old Lion's Court",
        boss: "Prototype Watchknights"
      },
      prototypeindigo: {
        expansion: "End of Dragons",
        strike: "Old Lion's Court",
        boss: "Prototype Watchknights"
      },
      prototypegold: {
        expansion: "End of Dragons",
        strike: "Old Lion's Court",
        boss: "Prototype Watchknights"
      },
      // Secrets of the Obscure
      cosmicobservatory: {
        expansion: "Secrets of the Obscure",
        strike: "Cosmic Observatory",
        boss: "Dagda"
      },
      dagda: {
        expansion: "Secrets of the Obscure",
        strike: "Cosmic Observatory",
        boss: "Dagda"
      },
      templeoffebe: {
        expansion: "Secrets of the Obscure",
        strike: "Temple of Febe",
        boss: "Cerus"
      },
      cerus: {
        expansion: "Secrets of the Obscure",
        strike: "Temple of Febe",
        boss: "Cerus"
      },
      // Visions of Eternity (Janthir-era strike rebrand; Kela lives here per user)
      kela: {
        expansion: "Visions of Eternity",
        strike: "Guardian's Glade",
        boss: "Kela, Seneschal of Waves"
      },
      kelaseneschalofwaves: {
        expansion: "Visions of Eternity",
        strike: "Guardian's Glade",
        boss: "Kela, Seneschal of Waves"
      },
      // Visions of Eternity: Nexus of Eternity (new strike encounter)
      vloxx: {
        expansion: "Visions of Eternity",
        strike: "Nexus of Eternity",
        boss: "Vloxx"
      },
      // Special Forces Training Area (golem / training dummies)
      standardkittygolem: {
        expansion: "Special Forces Training Area",
        strike: "Kitty Golem",
        boss: "Standard Kitty Golem"
      },
      kittygolem: {
        expansion: "Special Forces Training Area",
        strike: "Kitty Golem",
        boss: "Kitty Golem"
      },
      golem: {
        expansion: "Special Forces Training Area",
        strike: "Kitty Golem",
        boss: "Kitty Golem"
      },
      // Personal Story (asura lvl-10 arc). dps.report labels these by INSTANCE name.
      // Keyed on instance keywords so any boss-NPC name dps.report sends maps to the right
      // instance. Map IDs kept for future-proofing (option to parse map_id from EVTC later).
      //   The Snaff Prize (map 579), Taking Credit Back (584), A Sparkling Rescue (581),
      //   Stand By Your Krewe (594), Here/There/Everywhere (587)
      snaffprize: {
        expansion: "Personal Story",
        strike: "The Snaff Prize",
        boss: "The Snaff Prize"
      },
      thesnaffprize: {
        expansion: "Personal Story",
        strike: "The Snaff Prize",
        boss: "The Snaff Prize"
      },
      takingcreditback: {
        expansion: "Personal Story",
        strike: "Taking Credit Back",
        boss: "Taking Credit Back"
      },
      sparklingrescue: {
        expansion: "Personal Story",
        strike: "A Sparkling Rescue",
        boss: "A Sparkling Rescue"
      },
      asparklingrescue: {
        expansion: "Personal Story",
        strike: "A Sparkling Rescue",
        boss: "A Sparkling Rescue"
      },
      standbyyourkrewe: {
        expansion: "Personal Story",
        strike: "Stand By Your Krewe",
        boss: "Stand By Your Krewe"
      },
      herethere: {
        expansion: "Personal Story",
        strike: "Here, There, Everywhere",
        boss: "Here, There, Everywhere"
      },
      herethereeverywhere: {
        expansion: "Personal Story",
        strike: "Here, There, Everywhere",
        boss: "Here, There, Everywhere"
      }
    };
    function getStrikeInfo(bossName) {
      if (!bossName) return void 0;
      return STRIKE_REGISTRY[clean(bossName)];
    }
    function getStoryInstance(bossName, log) {
      if (log?.is_story) return log.boss_name ?? (bossName ? STRIKE_REGISTRY[clean(bossName)]?.strike : void 0);
      if (!bossName) return void 0;
      const c = clean(bossName);
      const si = STRIKE_REGISTRY[c];
      return si && si.expansion === "Personal Story" ? si.strike : void 0;
    }
    function isStoryBoss(bossName, log) {
      if (log?.is_story) return true;
      if (!bossName) return false;
      return clean(bossName) in STRIKE_REGISTRY && STRIKE_REGISTRY[clean(bossName)]?.expansion === "Personal Story";
    }
    function getStoryIcon(bossName, log) {
      if (!isStoryBoss(bossName, log)) return void 0;
      return `/story_icons/${clean(bossName)}.png`;
    }
    function getBossDisplayName(bossName) {
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
    function getModeBossDisplayName(bossName, log) {
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
    function formatDuration(seconds) {
      if (seconds == null || Number.isNaN(seconds)) return "0:00";
      const total = Math.max(0, Math.floor(seconds));
      const mins = Math.floor(total / 60);
      const secs = total % 60;
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    }
    function isGolemLog(log) {
      return clean(log.boss_name).includes("golem");
    }
    function uploadStageList(log) {
      const order = ["Queued", "Reading", "Parsing", "Uploading"];
      const idx = order.indexOf(log.stage ?? "");
      const stages = idx >= 0 ? order.map((s, i) => ({
        label: s,
        state: i < idx ? "done" : i === idx ? "active" : "pending"
      })) : order.map((s) => ({ label: s, state: "pending" }));
      const activeLabel = idx >= 0 ? order[idx] : log.stage ?? "";
      stages.forEach((s) => {
        const i = order.indexOf(s.label);
        if (i >= 0) s.state = i < order.indexOf(activeLabel) ? "done" : i === order.indexOf(activeLabel) ? "active" : "pending";
      });
      const TERMINAL = [
        "Processing",
        "Completed",
        "Duplicate",
        "Failed",
        "On Hold",
        "Off Hold"
      ];
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
      stages.push({
        label: "Resolved",
        state: TERMINAL.includes(log.status) ? "done" : "pending"
      });
      return stages;
    }
    function isReadingLog(log) {
      return !log.boss_name;
    }
    const DRAGON_SEQUENCE = [
      { key: "jormag", name: "Jormag" },
      { key: "primordus", name: "Primordus" },
      { key: "kralkatorrik", name: "Kralkatorrik" },
      { key: "mordremoth", name: "Mordremoth" },
      { key: "zhaitan", name: "Zhaitan" },
      { key: "soowon", name: "Soo-Won" }
    ];
    function dragonCouncil(hp) {
      const byKey = new Map(hp.map((d) => [d.key, d]));
      let reachedAny = false;
      return DRAGON_SEQUENCE.map((seq) => {
        const d = byKey.get(seq.key);
        let state;
        let pct = d && d.died ? 0 : 100;
        let reached = false;
        if (d) {
          reached = true;
          state = d.died ? "dead" : "alive";
        } else if (reachedAny) {
          reached = true;
          state = "alive";
        } else {
          state = "unreached";
        }
        if (d) reachedAny = true;
        return {
          key: seq.key,
          name: seq.name,
          state,
          pct,
          reached,
          hp_left: d ? d.hp_left : 100
        };
      });
    }
    function orderForAdd(name) {
      const orderMap = {
        timecaster: 0,
        giants: 1,
        saltspray: 2,
        obliterator: 3,
        goliath: 4
      };
      return orderMap[name] ?? 99;
    }
    function dragonCouncilMerged(phases, hpByKey) {
      const purification2 = phases.find((p) => p.key === "purification2");
      return phases.map((p) => {
        const hp = hpByKey.get(p.key);
        const hasHp = hp != null;
        const effectiveCleared = p.key === "timecaster" && purification2 != null ? purification2.cleared : p.cleared;
        const isDragon = p.kind === "dragon";
        const died = isDragon ? effectiveCleared : hasHp ? hp.died : false;
        const hpLeft = isDragon ? effectiveCleared ? 0 : 100 : hasHp ? hp.hp_left : null;
        const hpState = isDragon ? effectiveCleared ? "dead" : "alive" : hasHp ? hp.died ? "dead" : "alive" : "dead";
        return {
          key: p.key,
          name: p.name,
          icon: p.icon ? `/bosses/${p.icon}.png` : `/bosses/the${p.key}void.png`,
          kind: p.kind,
          cleared: effectiveCleared,
          hp: hpLeft,
          died,
          hpState
        };
      });
    }
    function formatDps(dps) {
      if (dps == null || Number.isNaN(dps)) return "";
      if (dps >= 1e6) return (dps / 1e6).toFixed(2) + "M";
      if (dps >= 1e3) return (dps / 1e3).toFixed(1) + "k";
      return Math.round(dps).toString();
    }
    function formatComplete(dmg) {
      if (dmg == null || Number.isNaN(dmg)) return "";
      return Math.round(dmg).toLocaleString("en-US");
    }
    function formatTotalTime(seconds) {
      return formatDuration(seconds);
    }
    function getBossIcon(bossName, numPlayers) {
      const c = clean(bossName);
      if (!c) return "/bosses/unknown.png";
      const key = BOSS_ICON_ALIASES[c] ?? c;
      if (getEncounterType(bossName, numPlayers, void 0) === "convergence") {
        const CONV_ICON_KEY = {
          greer: "greer",
          greerthebightbringer: "greer",
          greertheblightbringer: "greer",
          decima: "decima",
          decimathestormsinger: "decima",
          ura: "ura",
          urathesteamshrieker: "ura",
          // Mount Balrior metrix has no dedicated asset; reuse Greer as before.
          convergencemountbalrior: "greer"
        };
        const base = CONV_ICON_KEY[c] ?? (c === "convergenceouternayos" ? null : c);
        if (!base) return "/bosses/unknown.png";
        return `/convergences/${base}.png`;
      }
      if (FRACTAL_BOSSES.has(key)) return `/fractals/${key}.png`;
      if (BOSS_ICONS.has(key)) return `/bosses/${key}.png`;
      return "/bosses/unknown.png";
    }
    const BOSS_ICON_ALIASES = {
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
      ensolyssofendlesstorment: "ensolyssoftheendlesstorment",
      // typo variant -> real asset
      aikeeperofthepeak: "ai",
      // arcdps name -> ai.png
      kanaxaiscytheofsouls: "kanaxai",
      // arcdps name -> kanaxai.png
      eparchthelonelyking: "eparch",
      // arcdps name -> eparch.png
      eparch: "eparch",
      sorrowfulspellcaster: "ai",
      whisperingshadow: "whisperingshadow",
      // Old Lion's Court watchknights: dps.report may report the individual
      // Prototype (Vermilion/Indigo/Gold) rather than the strike name. Only
      // Vermilion has its own asset; Indigo & Gold fall back to the court icon.
      prototypeindigo: "oldlionscourt",
      prototypegold: "oldlionscourt"
    };
    function iconForExternal(url) {
      return url;
    }
    function resolveBossIconSrc(log) {
      const story = getStoryIcon(log.boss_name, log);
      if (story) return story;
      const local = getBossIcon(log.boss_name, log.num_players);
      if (local !== "/bosses/unknown.png") return local;
      if (log.boss_icon) return iconForExternal(log.boss_icon);
      return "/bosses/unknown.png";
    }
    const RAID_CM_INFO = {
      // Wing 1-3: Normal mode only, except Keep Construct (Wing 3) which has CM
      "keepconstruct": { cm: true, lcm: false },
      "kc": { cm: true, lcm: false },
      // xera / mcleod (escort) / stronghold → no CM
      // Wing 4: all bosses have CM
      "cairn": { cm: true, lcm: false },
      "cairntheindomitable": { cm: true, lcm: false },
      "mursaatoverseer": { cm: true, lcm: false },
      "samarog": { cm: true, lcm: false },
      "deimos": { cm: true, lcm: false },
      // Wing 5: Soulless Horror + Dhuum have CM; River of Souls (pre-event) & Statues do not
      "soullesshorror": { cm: true, lcm: false },
      "riverofsouls": { cm: false, lcm: false },
      "dhuum": { cm: true, lcm: false },
      // Wing 6: all bosses have CM
      "conjuredamalgamate": { cm: true, lcm: false },
      "largostwins": { cm: true, lcm: false },
      "twinlargos": { cm: true, lcm: false },
      "qadim": { cm: true, lcm: false },
      // Wing 7: all bosses have CM
      "cardinaladina": { cm: true, lcm: false },
      "cardinalsabir": { cm: true, lcm: false },
      "qadimthepeerless": { cm: true, lcm: false },
      // Wing 8: all bosses have CM; only Ura has LCM
      "greer": { cm: true, lcm: false },
      "greertheblightbringer": { cm: true, lcm: false },
      "decima": { cm: true, lcm: false },
      "decimathestormsinger": { cm: true, lcm: false },
      "ura": { cm: true, lcm: true },
      "urathesteamshrieker": { cm: true, lcm: true },
      // Strikes with CM; only Temple of Febe has LCM
      "cosmicobservatory": { cm: true, lcm: false },
      // dps.report reports Temple of Febe as "Cerus" (boss in-game name); treat as same LCM fight
      "cerus": { cm: true, lcm: true },
      "templeoffebe": { cm: true, lcm: true },
      "aetherbladehideout": { cm: true, lcm: false },
      "xunlaijadejunkyard": { cm: true, lcm: false },
      "kainengoverlook": { cm: true, lcm: false },
      "harvesttemple": { cm: true, lcm: false },
      "oldlionscourt": { cm: true, lcm: false },
      "dagda": { cm: true, lcm: false },
      // Janthir Wilds strikes
      "kela": { cm: true, lcm: false },
      "kelaseneschalofwaves": { cm: true, lcm: false }
    };
    function bossCmEligible(cleanName) {
      if (FRACTAL_BOSSES.has(cleanName)) return true;
      return !!RAID_CM_INFO[cleanName]?.cm;
    }
    function bossLcmEligible(cleanName) {
      if (FRACTAL_BOSSES.has(cleanName)) return false;
      return !!RAID_CM_INFO[cleanName]?.lcm;
    }
    function showChallengeMode(log) {
      if (log.is_convergence) return !!log.is_cm;
      const c = clean(log.boss_name);
      const enc = getEncounterType(log.boss_name, log.num_players, log.is_convergence);
      if (enc === "raid" || enc === "strike") return bossCmEligible(c) && !!log.is_cm;
      return !!log.is_cm;
    }
    function showLegendaryCm(log) {
      if (log.is_convergence) return !!log.is_lcm;
      const c = clean(log.boss_name);
      const enc = getEncounterType(log.boss_name, log.num_players, log.is_convergence);
      if (enc === "raid" || enc === "strike") return bossLcmEligible(c) && !!log.is_lcm;
      return false;
    }
    const PROFESSION_OPTIONS = Object.entries(PROFESSIONS).map(([id, p]) => ({ value: Number(id), name: p.name, icon: p.icon }));
    function getProfIcon(player) {
      if (player.elite_spec && ELITE_SPEC_ICONS[player.elite_spec]) {
        return ELITE_SPEC_ICONS[player.elite_spec];
      }
      return PROFESSIONS[player.profession]?.icon ?? "/professions/guardian.png";
    }
    function getSpecName(player) {
      const base = PROFESSIONS[player.profession]?.name ?? "Unknown";
      if (!player.elite_spec) return base;
      const fn = ELITE_SPEC_ICONS[player.elite_spec]?.split("/").pop()?.replace(".png", "");
      return fn ? fn.charAt(0).toUpperCase() + fn.slice(1) : base;
    }
    function getSpecAbbr(player) {
      if (player.elite_spec && ELITE_SPEC_ICONS[player.elite_spec]) {
        const fn = ELITE_SPEC_ICONS[player.elite_spec].split("/").pop().replace(".png", "");
        return fn.slice(0, 2).charAt(0).toUpperCase() + fn.slice(1, 2);
      }
      return PROFESSIONS[player.profession]?.abbr ?? "??";
    }
    function getProfColor(profession) {
      return PROFESSIONS[profession]?.color ?? "#64748b";
    }
    function groupBySubgroup(players) {
      const grouped = {};
      for (const p of players) {
        const sg = p.subgroup || 1;
        if (!grouped[sg]) grouped[sg] = [];
        grouped[sg].push(p);
      }
      return grouped;
    }
    function sortedSubgroups(players) {
      return Object.keys(groupBySubgroup(players)).map(Number).sort((a, b) => a - b);
    }
    function isCommander(player) {
      return player.role?.toLowerCase() === "tank" || player.role?.toLowerCase() === "commander";
    }
    let filteredUploads = derived(() => (() => {
      const deleted = deletedPaths;
      const list = uploads.filter((log) => {
        if (deleted.has(log.file_path)) return false;
        return passesFilters(log);
      });
      const active = list.filter((l) => l.status === "Uploading" || !l.boss_name);
      const finished = list.filter((l) => l.status !== "Uploading" && l.boss_name);
      if (finished.length > 50) {
        return [...active, ...finished.slice(0, 50)];
      }
      return list;
    })());
    function localYMD(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    function dateRange(f) {
      const now = /* @__PURE__ */ new Date();
      const today = localYMD(now);
      switch (f.datePreset) {
        case "all":
          return null;
        case "today":
          return { from: today, to: today };
        case "7d": {
          const d = new Date(now);
          d.setDate(d.getDate() - 6);
          return { from: localYMD(d), to: today };
        }
        case "30d": {
          const d = new Date(now);
          d.setDate(d.getDate() - 29);
          return { from: localYMD(d), to: today };
        }
        case "month": {
          const d = new Date(now.getFullYear(), now.getMonth(), 1);
          return { from: localYMD(d), to: today };
        }
        case "custom": {
          const from = f.dateFrom || "";
          const to = f.dateTo || "";
          if (!from && !to) return null;
          return { from: from || "0000-01-01", to: to || "9999-12-31" };
        }
      }
      return null;
    }
    function passesFilters(log) {
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
      if (f.profession !== "all") {
        const want = Number(f.profession);
        const has = (log.players ?? []).some((p) => f.professionKind === "spec" ? p.elite_spec === want : p.profession === want);
        if (!has) return false;
      }
      if (f.vlRank !== "all") {
        const ranks = vlRanksOf(log);
        if (f.vlRank === "none" && ranks.length > 0) return false;
        if (f.vlRank === "any" && ranks.length === 0) return false;
        if (f.vlRank !== "none" && f.vlRank !== "any" && !ranks.includes(f.vlRank)) return false;
      }
      if (f.datePreset !== "all") {
        const range = dateRange(f);
        if (range) {
          const d = log.timestamp ? log.timestamp.slice(0, 10) : "";
          if (!d) return false;
          if (d < range.from || d > range.to) return false;
        }
      }
      if (f.timeFrom || f.timeTo) {
        const t = log.timestamp ? log.timestamp.slice(11, 16) : "";
        if (!t) return false;
        if (f.timeFrom && t < f.timeFrom) return false;
        if (f.timeTo && t > f.timeTo) return false;
      }
      const q = f.search.trim().toLowerCase();
      if (q) {
        const bossMatch = (log.boss_name || "").toLowerCase().includes(q) || getBossDisplayName(log.boss_name).toLowerCase().includes(q) || getFractalName(log.boss_name).toLowerCase().includes(q);
        const playerMatch = log.players?.some((p) => p.display_name.toLowerCase().includes(q) || p.account.toLowerCase().includes(q) || getSpecName(p).toLowerCase().includes(q)) || false;
        if (!bossMatch && !playerMatch) return false;
      }
      return true;
    }
    function distinctBossOptions(logs) {
      const seen = /* @__PURE__ */ new Map();
      for (const l of logs) {
        if (!l.boss_name) continue;
        const key = clean(l.boss_name);
        if (!seen.has(key)) seen.set(key, getBossDisplayName(l.boss_name) || l.boss_name);
      }
      return [...seen.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
    }
    let sessions = [];
    let allHistory = [];
    let failedWingmanCount = derived(() => allHistory.filter((h) => h.wingman_status === "failed").length);
    let onHoldCount = derived(() => [...uploads, ...allHistory].filter((h) => h.status === "On Hold").length);
    let deletingLogPaths = /* @__PURE__ */ new Set();
    let dpsReportStatus = "unknown";
    let bDpsReportStatus = "unknown";
    let wingmanStatus = "unknown";
    let copiedLogPath = null;
    function isWingFullySelected(logs) {
      return logs.every((l) => selectedLogs.has(l.file_path));
    }
    function cardId(log) {
      return log.file_path;
    }
    let noteDraft = {};
    let groupedFeed = derived(() => {
      const items = [];
      const uploadingLogs = filteredUploads().filter((l) => l.status === "Uploading" || !l.boss_name);
      const resolvedLogs = filteredUploads().filter((l) => l.status !== "Uploading" && l.boss_name);
      if (uploadingLogs.length > 0) {
        items.push({
          kind: "group",
          bossName: "Active Uploads",
          bossBuckets: [
            {
              bossKey: "active",
              bossName: "Active Uploads",
              logs: uploadingLogs
            }
          ],
          logs: uploadingLogs
        });
      }
      const wingBuckets = /* @__PURE__ */ new Map();
      for (const log of resolvedLogs) {
        if (getEncounterType(log.boss_name, log.num_players, log.is_convergence) !== "raid") continue;
        const c = clean(log.boss_name);
        const wi = BOSS_TO_WING[c] ?? 999;
        if (!wingBuckets.has(wi)) wingBuckets.set(wi, /* @__PURE__ */ new Map());
        const bm = wingBuckets.get(wi);
        if (!bm.has(c)) bm.set(c, { bossName: log.boss_name ?? c, logs: [] });
        bm.get(c).logs.push(log);
      }
      const sortedWings = [...wingBuckets.keys()].sort((a, b) => a - b);
      for (const wi of sortedWings) {
        const bm = wingBuckets.get(wi);
        const wingName = wi < WINGS.length ? WINGS[wi].name : `Wing ${wi + 1}`;
        const orderedBossKeys = wi < WINGS.length ? WINGS[wi].bosses.filter((b) => bm.has(b)) : [...bm.keys()];
        for (const k of bm.keys()) {
          if (!orderedBossKeys.includes(k)) orderedBossKeys.push(k);
        }
        const bossBuckets = orderedBossKeys.map((bk) => ({
          bossKey: bk,
          bossName: bm.get(bk).bossName,
          logs: bm.get(bk).logs
        }));
        items.push({ kind: "wing", wingIdx: wi, wingName, bossBuckets });
      }
      const catBuckets = /* @__PURE__ */ new Map();
      for (const log of resolvedLogs) {
        if (getEncounterType(log.boss_name, log.num_players, log.is_convergence) === "raid") continue;
        const c = clean(log.boss_name);
        const frac = getFractalName(log.boss_name, log.num_players);
        const storyInst = getStoryInstance(log.boss_name, log);
        let catName = storyInst ? "Personal Story" : STRIKE_REGISTRY[c]?.expansion ?? (frac ? frac : BOSS_CATEGORIES[c] ?? (log.is_wvw ? "World vs World" : "Other Strikes"));
        if (getEncounterType(log.boss_name, log.num_players, log.is_convergence) === "convergence") {
          if ([
            "greer",
            "greerthebightbringer",
            "greertheblightbringer",
            "decima",
            "decimathestormsinger",
            "ura",
            "urathesteamshrieker"
          ].includes(c)) {
            catName = "Convergence: Mount Balrior";
          } else {
            catName = "Convergence: Outer Nayos";
          }
        }
        if (!catBuckets.has(catName)) catBuckets.set(catName, /* @__PURE__ */ new Map());
        const bm = catBuckets.get(catName);
        const strikeKey = storyInst ?? (STRIKE_REGISTRY[c]?.strike ?? getBossDisplayName(log.boss_name));
        const headerName = storyInst || frac || (STRIKE_REGISTRY[c]?.strike ?? getBossDisplayName(log.boss_name));
        if (!bm.has(strikeKey)) bm.set(strikeKey, { bossName: headerName, logs: [] });
        bm.get(strikeKey).logs.push(log);
      }
      for (const [catName, bm] of catBuckets) {
        const bossBuckets = [...bm.entries()].map(([bk, v]) => ({ bossKey: bk, bossName: v.bossName, logs: v.logs }));
        items.push({
          kind: "group",
          bossName: catName,
          bossBuckets,
          logs: bossBuckets.flatMap((b) => b.logs)
        });
      }
      return items;
    });
    let showTroubleshoot = {};
    let copiedDiagPath = null;
    let savedDiagPath = null;
    let retryingPaths = /* @__PURE__ */ new Set();
    function getLogSession(filePath) {
      return sessions.find((s) => s.logs.some((l) => l.file_path === filePath) || (s.subfolders ?? []).some((sf) => sf.logs.some((l) => l.file_path === filePath))) ?? null;
    }
    function logHeaderLeft($$renderer3, log) {
      $$renderer3.push(`<div class="log-header-left svelte-1uha8ag">`);
      if (log.status === "Failed") {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<div class="failed-icon-container svelte-1uha8ag" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 6px; font-size: 15px; color: #f87171; flex-shrink: 0; font-family: sans-serif; font-weight: bold;">⚠</div> <div class="boss-details svelte-1uha8ag" style="min-width: 0;"><div class="boss-title-row svelte-1uha8ag" style="display: flex; align-items: center; gap: 8px;"><span class="boss-name svelte-1uha8ag" style="color: #f87171; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Upload Failed: ${escape_html(log.file_name)}</span> <span class="badge badge-error svelte-1uha8ag" style="background: rgba(239,68,68,0.15); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); font-size: 9px; padding: 2px 6px;">Error</span></div> <div class="log-meta svelte-1uha8ag"><span class="meta-item svelte-1uha8ag">🕒 ${escape_html(log.timestamp)}</span></div></div>`);
      } else {
        $$renderer3.push("<!--[-1-->");
        $$renderer3.push(`<div class="boss-icon-container svelte-1uha8ag">`);
        if (isReadingLog(log)) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<div class="upload-icon-placeholder svelte-1uha8ag"><i class="fa-solid fa-cloud-arrow-up svelte-1uha8ag"></i></div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
          $$renderer3.push(`<img${attr("src", resolveBossIconSrc(log))} alt="" class="boss-icon-img svelte-1uha8ag" onerror="this.__e=event"/>`);
        }
        $$renderer3.push(`<!--]--></div> <div class="boss-details svelte-1uha8ag" style="min-width: 0;"><div class="boss-title-row svelte-1uha8ag"><span class="boss-name svelte-1uha8ag"${attr("role", log.boss_name ? "button" : void 0)}${attr_style(`cursor: ${log.boss_name ? "pointer" : "default"};`)}${attr("title", log.boss_name ? "Filter to this boss" : "")}>${escape_html(log.boss_name ? getModeBossDisplayName(log.boss_name, log) : log.file_name ?? "")}</span> `);
        if (log.status === "Processing") {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<span class="status-pill sp-processing svelte-1uha8ag">⏳ Processing…</span>`);
        } else if (clean(log.boss_name).includes("golem")) {
          $$renderer3.push("<!--[1-->");
          $$renderer3.push(`<span class="cm-badge training-badge svelte-1uha8ag">Training</span>`);
        } else if (log.is_quick_play) {
          $$renderer3.push("<!--[2-->");
          $$renderer3.push(`<span class="cm-badge quickplay-badge svelte-1uha8ag">Quick Play</span>`);
        } else if (showLegendaryCm(log)) {
          $$renderer3.push("<!--[3-->");
          $$renderer3.push(`<span class="cm-badge lcm-badge svelte-1uha8ag">Legendary CM</span>`);
        } else if (showChallengeMode(log)) {
          $$renderer3.push("<!--[4-->");
          $$renderer3.push(`<span class="cm-badge svelte-1uha8ag">Challenge Mode</span>`);
        } else if (isStoryBoss(log.boss_name, log)) {
          $$renderer3.push("<!--[5-->");
          $$renderer3.push(`<span class="cm-badge story-badge svelte-1uha8ag">Personal Story</span>`);
        } else if (log.boss_name) {
          $$renderer3.push("<!--[6-->");
          $$renderer3.push(`<span class="cm-badge nm-badge svelte-1uha8ag">Normal Mode</span>`);
        } else if (log.status === "Skipped") {
          $$renderer3.push("<!--[7-->");
          $$renderer3.push(`<span class="status-pill sp-skipped svelte-1uha8ag">Skipped</span>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (discord_webhooks.length > 0 && log.discord_pending === true) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<span class="wm-chip wm-offline svelte-1uha8ag" title="A Discord webhook post failed when this log uploaded. It will be retried automatically the next time this log uploads successfully (e.g. on a dps.report recovery sweep)."><i class="fa-brands fa-discord svelte-1uha8ag"></i> Discord pending</span>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> <!--[-->`);
        const each_array = ensure_array_like(vlCurrentRanks(log));
        for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
          let rk = each_array[$$index];
          $$renderer3.push(`<span class="vl-badge svelte-1uha8ag" role="button" tabindex="0"${attr_style(`color: ${stringify(rk.text_color)}; background: ${stringify(rk.bg_color)}; border: 1px solid color-mix(in srgb, ${stringify(rk.text_color)} 45%, transparent); cursor: pointer;`)}${attr("title", `Filter to ${stringify(rk.label)} logs`)}><span class="vl-badge-icon svelte-1uha8ag">${escape_html(rk.icon)}</span>${escape_html(rk.label)}</span>`);
        }
        $$renderer3.push(`<!--]--> `);
        if (log.status === "On Hold") {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<span class="status-pill sp-onhold svelte-1uha8ag">⧖ On Hold</span>`);
        } else if (log.status === "Duplicate") {
          $$renderer3.push("<!--[1-->");
          $$renderer3.push(`<span class="status-pill sp-duplicate svelte-1uha8ag">Duplicate — resolving…</span>`);
        } else if (log.status === "Completed") {
          $$renderer3.push("<!--[2-->");
          if (isStoryBoss(log.boss_name, log)) {
            $$renderer3.push("<!--[0-->");
            $$renderer3.push(`<span class="status-pill sp-done svelte-1uha8ag">✓ Completed</span>`);
          } else if (log.success === true) {
            $$renderer3.push("<!--[1-->");
            $$renderer3.push(`<span class="status-pill sp-success svelte-1uha8ag">✓ Success</span>`);
          } else if (log.success === false) {
            $$renderer3.push("<!--[2-->");
            $$renderer3.push(`<span class="status-pill sp-failed svelte-1uha8ag">✗ Failed</span>`);
          } else {
            $$renderer3.push("<!--[-1-->");
            $$renderer3.push(`<span class="status-pill sp-unknown svelte-1uha8ag">? Unknown</span>`);
          }
          $$renderer3.push(`<!--]-->`);
        } else if (log.status === "Processing") {
          $$renderer3.push("<!--[3-->");
          $$renderer3.push(`<span class="status-pill sp-processing svelte-1uha8ag">⧗ Elite Insights processing</span>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--></div> `);
        if (log.old_lions_court && log.success !== true || isDragonvoid(log.boss_name)) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<div class="log-meta svelte-1uha8ag">`);
          if (log.duration != null) {
            $$renderer3.push("<!--[0-->");
            $$renderer3.push(`<span class="meta-item svelte-1uha8ag"><i class="fa-solid fa-stopwatch svelte-1uha8ag" style="margin-right: 4px; font-size: 11px;"></i> ${escape_html(formatDuration(log.duration))}</span>`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--> `);
          if (log.num_players != null) {
            $$renderer3.push("<!--[0-->");
            $$renderer3.push(`<span class="meta-item svelte-1uha8ag"><i class="fa-solid fa-users svelte-1uha8ag" style="margin-right: 4px; font-size: 11px;"></i> ${escape_html(log.num_players)} Players</span>`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--> <span class="meta-item svelte-1uha8ag"><i class="fa-solid fa-calendar-days svelte-1uha8ag" style="margin-right: 4px; font-size: 11px;"></i> ${escape_html(log.timestamp)}</span></div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (isDragonvoid(log.boss_name) && log.bosses_phases && log.bosses_phases.length) {
          $$renderer3.push("<!--[0-->");
          const hpByKey = new Map((log.bosses_hp ?? []).map((d) => [d.key, d]));
          const council = dragonCouncilMerged(log.bosses_phases, hpByKey);
          $$renderer3.push(`<div class="dragon-council merged svelte-1uha8ag" aria-label="Dragon Council"><!--[-->`);
          const each_array_1 = ensure_array_like(council);
          for (let i = 0, $$length = each_array_1.length; i < $$length; i++) {
            let p = each_array_1[i];
            $$renderer3.push(`<div${attr_class(`dragon-chip tk-${stringify(p.kind)}`, "svelte-1uha8ag", { "cleared": p.cleared, "wiped": !p.cleared })}${attr_style(`--i:${stringify(i)}`)}${attr("title", `${stringify(p.name)}: ${p.cleared ? "Cleared" : "Not cleared"}${p.hp != null ? " · " + (p.died ? "Defeated" : p.hp.toFixed(1) + "% HP left") : ""}`)}><img class="dragon-icon svelte-1uha8ag"${attr("src", p.icon)}${attr("alt", p.name)} onerror="this.__e=event"/> `);
            if (p.hp != null) {
              $$renderer3.push("<!--[0-->");
              $$renderer3.push(`<div class="dragon-bar svelte-1uha8ag"><div${attr_class(`dragon-fill dstate-${stringify(p.hpState)}`, "svelte-1uha8ag")}${attr_style(`width:${stringify(p.hp)}%;`)}></div></div>`);
            } else {
              $$renderer3.push("<!--[-1-->");
            }
            $$renderer3.push(`<!--]--> <span class="dragon-name svelte-1uha8ag">${escape_html(p.name)}</span> <span class="phase-mark svelte-1uha8ag"><i${attr_class(`fa-solid ${p.cleared ? "fa-check" : "fa-xmark"}`, "svelte-1uha8ag")}></i></span></div>`);
          }
          $$renderer3.push(`<!--]--></div>`);
        } else if (isDragonvoid(log.boss_name) && log.bosses_hp && log.bosses_hp.length) {
          $$renderer3.push("<!--[1-->");
          const hasPhases = log.bosses_phases && log.bosses_phases.length;
          const purification2 = hasPhases ? log.bosses_phases.find((p) => p.key === "purification2") : null;
          const council = dragonCouncil(log.bosses_hp);
          $$renderer3.push(`<div class="dragon-council svelte-1uha8ag" aria-label="Dragon Council HP"><!--[-->`);
          const each_array_2 = ensure_array_like(council);
          for (let i = 0, $$length = each_array_2.length; i < $$length; i++) {
            let d = each_array_2[i];
            const tcGate = d.key === "timecaster" && purification2 != null;
            const tcCleared = tcGate ? purification2.cleared : d.reached;
            $$renderer3.push(`<div${attr_class(`dragon-chip dstate-${stringify(d.state)}`, "svelte-1uha8ag", { "reached": d.reached, "cleared": tcCleared })}${attr_style(`--i:${stringify(i)}`)}${attr("title", `${stringify(d.name)}: ${d.state === "dead" ? "Defeated" : d.state === "alive" ? d.hp_left.toFixed(1) + "% HP left" : "Not reached"}`)}><img class="dragon-icon svelte-1uha8ag"${attr("src", `/bosses/the${stringify(d.key)}void.png`)}${attr("alt", d.name)} onerror="this.__e=event"/> <div class="dragon-bar svelte-1uha8ag"><div class="dragon-fill svelte-1uha8ag"${attr_style(`width:${stringify(d.pct)}%;`)}></div></div> <span class="dragon-name svelte-1uha8ag">${escape_html(d.name)}</span></div>`);
          }
          $$renderer3.push(`<!--]--></div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (log.bosses_phases && log.bosses_phases.length && log.dragonvoid_add_evidence) {
          $$renderer3.push("<!--[0-->");
          const addRows = Object.entries(log.dragonvoid_add_evidence.hp_left);
          const addSet = new Set(Object.keys(log.dragonvoid_add_evidence.died ?? {}));
          $$renderer3.push(`<div class="add-council svelte-1uha8ag" aria-label="Dragonvoid Add Evidence"><!--[-->`);
          const each_array_3 = ensure_array_like(addRows);
          for (let $$index_3 = 0, $$length = each_array_3.length; $$index_3 < $$length; $$index_3++) {
            let [addName, hp] = each_array_3[$$index_3];
            const addOrder = orderForAdd(addName);
            const hpValue = typeof hp === "number" ? hp : 0;
            const died = addSet.has(addName) && log.dragonvoid_add_evidence.died[addName];
            $$renderer3.push(`<div${attr_class("dragon-chip tk-miniboss add-chip svelte-1uha8ag", void 0, { "cleared": died })}${attr("title", `${stringify(addName)}: ${died ? "Defeated" : "Survived"} · ${stringify(hpValue.toFixed(1))}% HP`)}${attr_style(`order: ${stringify(addOrder)}`)}><img class="dragon-icon svelte-1uha8ag"${attr("src", `/bosses/${stringify(addName)}.png`)}${attr("alt", addName)} onerror="this.__e=event"/> <span class="dragon-name svelte-1uha8ag">${escape_html(addName)}</span> <span class="phase-mark svelte-1uha8ag"><i${attr_class(`fa-solid ${died ? "fa-check" : "fa-xmark"}`, "svelte-1uha8ag")}></i></span></div>`);
          }
          $$renderer3.push(`<!--]--></div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (isKainengOverlook(log.boss_name) && log.kaineng_phases && log.kaineng_phases.length) {
          $$renderer3.push("<!--[0-->");
          log.kaineng_phases;
          $$renderer3.push(`<div class="kaineng-phases svelte-1uha8ag" aria-label="Kaineng Overlook Phases"><button type="button" class="kai-phases-header svelte-1uha8ag"><span class="kai-phases-title svelte-1uha8ag">Phases</span> <span class="kai-phases-toggle svelte-1uha8ag"><i${attr_class(`fa-solid ${"fa-chevron-down"}`, "svelte-1uha8ag")}></i></span></button> `);
          {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--></div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> <div class="log-meta svelte-1uha8ag">`);
        if (log.status === "Parsing" || log.status === "Uploading" || log.status === "Reading" || log.status === "Queued" || log.status === "On Hold") {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<div class="stage-stepper svelte-1uha8ag"><!--[-->`);
          const each_array_6 = ensure_array_like(uploadStageList(log));
          for (let i = 0, $$length = each_array_6.length; i < $$length; i++) {
            let st = each_array_6[i];
            if (i > 0) {
              $$renderer3.push("<!--[0-->");
              $$renderer3.push(`<span${attr_class("stage-connector svelte-1uha8ag", void 0, { "filled": uploadStageList(log)[i - 1].state === "done" })}></span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
            }
            $$renderer3.push(`<!--]--> <span${attr_class(`stage-step stage-${stringify(st.state)}`, "svelte-1uha8ag")}>`);
            if (st.state === "done") {
              $$renderer3.push("<!--[0-->");
              $$renderer3.push(`<i class="fa-solid fa-check svelte-1uha8ag"></i>`);
            } else if (st.state === "active") {
              $$renderer3.push("<!--[1-->");
              $$renderer3.push(`<span class="stage-dot svelte-1uha8ag"></span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
            }
            $$renderer3.push(`<!--]-->${escape_html(st.label)}</span>`);
          }
          $$renderer3.push(`<!--]--></div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> <div class="meta-line svelte-1uha8ag">`);
        if (log.boss_hp_left != null && shouldShowHpLeft(log) && !(log.twin_largos && log.success !== true) && !(log.eyes && log.success !== true) && !(log.voice_claw && log.success !== true) && !(log.aetherblade && log.success !== true) && !(log.old_lions_court && log.success !== true) && !isDragonvoid(log.boss_name)) {
          $$renderer3.push("<!--[0-->");
          if (log.ura_health_regen === "AHR") {
            $$renderer3.push("<!--[0-->");
            $$renderer3.push(`<span class="custom-tooltip-container svelte-1uha8ag"><span class="ura-ahr-badge svelte-1uha8ag">AHR</span> <span class="custom-tooltip svelte-1uha8ag">After Health Regen</span></span>`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--> <span class="meta-item svelte-1uha8ag" style="color:#f87171; font-weight:700;"><i class="fa-solid fa-heart-crack svelte-1uha8ag" style="margin-right: 4px; font-size: 11px;"></i> ${escape_html(log.boss_hp_left.toFixed(2))}% HP Left</span>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (log.twin_largos && log.success !== true) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;" class="svelte-1uha8ag">`);
          if (log.twin_largos.nikare_hp_left != null) {
            $$renderer3.push("<!--[0-->");
            if (log.twin_largos.nikare_hp_left <= 1) {
              $$renderer3.push("<!--[0-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Nikare <span style="color:#4ade80; margin-left:6px;" class="svelte-1uha8ag">Killed</span></span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Nikare <span style="color:#f87171; margin-left:6px;" class="svelte-1uha8ag">${escape_html(log.twin_largos.nikare_hp_left.toFixed(2))}% HP Left</span></span>`);
            }
            $$renderer3.push(`<!--]-->`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--> `);
          if (log.twin_largos.kenut_hp_left != null) {
            $$renderer3.push("<!--[0-->");
            if (log.twin_largos.kenut_hp_left <= 1) {
              $$renderer3.push("<!--[0-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Kenut <span style="color:#4ade80; margin-left:6px;" class="svelte-1uha8ag">Killed</span></span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Kenut <span style="color:#f87171; margin-left:6px;" class="svelte-1uha8ag">${escape_html(log.twin_largos.kenut_hp_left.toFixed(2))}% HP Left</span></span>`);
            }
            $$renderer3.push(`<!--]-->`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--></div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (log.eyes && log.success !== true) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;" class="svelte-1uha8ag">`);
          if (log.eyes.darkness_hp_left != null) {
            $$renderer3.push("<!--[0-->");
            if (log.eyes.darkness_hp_left <= 1) {
              $$renderer3.push("<!--[0-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-eye svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Eye of Darkness <span style="color:#4ade80; margin-left:6px;" class="svelte-1uha8ag">Killed</span></span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-eye svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Eye of Darkness <span style="color:#f87171; margin-left:6px;" class="svelte-1uha8ag">${escape_html(log.eyes.darkness_hp_left.toFixed(2))}% HP Left</span></span>`);
            }
            $$renderer3.push(`<!--]-->`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--> `);
          if (log.eyes.despair_hp_left != null) {
            $$renderer3.push("<!--[0-->");
            if (log.eyes.despair_hp_left <= 1) {
              $$renderer3.push("<!--[0-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-eye svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Eye of Despair <span style="color:#4ade80; margin-left:6px;" class="svelte-1uha8ag">Killed</span></span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-eye svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Eye of Despair <span style="color:#f87171; margin-left:6px;" class="svelte-1uha8ag">${escape_html(log.eyes.despair_hp_left.toFixed(2))}% HP Left</span></span>`);
            }
            $$renderer3.push(`<!--]-->`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--></div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (log.voice_claw && log.success !== true) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;" class="svelte-1uha8ag">`);
          if (log.voice_claw.voice_hp_left != null) {
            $$renderer3.push("<!--[0-->");
            if (log.voice_claw.voice_hp_left <= 1) {
              $$renderer3.push("<!--[0-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Voice <span style="color:#4ade80; margin-left:6px;" class="svelte-1uha8ag">Killed</span></span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Voice <span style="color:#f87171; margin-left:6px;" class="svelte-1uha8ag">${escape_html(log.voice_claw.voice_hp_left.toFixed(2))}% HP Left</span></span>`);
            }
            $$renderer3.push(`<!--]-->`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--> `);
          if (log.voice_claw.claw_hp_left != null) {
            $$renderer3.push("<!--[0-->");
            if (log.voice_claw.claw_hp_left <= 1) {
              $$renderer3.push("<!--[0-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Claw <span style="color:#4ade80; margin-left:6px;" class="svelte-1uha8ag">Killed</span></span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Claw <span style="color:#f87171; margin-left:6px;" class="svelte-1uha8ag">${escape_html(log.voice_claw.claw_hp_left.toFixed(2))}% HP Left</span></span>`);
            }
            $$renderer3.push(`<!--]-->`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--></div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (log.old_lions_court && log.success !== true) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;" class="svelte-1uha8ag">`);
          if (log.old_lions_court.phase != null) {
            $$renderer3.push("<!--[0-->");
            $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#cbd5e1; font-weight:700;"><i class="fa-solid fa-tower-observation svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Phase ${escape_html(log.old_lions_court.phase)}</span>`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--> `);
          if (log.old_lions_court.cc_wipe) {
            $$renderer3.push("<!--[0-->");
            $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#fbbf24; font-weight:700;"><i class="fa-solid fa-puzzle-piece svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> CC Wipe</span>`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--> `);
          if (log.old_lions_court.vermilion_hp_left != null) {
            $$renderer3.push("<!--[0-->");
            if (log.old_lions_court.vermilion_hp_left <= 1) {
              $$renderer3.push("<!--[0-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-robot svelte-1uha8ag" style="margin-right:4px; font-size:11px; color:#ef4444;"></i> Prototype Vermilion <span style="color:#4ade80; margin-left:6px;" class="svelte-1uha8ag">Killed</span></span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-robot svelte-1uha8ag" style="margin-right:4px; font-size:11px; color:#ef4444;"></i> Prototype Vermilion <span style="color:#f87171; margin-left:6px;" class="svelte-1uha8ag">${escape_html(log.old_lions_court.vermilion_hp_left.toFixed(2))}% HP Left</span></span>`);
            }
            $$renderer3.push(`<!--]-->`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--> `);
          if (log.old_lions_court.arsenite_hp_left != null) {
            $$renderer3.push("<!--[0-->");
            if (log.old_lions_court.arsenite_hp_left <= 1) {
              $$renderer3.push("<!--[0-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-robot svelte-1uha8ag" style="margin-right:4px; font-size:11px; color:#22c55e;"></i> Prototype Arsenite <span style="color:#4ade80; margin-left:6px;" class="svelte-1uha8ag">Killed</span></span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-robot svelte-1uha8ag" style="margin-right:4px; font-size:11px; color:#22c55e;"></i> Prototype Arsenite <span style="color:#f87171; margin-left:6px;" class="svelte-1uha8ag">${escape_html(log.old_lions_court.arsenite_hp_left.toFixed(2))}% HP Left</span></span>`);
            }
            $$renderer3.push(`<!--]-->`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--> `);
          if (log.old_lions_court.indigo_hp_left != null) {
            $$renderer3.push("<!--[0-->");
            if (log.old_lions_court.indigo_hp_left <= 1) {
              $$renderer3.push("<!--[0-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-robot svelte-1uha8ag" style="margin-right:4px; font-size:11px; color:#3b82f6;"></i> Prototype Indigo <span style="color:#4ade80; margin-left:6px;" class="svelte-1uha8ag">Killed</span></span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-robot svelte-1uha8ag" style="margin-right:4px; font-size:11px; color:#3b82f6;"></i> Prototype Indigo <span style="color:#f87171; margin-left:6px;" class="svelte-1uha8ag">${escape_html(log.old_lions_court.indigo_hp_left.toFixed(2))}% HP Left</span></span>`);
            }
            $$renderer3.push(`<!--]-->`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--></div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (log.aetherblade && log.success === false) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;" class="svelte-1uha8ag">`);
          if (log.aetherblade.maitrin_hp_left != null) {
            $$renderer3.push("<!--[0-->");
            if (log.aetherblade.maitrin_hp_left <= 1) {
              $$renderer3.push("<!--[0-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-skull svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Mai Trin <span style="color:#4ade80; margin-left:6px;" class="svelte-1uha8ag">Killed</span></span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-skull svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Mai Trin <span style="color:#f87171; margin-left:6px;" class="svelte-1uha8ag">${escape_html(log.aetherblade.maitrin_hp_left.toFixed(2))}% HP Left</span></span>`);
            }
            $$renderer3.push(`<!--]-->`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--> `);
          if (log.aetherblade.scarlet_hp_left != null) {
            $$renderer3.push("<!--[0-->");
            if (log.aetherblade.scarlet_hp_left <= 1) {
              $$renderer3.push("<!--[0-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Echo of Scarlet <span style="color:#4ade80; margin-left:6px;" class="svelte-1uha8ag">Killed</span></span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
              $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-person svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Echo of Scarlet <span style="color:#f87171; margin-left:6px;" class="svelte-1uha8ag">${escape_html(log.aetherblade.scarlet_hp_left.toFixed(2))}% HP Left</span></span>`);
            }
            $$renderer3.push(`<!--]-->`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--></div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (log.ca_arms && log.success === false) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;" class="svelte-1uha8ag">`);
          if (log.ca_arms.right_arm_hp_left <= 1) {
            $$renderer3.push("<!--[0-->");
            $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-hand-fist svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Right Arm <span style="color:#4ade80; margin-left:6px;" class="svelte-1uha8ag">Killed</span></span>`);
          } else {
            $$renderer3.push("<!--[-1-->");
            $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-hand-fist svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Right Arm <span style="color:#f87171; margin-left:6px;" class="svelte-1uha8ag">${escape_html(log.ca_arms.right_arm_hp_left.toFixed(2))}% HP Left</span></span>`);
          }
          $$renderer3.push(`<!--]--> `);
          if (log.ca_arms.left_arm_hp_left <= 1) {
            $$renderer3.push("<!--[0-->");
            $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-hand-fist svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Left Arm <span style="color:#4ade80; margin-left:6px;" class="svelte-1uha8ag">Killed</span></span>`);
          } else {
            $$renderer3.push("<!--[-1-->");
            $$renderer3.push(`<span class="meta-item svelte-1uha8ag" style="color:#d1d5db; font-weight:700;"><i class="fa-solid fa-hand-fist svelte-1uha8ag" style="margin-right:4px; font-size:11px;"></i> Left Arm <span style="color:#f87171; margin-left:6px;" class="svelte-1uha8ag">${escape_html(log.ca_arms.left_arm_hp_left.toFixed(2))}% HP Left</span></span>`);
          }
          $$renderer3.push(`<!--]--></div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (log.cerus_empowered_stacks != null) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<span class="cerus-stacks-badge svelte-1uha8ag"${attr("title", log.boss_hp_left != null && log.boss_hp_left > 50 ? `Cerus Empowered Stacks at Wipe (${log.boss_hp_left.toFixed(1)}% HP Left)` : "Cerus Empowered Stacks at 50% HP Left")}><img src="/mechanics/enraged.png" alt="" style="width: 12px; height: 12px; margin-right: 4px; object-fit: contain; vertical-align: middle;" class="svelte-1uha8ag"/> ${escape_html(log.cerus_empowered_stacks)} Stacks</span>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (!(log.old_lions_court && log.success !== true) && !isDragonvoid(log.boss_name)) {
          $$renderer3.push("<!--[0-->");
          if (log.duration != null) {
            $$renderer3.push("<!--[0-->");
            if (isGolemLog(log) && log.group_dps != null) {
              $$renderer3.push("<!--[0-->");
              const profIconSrc = log.players && log.players[0] ? getProfIcon(log.players[0]) : "/professions/guardian.png";
              $$renderer3.push(`<span class="dmg-dealt-badge svelte-1uha8ag" title="Total damage dealt by the squad (golem log)"><img${attr("src", profIconSrc)} alt="" style="width: 20px; height: 20px; margin-right: 4px; object-fit: contain; vertical-align: middle;" class="svelte-1uha8ag"/>${escape_html(formatComplete(log.group_dps))} DPS</span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
            }
            $$renderer3.push(`<!--]--> <span class="meta-item custom-tooltip-container svelte-1uha8ag"><span class="custom-tooltip svelte-1uha8ag">${escape_html(log.is_convergence && log.is_cm ? "Total Convergence Time" : "Duration")}</span> <i class="fa-solid fa-stopwatch svelte-1uha8ag" style="margin-right: 4px; font-size: 11px;"></i> ${escape_html(formatDuration(log.duration))}</span> `);
            if (log.is_convergence && log.is_cm && log.boss_duration != null && Math.abs((log.boss_duration ?? 0) - (log.duration ?? 0)) > 1) {
              $$renderer3.push("<!--[0-->");
              if (isGolemLog(log) && log.group_dps != null) {
                $$renderer3.push("<!--[0-->");
                $$renderer3.push(`<span class="dmg-badge svelte-1uha8ag" title="Group DPS (total squad damage output)"><i class="fa-solid fa-bolt svelte-1uha8ag" style="margin-right: 3px; font-size: 10px;"></i>${escape_html(formatDps(log.group_dps))} DPS</span>`);
              } else {
                $$renderer3.push("<!--[-1-->");
              }
              $$renderer3.push(`<!--]--> <span class="meta-item custom-tooltip-container svelte-1uha8ag" style="margin-left:4px;"><span class="custom-tooltip svelte-1uha8ag">Total Boss Time</span> <i class="fa-solid fa-crosshairs svelte-1uha8ag" style="margin-right: 4px; font-size: 11px;"></i> ${escape_html(formatDuration(log.boss_duration))}</span>`);
            } else {
              $$renderer3.push("<!--[-1-->");
            }
            $$renderer3.push(`<!--]--> <span class="meta-divider svelte-1uha8ag">|</span>`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--> `);
          if (log.num_players != null) {
            $$renderer3.push("<!--[0-->");
            $$renderer3.push(`<span class="meta-item svelte-1uha8ag"><i class="fa-solid fa-users svelte-1uha8ag" style="margin-right: 4px; font-size: 11px;"></i> ${escape_html(log.num_players)} Players</span> <span class="meta-divider svelte-1uha8ag">|</span>`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--> <span class="meta-item svelte-1uha8ag"><i class="fa-solid fa-calendar-days svelte-1uha8ag" style="margin-right: 4px; font-size: 11px;"></i> ${escape_html(log.timestamp)}</span>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--></div></div></div>`);
      }
      $$renderer3.push(`<!--]--></div>`);
    }
    function notesPanel($$renderer3, log) {
      const id = cardId(log);
      $$renderer3.push(`<div class="notes-section svelte-1uha8ag" style="border-top: 1px solid rgba(255,255,255,0.06); padding: 10px 12px; background: rgba(0,0,0,0.12);"><div class="notes-title svelte-1uha8ag" style="display:flex; align-items:center; gap:6px; color:#c084fc; font-size:12px; font-weight:600; margin-bottom:8px;"><i class="fa-solid fa-note-sticky svelte-1uha8ag" style="margin-right:2px;"></i> Notes `);
      if (log.notes && log.notes.length > 0) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<span style="color:#64748b; font-weight:400;" class="svelte-1uha8ag">(${escape_html(log.notes.length)})</span>`);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--></div> `);
      if (log.notes && log.notes.length > 0) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<div class="notes-list svelte-1uha8ag" style="display:flex; flex-direction:column; gap:6px; margin-bottom:8px;"><!--[-->`);
        const each_array_7 = ensure_array_like(log.notes);
        for (let $$index_7 = 0, $$length = each_array_7.length; $$index_7 < $$length; $$index_7++) {
          let note = each_array_7[$$index_7];
          $$renderer3.push(`<div class="note-item svelte-1uha8ag" style="display:flex; align-items:flex-start; gap:8px; background: rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:6px 8px;"><span style="flex:1; font-size:12px; color:#e2e8f0; white-space:pre-wrap; word-break:break-word;" class="svelte-1uha8ag">${escape_html(note.text)}</span> <button class="action-btn svelte-1uha8ag" title="Delete Note" style="padding:2px 6px; font-size:10px; flex:none;">✕</button></div>`);
        }
        $$renderer3.push(`<!--]--></div>`);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--> <div class="notes-compose svelte-1uha8ag" style="display:flex; gap:6px;"><input class="notes-input svelte-1uha8ag" type="text" placeholder="Write a note…"${attr("value", noteDraft[id] ?? "")} style="flex:1; background: rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#e2e8f0; padding:6px 8px; font-size:12px;"/> <button class="action-btn svelte-1uha8ag" style="background: rgba(139,92,246,0.25); border:1px solid rgba(139,92,246,0.45); color:#c084fc; padding:6px 10px; font-size:12px;">New</button></div></div>`);
    }
    function logFooter($$renderer3, log, onDelete) {
      $$renderer3.push(`<div class="log-footer svelte-1uha8ag"><div class="log-actions-row svelte-1uha8ag"><div class="custom-tooltip-container svelte-1uha8ag"><button${attr_class("action-btn primary-action-btn svelte-1uha8ag", void 0, { "disabled-resolving": !log.url && !log.local_fallback })}${attr("disabled", !log.url && !log.local_fallback, true)}><i class="fa-solid fa-chart-bar svelte-1uha8ag"></i> <span class="btn-text svelte-1uha8ag">Stats</span></button> <div class="custom-tooltip custom-tooltip-box svelte-1uha8ag">${escape_html(log.url || log.local_fallback ? "Combat stats — DPS, cleave & boon uptime per player" : "No report link available yet")}</div></div> <div class="custom-tooltip-container svelte-1uha8ag"><button${attr_class("action-btn primary-action-btn svelte-1uha8ag", void 0, {
        "disabled-offline": false,
        "disabled-resolving": !log.url,
        "disabled-uploading": log.status === "Uploading"
      })}${attr("disabled", !log.url || false, true)}>`);
      if (log.url) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<i class="fa-solid fa-globe svelte-1uha8ag"></i> <span class="btn-text svelte-1uha8ag">Open Log</span>`);
      } else if (log.status === "Duplicate") {
        $$renderer3.push("<!--[1-->");
        $$renderer3.push(`<i class="fa-solid fa-spinner fa-spin svelte-1uha8ag"></i> <span class="btn-text svelte-1uha8ag">Resolving...</span>`);
      } else {
        $$renderer3.push("<!--[-1-->");
        $$renderer3.push(`<span style="opacity: 0.5;" class="svelte-1uha8ag">🔗 <span class="btn-text svelte-1uha8ag">No Link</span></span>`);
      }
      $$renderer3.push(`<!--]--></button> <div class="custom-tooltip svelte-1uha8ag">`);
      if (log.url) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`${escape_html(log.url)}`);
      } else if (log.status === "Duplicate") {
        $$renderer3.push("<!--[1-->");
        $$renderer3.push(`Log is processing on dps.report. Link will appear shortly.`);
      } else {
        $$renderer3.push("<!--[-1-->");
        $$renderer3.push(`No report link yet.`);
      }
      $$renderer3.push(`<!--]--></div></div> <div class="custom-tooltip-container quick-action-desktop-only svelte-1uha8ag"><button class="action-btn secondary-action-btn svelte-1uha8ag"${attr("disabled", !log.url || false, true)}>`);
      if (copiedLogPath === log.file_path) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<i class="fa-solid fa-check svelte-1uha8ag" style="color: var(--success); animation: copied-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);"></i>`);
      } else {
        $$renderer3.push("<!--[-1-->");
        $$renderer3.push(`<i class="fa-solid fa-copy svelte-1uha8ag"></i>`);
      }
      $$renderer3.push(`<!--]--> <span class="btn-text svelte-1uha8ag">Copy</span></button> <div class="custom-tooltip svelte-1uha8ag">Copy dps.report URL</div></div> <div class="custom-tooltip-container quick-action-desktop-only svelte-1uha8ag"><button class="action-btn secondary-action-btn svelte-1uha8ag"${attr("disabled", !log.url || false, true)}><i class="fa-solid fa-gamepad svelte-1uha8ag"></i> <span class="btn-text svelte-1uha8ag">Replay</span></button> <div class="custom-tooltip svelte-1uha8ag">Open 2D Fight Replay</div></div> <div class="custom-tooltip-container quick-action-desktop-only svelte-1uha8ag"><button${attr_class("action-btn secondary-action-btn quick-action-desktop-only svelte-1uha8ag", void 0, { "active-toggle": notesOpen[cardId(log)] })}><i class="fa-solid fa-note-sticky svelte-1uha8ag"></i> <span class="btn-text svelte-1uha8ag">Notes</span> `);
      if (log.notes && log.notes.length > 0) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<span class="badge-count svelte-1uha8ag">${escape_html(log.notes.length)}</span>`);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--></button> <div class="custom-tooltip svelte-1uha8ag">Notes</div></div> `);
      if (vlAvailableFor(log)) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<button class="action-btn secondary-action-btn quick-action-desktop-only svelte-1uha8ag" title="VL Rank"><i class="fa-solid fa-medal svelte-1uha8ag"></i> <span class="btn-text svelte-1uha8ag">VL Rank</span> `);
        if (vlRanksOf(log).length > 0) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<span class="badge-count svelte-1uha8ag">${escape_html(vlRanksOf(log).length)}</span>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--></button>`);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--> `);
      if (getLogSession(log.file_path) != null) {
        $$renderer3.push("<!--[0-->");
        getLogSession(log.file_path);
        $$renderer3.push(`<button class="action-btn secondary-action-btn quick-action-desktop-only svelte-1uha8ag" title="Move To"><i class="fa-solid fa-arrow-right-arrow-left svelte-1uha8ag"></i> <span class="btn-text svelte-1uha8ag">Move</span></button>`);
      } else {
        $$renderer3.push("<!--[-1-->");
        $$renderer3.push(`<div class="custom-tooltip-container quick-action-desktop-only svelte-1uha8ag"><button class="action-btn secondary-action-btn quick-action-desktop-only svelte-1uha8ag"><i class="fa-solid fa-folder-open svelte-1uha8ag"></i> <span class="btn-text svelte-1uha8ag">Save</span></button> <div class="custom-tooltip svelte-1uha8ag">Save to Session</div></div>`);
      }
      $$renderer3.push(`<!--]--> `);
      if (log.status === "Failed" && log.diagnostics) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<button class="action-btn secondary-action-btn troubleshoot-btn quick-action-desktop-only svelte-1uha8ag" title="Troubleshoot"><i class="fa-solid fa-circle-question svelte-1uha8ag"></i> <span class="btn-text svelte-1uha8ag">Troubleshoot</span></button>`);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--> <div class="card-menu-container svelte-1uha8ag"><button class="card-menu-btn svelte-1uha8ag" title="More Actions" aria-label="More actions" aria-haspopup="menu"${attr("aria-expanded", activeMenuCard === cardId(log))}><i class="fa-solid fa-ellipsis svelte-1uha8ag"></i></button> `);
      if (activeMenuCard === cardId(log)) {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<div class="card-dropdown-menu svelte-1uha8ag" role="menu" aria-label="More actions" tabindex="-1"><button class="card-dropdown-item overflow-item-mobile svelte-1uha8ag"${attr("disabled", !log.url || false, true)}><i class="fa-solid fa-copy svelte-1uha8ag"></i> Copy Link</button> <button class="card-dropdown-item overflow-item-mobile svelte-1uha8ag"${attr("disabled", !log.url || false, true)}><i class="fa-solid fa-gamepad svelte-1uha8ag"></i> 2D Replay</button> <button class="card-dropdown-item overflow-item-mobile svelte-1uha8ag"><i class="fa-solid fa-note-sticky svelte-1uha8ag"></i> Notes `);
        if (log.notes && log.notes.length > 0) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`(${escape_html(log.notes.length)})`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--></button> `);
        if (vlAvailableFor(log)) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<button class="card-dropdown-item overflow-item-mobile svelte-1uha8ag"><i class="fa-solid fa-medal svelte-1uha8ag"></i> VL Rank `);
          if (vlRanksOf(log).length > 0) {
            $$renderer3.push("<!--[0-->");
            $$renderer3.push(`(${escape_html(vlRanksOf(log).length)})`);
          } else {
            $$renderer3.push("<!--[-1-->");
          }
          $$renderer3.push(`<!--]--></button>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> <button class="card-dropdown-item overflow-item-mobile svelte-1uha8ag"><i class="fa-solid fa-folder-open svelte-1uha8ag"></i> Save to Session</button> `);
        if (getLogSession(log.file_path) != null) {
          $$renderer3.push("<!--[0-->");
          getLogSession(log.file_path);
          $$renderer3.push(`<button class="card-dropdown-item overflow-item-mobile svelte-1uha8ag"><i class="fa-solid fa-arrow-right-arrow-left svelte-1uha8ag"></i> Move To</button>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (log.status === "Failed" && log.diagnostics) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<button class="card-dropdown-item svelte-1uha8ag"><i class="fa-solid fa-circle-question svelte-1uha8ag"></i> Troubleshoot</button>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (log.status === "Failed" || log.status === "On Hold") {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<button class="card-dropdown-item svelte-1uha8ag"${attr("disabled", retryingPaths.has(log.file_path), true)}><i class="fa-solid fa-rotate-right svelte-1uha8ag"></i> ${escape_html(retryingPaths.has(log.file_path) ? "Retrying…" : "Retry Upload")}</button>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (log.status === "Duplicate") {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<button class="card-dropdown-item svelte-1uha8ag"><i class="fa-solid fa-rotate-right svelte-1uha8ag"></i> Retry Upload</button>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> <div class="card-dropdown-divider svelte-1uha8ag"></div> <button class="card-dropdown-item danger svelte-1uha8ag" title="Delete log from history"><i class="fa-solid fa-trash-can svelte-1uha8ag"></i> Delete Log</button></div>`);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--></div></div> `);
      if (notesOpen[cardId(log)]) {
        $$renderer3.push("<!--[0-->");
        notesPanel($$renderer3, log);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--> `);
      if (log.error_msg && !retryingPaths.has(log.file_path) && log.status !== "Skipped") {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<div class="error-msg-row svelte-1uha8ag">`);
        if (log.status === "On Hold") {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<span class="onhold-reason svelte-1uha8ag"><i class="fa-solid fa-pause svelte-1uha8ag" style="margin-right: 5px;"></i>${escape_html(log.error_msg)}</span>`);
        } else {
          $$renderer3.push("<!--[-1-->");
          $$renderer3.push(`<span class="error-text svelte-1uha8ag">${escape_html(log.status === "Duplicate" ? "⧖" : "❌")} ${escape_html(log.error_msg)}</span>`);
        }
        $$renderer3.push(`<!--]--></div>`);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--> `);
      if (log.status === "Failed" && log.diagnostics && showTroubleshoot[log.file_path]) {
        $$renderer3.push("<!--[0-->");
        const d = log.diagnostics;
        const catClass = d.cause_category === "locked" || d.cause_category === "corrupt" ? "cat-bad" : d.cause_category === "server" ? "cat-server" : d.cause_category === "duplicate" ? "cat-dup" : "cat-unknown";
        const catLabel = d.cause_category === "locked" ? "FILE LOCKED" : d.cause_category === "corrupt" ? "CORRUPT" : d.cause_category === "server" ? "SERVER" : d.cause_category === "duplicate" ? "DUPLICATE" : "UNKNOWN";
        $$renderer3.push(`<div class="diagnostics-panel svelte-1uha8ag" style="margin-top: 10px; background: rgba(15, 15, 25, 0.6); border: 1px solid rgba(255,255,255,0.06); padding: 14px; border-radius: 6px; font-family: monospace; font-size: 11px;"><div style="font-weight: 700; color: #a78bfa; margin-bottom: 8px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;" class="svelte-1uha8ag"><span style="display:flex; align-items:center; gap:8px;" class="svelte-1uha8ag"><span${attr_class(`cause-pill ${catClass}`, "svelte-1uha8ag")}>${escape_html(catLabel)}</span> DIAGNOSTIC ANALYSIS</span> <div style="display: flex; gap: 6px;" class="svelte-1uha8ag"><button class="action-btn svelte-1uha8ag" style="padding: 2px 8px; font-size: 10px;" title="Open the log file in Explorer">📂 Open</button> <button class="action-btn svelte-1uha8ag" style="padding: 2px 8px; font-size: 10px;">${escape_html(copiedDiagPath === log.file_path ? "✓ Copied!" : "📋 Copy")}</button> <button class="action-btn svelte-1uha8ag" style="padding: 2px 8px; font-size: 10px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399;">${escape_html(savedDiagPath === log.file_path ? "✓ Saved to Desktop!" : "💾 Save as .txt")}</button></div></div> `);
        if (d.concurrent_uploaders && d.concurrent_uploaders.length > 0) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<div style="margin-bottom: 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); color: #f87171; padding: 8px; border-radius: 4px; font-size: 10px; line-height: 1.4;" class="svelte-1uha8ag">⚠️ <strong class="svelte-1uha8ag">File Access Lock:</strong> The log file is currently locked/opened by: <strong class="svelte-1uha8ag">${escape_html(d.concurrent_uploaders.join(", "))}</strong>. This lock prevents other applications from cleanly reading and uploading the file.</div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> <div style="display: grid; grid-template-columns: 140px 1fr; gap: 4px 12px; color: #e2e8f0; line-height: 1.4;" class="svelte-1uha8ag"><span style="color: #64748b;" class="svelte-1uha8ag">File Name:</span> <span style="word-break: break-all;" class="svelte-1uha8ag">${escape_html(d.file_name)}</span> <span style="color: #64748b;" class="svelte-1uha8ag">File Size:</span> <span class="svelte-1uha8ag">${escape_html((d.file_size / 1024).toFixed(2))} KB (${escape_html(d.file_size)} bytes)</span> <span style="color: #64748b;" class="svelte-1uha8ag">Format:</span> <span class="svelte-1uha8ag">${escape_html(d.is_zevtc ? "ZEVTC (Compressed)" : "EVTC (Raw)")}</span> <span style="color: #64748b;" class="svelte-1uha8ag">Header Magic:</span> <span${attr_style(d.header_valid ? "color: #10b981;" : "color: #ef4444;")} class="svelte-1uha8ag">${escape_html(d.header_valid ? "Valid (EVTC)" : `Invalid (Magic: ${d.magic_bytes})`)}</span> <span style="color: #64748b;" class="svelte-1uha8ag">Revision:</span> <span class="svelte-1uha8ag">${escape_html(d.revision)}</span> <span style="color: #64748b;" class="svelte-1uha8ag">Local Agent Count:</span> <span class="svelte-1uha8ag">${escape_html(d.agent_count !== null ? d.agent_count : "Failed to parse")}</span> <span style="color: #64748b;" class="svelte-1uha8ag">Local Parser:</span> <span${attr_style(d.parse_players_error ? "color: #ef4444;" : "color: #10b981;")} class="svelte-1uha8ag">${escape_html(d.parse_players_error ? `Failed (${d.parse_players_error})` : "Success")}</span> <span style="color: #64748b;" class="svelte-1uha8ag">Server Response:</span> <span class="svelte-1uha8ag">${escape_html(d.upload_response_status !== null ? `HTTP ${d.upload_response_status}` : "No response")}</span> <span style="color: #64748b; font-weight: bold;" class="svelte-1uha8ag">Likely Cause:</span> <span style="color: #fca5a5; font-weight: bold; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px;" class="svelte-1uha8ag">${escape_html(d.likely_cause || "Unknown")}</span> <span style="color: #64748b; font-weight: bold; align-self: start;" class="svelte-1uha8ag">What to do:</span> <span style="color: #cbd5e1; background: rgba(99,102,241,0.08); border-left: 2px solid rgba(139,92,246,0.5); padding: 4px 8px; border-radius: 4px;" class="svelte-1uha8ag">${escape_html(d.remediation || "No guidance available.")}</span></div> `);
        if (d.upload_response_body) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px;" class="svelte-1uha8ag"><div style="color: #64748b; margin-bottom: 4px;" class="svelte-1uha8ag">Server Error Payload:</div> <pre style="margin: 0; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 4px; overflow-x: auto; color: #cbd5e1; max-height: 80px; font-size: 10px;" class="svelte-1uha8ag">${escape_html(d.upload_response_body)}</pre></div>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--></div>`);
      } else {
        $$renderer3.push("<!--[-1-->");
      }
      $$renderer3.push(`<!--]--></div>`);
    }
    $$renderer2.push(`<main${attr_class("app-container svelte-1uha8ag", void 0, { "sidebar-collapsed": false })}><div class="app-titlebar svelte-1uha8ag" data-tauri-drag-region=""><button class="sidebar-toggle-btn svelte-1uha8ag" data-tauri-drag-region="false"${attr("title", "Collapse sidebar")}${attr("aria-label", "Collapse sidebar")}><i${attr_class(`fa-solid ${"fa-angles-left"}`, "svelte-1uha8ag")}></i></button> <nav class="titlebar-tabs svelte-1uha8ag" aria-label="Main navigation" data-tauri-drag-region="false"><button${attr_class(`tb-tab ${"active"}`, "svelte-1uha8ag")}><i class="fa-solid fa-cloud-arrow-up svelte-1uha8ag"></i><span class="svelte-1uha8ag">Uploads</span></button> <button${attr_class(`tb-tab ${""}`, "svelte-1uha8ag")}><i class="fa-solid fa-folder svelte-1uha8ag"></i><span class="svelte-1uha8ag">Folders</span></button> <button${attr_class(`tb-tab ${""}`, "svelte-1uha8ag")}><i class="fa-solid fa-list-check svelte-1uha8ag"></i><span class="svelte-1uha8ag">Clears</span></button> <button${attr_class(`tb-tab ${""}`, "svelte-1uha8ag")}><i class="fa-solid fa-chart-line svelte-1uha8ag"></i><span class="svelte-1uha8ag">Analytics</span></button> <button${attr_class(`tb-tab ${""}`, "svelte-1uha8ag")}><i class="fa-solid fa-clock-rotate-left svelte-1uha8ag"></i><span class="svelte-1uha8ag">History</span></button> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <button${attr_class(`tb-tab ${""}`, "svelte-1uha8ag")}><i class="fa-solid fa-gear svelte-1uha8ag"></i><span class="svelte-1uha8ag">Settings</span></button></nav> <div${attr_class("titlebar-wordmark svelte-1uha8ag", void 0, { "hidden": false })} data-tauri-drag-region="" aria-hidden="true">Portal Protocol <span class="titlebar-version svelte-1uha8ag">v${escape_html(appVersion)}</span></div></div> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <aside class="sidebar svelte-1uha8ag"><div class="brand svelte-1uha8ag"><img class="logo-img svelte-1uha8ag" src="/app-icon.png" alt="Portal Logo"/> <div class="brand-text svelte-1uha8ag"><h2 class="svelte-1uha8ag">Portal Protocol</h2> <span class="svelte-1uha8ag">dps.report Log Uploader</span></div></div> <nav class="nav-links svelte-1uha8ag"><span${attr_class("nav-tab-indicator svelte-1uha8ag", void 0, { "visible": tabIndicator.visible })}${attr_style(`left: ${stringify(tabIndicator.left)}px; top: ${stringify(tabIndicator.top)}px; width: ${stringify(tabIndicator.width)}px; height: ${stringify(tabIndicator.height)}px;`)}></span> <button${attr_class(`nav-btn ${"active"}`, "svelte-1uha8ag")}><span class="nav-icon svelte-1uha8ag"><i class="fa-solid fa-cloud-arrow-up svelte-1uha8ag"></i></span> Uploads Feed</button> <button${attr_class(`nav-btn ${""}`, "svelte-1uha8ag")}><span class="nav-icon svelte-1uha8ag"><i class="fa-solid fa-folder svelte-1uha8ag"></i></span> Folders</button> <button${attr_class(`nav-btn ${""}`, "svelte-1uha8ag")}><span class="nav-icon svelte-1uha8ag"><i class="fa-solid fa-list-check svelte-1uha8ag"></i></span> Clears</button> <button${attr_class(`nav-btn ${""}`, "svelte-1uha8ag")}><span class="nav-icon svelte-1uha8ag"><i class="fa-solid fa-chart-line svelte-1uha8ag"></i></span> Analytics</button> <button${attr_class(`nav-btn ${""}`, "svelte-1uha8ag")}><span class="nav-icon svelte-1uha8ag"><i class="fa-solid fa-clock-rotate-left svelte-1uha8ag"></i></span> History Log</button> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></nav> <div class="sidebar-section-divider svelte-1uha8ag"></div> <div class="sidebar-footer svelte-1uha8ag" style="margin-top: auto; display: flex; flex-direction: column; gap: 16px;"><nav class="nav-links svelte-1uha8ag" style="gap: 0;"><span${attr_class("nav-tab-indicator svelte-1uha8ag", void 0, { "visible": footerIndicator.visible })}${attr_style(`left: ${stringify(footerIndicator.left)}px; top: ${stringify(footerIndicator.top)}px; width: ${stringify(footerIndicator.width)}px; height: ${stringify(footerIndicator.height)}px;`)}></span> <button${attr_class(`nav-btn ${""}`, "svelte-1uha8ag")}><span class="nav-icon svelte-1uha8ag"><i class="fa-solid fa-gear svelte-1uha8ag"></i></span> Settings</button></nav> <div class="quick-links-section svelte-1uha8ag" style="border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 8px; margin-top: 0px;"><div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 700; margin-bottom: 6px;" class="svelte-1uha8ag">Quick Links</div> <div style="display: flex; flex-direction: column; gap: 6px;" class="svelte-1uha8ag"><button class="sidebar-quick-link svelte-1uha8ag"><img src="/dpsreport_icon.png" alt="dps.report" class="svelte-1uha8ag"/> Visit dps.report</button> <button class="sidebar-quick-link svelte-1uha8ag"><img src="/wingman_icon.png" alt="Wingman" class="svelte-1uha8ag"/> Wingman Dashboard</button></div></div></div></aside> <section class="content-area svelte-1uha8ag">`);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div style="display: flex; flex-direction: column; gap: inherit; min-height: 100%;" class="svelte-1uha8ag"><div class="feed-header-row svelte-1uha8ag"><div class="svelte-1uha8ag"><h2 class="feed-title svelte-1uha8ag">Uploads Feed</h2> <p class="feed-subtitle svelte-1uha8ag">Drag .evtc/.zevtc files here or configure a watch folder in Settings</p></div> `);
      FilterBar($$renderer2, {
        filters,
        bosses: distinctBossOptions(uploads),
        vlRanks: vlCatalog.flatMap((e) => e.ranks.map((r) => ({ id: r.id, label: r.label, icon: r.icon }))),
        professions: PROFESSION_OPTIONS,
        professionGroups: PROFESSION_GROUPS,
        showCounts: true,
        resultCount: filteredUploads().length,
        totalCount: uploads.filter((u) => !deletedPaths.has(u.file_path)).length
      });
      $$renderer2.push(`<!----> <div style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;" class="svelte-1uha8ag"><button class="action-btn btn-delete svelte-1uha8ag" title="Copy every uploaded link in this view"><i class="fa-solid fa-copy svelte-1uha8ag" style="margin-right: 4px;"></i> Copy All Links</button> `);
      if (uploads.length > 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<button class="action-btn btn-delete svelte-1uha8ag" style="margin-left: 8px;" title="Empty the Feed view (logs remain in History)"><i class="fa-solid fa-broom svelte-1uha8ag" style="margin-right: 4px;"></i> Clear Feed</button>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<button class="action-btn session-start svelte-1uha8ag" title="Start a Capture Session — new logs get collected for filing"><i class="fa-solid fa-circle-dot svelte-1uha8ag" style="margin-right: 4px;"></i> Start Session</button>`);
      }
      $$renderer2.push(`<!--]--></div></div> <div class="manual-bar-inline svelte-1uha8ag"><span class="manual-bar-label svelte-1uha8ag"><i class="fa-solid fa-file-arrow-up svelte-1uha8ag"></i> Queue Log</span> <div class="manual-bar-input-row svelte-1uha8ag"><input class="manual-bar-input svelte-1uha8ag" type="text" placeholder="Absolute path to .evtc or .zevtc file…"${attr("value", manualFilePath)}/> <button class="manual-bar-btn svelte-1uha8ag" title="Queue this log for upload"><i class="fa-solid fa-upload svelte-1uha8ag"></i> Upload</button> <button class="manual-bar-browse svelte-1uha8ag" title="Browse for .evtc / .zevtc files"><i class="fa-solid fa-folder-open svelte-1uha8ag"></i></button></div></div> `);
      if (selectedLogs.size > 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<div class="copy-toolbar svelte-1uha8ag" style="position: sticky; top: 0; z-index: 10; margin: 0 0 16px 0; border: 1px solid rgba(99, 102, 241, 0.25); background: rgba(15, 16, 28, 0.95); backdrop-filter: blur(8px);"><span class="copy-count svelte-1uha8ag">${escape_html(selectedLogs.size)} log${escape_html(selectedLogs.size > 1 ? "s" : "")} selected</span> <button class="btn btn-copy svelte-1uha8ag" title="Copy links for the selected logs"><i class="fa-solid fa-copy svelte-1uha8ag" style="margin-right: 4px;"></i> Copy Selected Links</button> <button class="btn btn-move svelte-1uha8ag" title="Save selected logs into a Folder"><i class="fa-solid fa-folder-plus svelte-1uha8ag" style="margin-right: 4px;"></i> Move to Folder</button> <button class="btn btn-discord svelte-1uha8ag"><i class="fa-solid fa-wand-magic-sparkles svelte-1uha8ag" style="margin-right: 4px;"></i> Log Formatter</button> <button class="btn btn-clear svelte-1uha8ag"><i class="fa-solid fa-xmark svelte-1uha8ag" style="margin-right: 4px;"></i> Close</button></div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> <div style="display: flex; gap: 20px; align-items: flex-start; width: 100%;" class="svelte-1uha8ag"><div${attr_style(`flex: ${"1 1 100%"}; min-width: 0;`)} class="svelte-1uha8ag">`);
      if (filteredUploads().length === 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<div class="empty-state svelte-1uha8ag"><span class="empty-icon svelte-1uha8ag"><i class="fa-solid fa-folder-open svelte-1uha8ag"></i></span> <h3 class="svelte-1uha8ag">No logs match the current filters</h3> <p class="svelte-1uha8ag">Try clearing your active filters or drag a new log onto the window.</p></div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
        $$renderer2.push(`<div class="records-list svelte-1uha8ag"><!--[-->`);
        const each_array_17 = ensure_array_like(groupedFeed());
        for (let $$index_25 = 0, $$length = each_array_17.length; $$index_25 < $$length; $$index_25++) {
          let item = each_array_17[$$index_25];
          if (item.kind === "wing") {
            $$renderer2.push("<!--[0-->");
            const wingLogs = item.bossBuckets.flatMap((b) => b.logs);
            const isCollapsed = wingCollapsed[item.wingIdx] !== false;
            const wingAllSelected = isWingFullySelected(wingLogs);
            const wingDuration = wingLogs.reduce((sum, l) => sum + (l.duration ?? 0), 0);
            $$renderer2.push(`<div class="wing-block svelte-1uha8ag"><div class="wing-header svelte-1uha8ag"><input type="checkbox" class="log-select-check svelte-1uha8ag"${attr("checked", wingAllSelected, true)} title="Select all logs in this wing"/> <button class="wing-title-btn svelte-1uha8ag"><span${attr_class("wing-chevron svelte-1uha8ag", void 0, { "open": !isCollapsed })}>›</span> <span class="wing-name svelte-1uha8ag">${escape_html(item.wingName)}</span> <span class="wing-count svelte-1uha8ag">${escape_html(wingLogs.length)} log${escape_html(wingLogs.length > 1 ? "s" : "")}</span> `);
            if (wingDuration > 0) {
              $$renderer2.push("<!--[0-->");
              $$renderer2.push(`<span class="wing-count svelte-1uha8ag" style="margin-left: 6px;">⏱️ ${escape_html(formatTotalTime(wingDuration))}</span>`);
            } else {
              $$renderer2.push("<!--[-1-->");
            }
            $$renderer2.push(`<!--]--></button> <button class="btn-remove-wing svelte-1uha8ag" title="Remove all logs in this group"><i class="fa-solid fa-trash-can svelte-1uha8ag"></i></button></div> `);
            if (!isCollapsed) {
              $$renderer2.push("<!--[0-->");
              $$renderer2.push(`<div class="wing-body svelte-1uha8ag"><!--[-->`);
              const each_array_18 = ensure_array_like(item.bossBuckets);
              for (let $$index_20 = 0, $$length2 = each_array_18.length; $$index_20 < $$length2; $$index_20++) {
                let bucket = each_array_18[$$index_20];
                $$renderer2.push(`<div class="wing-boss-label svelte-1uha8ag">${escape_html(bucket.bossName)}</div> <!--[-->`);
                const each_array_19 = ensure_array_like(bucket.logs);
                for (let $$index_19 = 0, $$length3 = each_array_19.length; $$index_19 < $$length3; $$index_19++) {
                  let log = each_array_19[$$index_19];
                  const id = cardId(log);
                  const isExpanded = !!expanded[id];
                  const isSelected = selectedLogs.has(log.file_path);
                  const isCaptured = false;
                  $$renderer2.push(`<div${attr_class("log-card card svelte-1uha8ag", void 0, {
                    "menu-open": activeMenuCard === id,
                    "is-expanded": isExpanded,
                    "uploading": log.status === "Uploading",
                    "is-selected": isSelected,
                    "deleting": deletingLogPaths.has(log.file_path),
                    "session-captured": isCaptured
                  })} style="position: relative; cursor: context-menu;" role="button" tabindex="0">`);
                  if (log.status === "Uploading") {
                    $$renderer2.push("<!--[0-->");
                    $$renderer2.push(`<div class="upload-progress-top svelte-1uha8ag"></div>`);
                  } else {
                    $$renderer2.push("<!--[-1-->");
                  }
                  $$renderer2.push(`<!--]--> <button class="log-header svelte-1uha8ag"><input type="checkbox" class="log-select-check svelte-1uha8ag"${attr("checked", isSelected, true)}/> `);
                  logHeaderLeft($$renderer2, log);
                  $$renderer2.push(`<!----> <div class="log-right svelte-1uha8ag"><span${attr_class("chevron svelte-1uha8ag", void 0, { "open": isExpanded })}>›</span></div></button> `);
                  logFooter($$renderer2, log);
                  $$renderer2.push(`<!----> `);
                  if (isExpanded) {
                    $$renderer2.push("<!--[0-->");
                    const groups = log.players ? groupBySubgroup(log.players) : {};
                    const subgroupNums = log.players ? sortedSubgroups(log.players) : [];
                    $$renderer2.push(`<div class="squad-section svelte-1uha8ag"><div class="squad-title svelte-1uha8ag">Squad Composition</div> `);
                    if (!log.players || log.players.length === 0) {
                      $$renderer2.push("<!--[0-->");
                      $$renderer2.push(`<p class="no-players svelte-1uha8ag">No player data available for this log.</p>`);
                    } else {
                      $$renderer2.push("<!--[-1-->");
                      $$renderer2.push(`<div class="subgroups-grid svelte-1uha8ag"><!--[-->`);
                      const each_array_20 = ensure_array_like(subgroupNums);
                      for (let $$index_18 = 0, $$length4 = each_array_20.length; $$index_18 < $$length4; $$index_18++) {
                        let sgNum = each_array_20[$$index_18];
                        $$renderer2.push(`<div class="subgroup-col svelte-1uha8ag"><div class="subgroup-label svelte-1uha8ag">Sub ${escape_html(sgNum)}</div> <!--[-->`);
                        const each_array_21 = ensure_array_like(groups[sgNum]);
                        for (let $$index_17 = 0, $$length5 = each_array_21.length; $$index_17 < $$length5; $$index_17++) {
                          let player = each_array_21[$$index_17];
                          $$renderer2.push(`<div class="player-row svelte-1uha8ag"><div${attr_class("prof-badge svelte-1uha8ag", void 0, { "img-loaded": playerIconsLoaded[player.display_name] })}${attr_style(`background-color: ${stringify(getProfColor(player.profession))};`)}${attr("title", getSpecName(player))}><img${attr("src", getProfIcon(player))} alt="" class="prof-icon-img svelte-1uha8ag" onload="this.__e=event" onerror="this.__e=event"/> <span class="prof-abbr-fallback svelte-1uha8ag">${escape_html(getSpecAbbr(player))}</span></div> <div class="player-info svelte-1uha8ag"><span class="player-name svelte-1uha8ag">`);
                          if (isCommander(player)) {
                            $$renderer2.push("<!--[0-->");
                            $$renderer2.push(`<span class="commander-crown svelte-1uha8ag" title="Tank / Commander">👑</span>`);
                          } else {
                            $$renderer2.push("<!--[-1-->");
                          }
                          $$renderer2.push(`<!--]-->${escape_html(player.display_name)}</span> <span class="player-spec svelte-1uha8ag">${escape_html(player.account)}</span></div> `);
                          if (player.role) {
                            $$renderer2.push("<!--[0-->");
                            $$renderer2.push(`<span${attr_class(`role-chip role-${stringify(player.role.toLowerCase())}`, "svelte-1uha8ag")}>${escape_html(player.role)}</span>`);
                          } else {
                            $$renderer2.push("<!--[-1-->");
                          }
                          $$renderer2.push(`<!--]--></div>`);
                        }
                        $$renderer2.push(`<!--]--></div>`);
                      }
                      $$renderer2.push(`<!--]--></div>`);
                    }
                    $$renderer2.push(`<!--]--></div>`);
                  } else {
                    $$renderer2.push("<!--[-1-->");
                  }
                  $$renderer2.push(`<!--]--></div>`);
                }
                $$renderer2.push(`<!--]-->`);
              }
              $$renderer2.push(`<!--]--></div>`);
            } else {
              $$renderer2.push("<!--[-1-->");
            }
            $$renderer2.push(`<!--]--></div>`);
          } else if (item.kind === "group") {
            $$renderer2.push("<!--[1-->");
            const catLogs = item.logs;
            const isCollapsed = categoryCollapsed[item.bossName] !== false;
            const catAllSelected = isWingFullySelected(catLogs);
            const catDuration = catLogs.reduce((sum, l) => sum + (l.duration ?? 0), 0);
            $$renderer2.push(`<div${attr_class("wing-block category-block svelte-1uha8ag", void 0, {
              "fractal-block": item.kind === "group" && item.logs.some((l) => getEncounterType(l.boss_name, l.num_players, l.is_convergence) === "fractal")
            })}><div class="wing-header svelte-1uha8ag"><input type="checkbox" class="log-select-check svelte-1uha8ag"${attr("checked", catAllSelected, true)} title="Select all logs in this category"/> <button class="wing-title-btn svelte-1uha8ag"><span${attr_class("wing-chevron svelte-1uha8ag", void 0, { "open": !isCollapsed })}>›</span> <span class="wing-name svelte-1uha8ag">${escape_html(item.bossName)}</span> <span class="wing-count svelte-1uha8ag">${escape_html(catLogs.length)} log${escape_html(catLogs.length > 1 ? "s" : "")}</span> `);
            if (catDuration > 0) {
              $$renderer2.push("<!--[0-->");
              $$renderer2.push(`<span class="wing-count svelte-1uha8ag" style="margin-left: 6px;">⏱️ ${escape_html(formatTotalTime(catDuration))}</span>`);
            } else {
              $$renderer2.push("<!--[-1-->");
            }
            $$renderer2.push(`<!--]--></button> <button class="btn-remove-wing svelte-1uha8ag" title="Remove all logs in this group"><i class="fa-solid fa-trash-can svelte-1uha8ag"></i></button></div> `);
            if (!isCollapsed) {
              $$renderer2.push("<!--[0-->");
              $$renderer2.push(`<div class="wing-body svelte-1uha8ag"><!--[-->`);
              const each_array_22 = ensure_array_like(item.bossBuckets);
              for (let $$index_24 = 0, $$length2 = each_array_22.length; $$index_24 < $$length2; $$index_24++) {
                let bucket = each_array_22[$$index_24];
                $$renderer2.push(`<div class="wing-boss-label svelte-1uha8ag">${escape_html(bucket.bossName)}</div> <!--[-->`);
                const each_array_23 = ensure_array_like(bucket.logs);
                for (let $$index_23 = 0, $$length3 = each_array_23.length; $$index_23 < $$length3; $$index_23++) {
                  let log = each_array_23[$$index_23];
                  const id = cardId(log);
                  const isExpanded = !!expanded[id];
                  const isSelected = selectedLogs.has(log.file_path);
                  $$renderer2.push(`<div${attr_class("log-card card svelte-1uha8ag", void 0, {
                    "menu-open": activeMenuCard === id,
                    "is-expanded": isExpanded,
                    "uploading": log.status === "Uploading",
                    "is-selected": isSelected,
                    "deleting": deletingLogPaths.has(log.file_path)
                  })} style="position: relative; cursor: context-menu;" role="button" tabindex="0">`);
                  if (log.status === "Uploading") {
                    $$renderer2.push("<!--[0-->");
                    $$renderer2.push(`<div class="upload-progress-top svelte-1uha8ag"></div>`);
                  } else {
                    $$renderer2.push("<!--[-1-->");
                  }
                  $$renderer2.push(`<!--]--> <button class="log-header svelte-1uha8ag"><input type="checkbox" class="log-select-check svelte-1uha8ag"${attr("checked", isSelected, true)}/> `);
                  logHeaderLeft($$renderer2, log);
                  $$renderer2.push(`<!----> <div class="log-right svelte-1uha8ag"><span${attr_class("chevron svelte-1uha8ag", void 0, { "open": isExpanded })}>›</span></div></button> `);
                  logFooter($$renderer2, log);
                  $$renderer2.push(`<!----> `);
                  if (isExpanded) {
                    $$renderer2.push("<!--[0-->");
                    const groups = log.players ? groupBySubgroup(log.players) : {};
                    const subgroupNums = log.players ? sortedSubgroups(log.players) : [];
                    $$renderer2.push(`<div class="squad-section svelte-1uha8ag"><div class="squad-title svelte-1uha8ag">Squad Composition</div> `);
                    if (!log.players || log.players.length === 0) {
                      $$renderer2.push("<!--[0-->");
                      $$renderer2.push(`<p class="no-players svelte-1uha8ag">No player data available for this log.</p>`);
                    } else {
                      $$renderer2.push("<!--[-1-->");
                      $$renderer2.push(`<div class="subgroups-grid svelte-1uha8ag"><!--[-->`);
                      const each_array_24 = ensure_array_like(subgroupNums);
                      for (let $$index_22 = 0, $$length4 = each_array_24.length; $$index_22 < $$length4; $$index_22++) {
                        let sgNum = each_array_24[$$index_22];
                        $$renderer2.push(`<div class="subgroup-col svelte-1uha8ag"><div class="subgroup-label svelte-1uha8ag">Sub ${escape_html(sgNum)}</div> <!--[-->`);
                        const each_array_25 = ensure_array_like(groups[sgNum]);
                        for (let $$index_21 = 0, $$length5 = each_array_25.length; $$index_21 < $$length5; $$index_21++) {
                          let player = each_array_25[$$index_21];
                          $$renderer2.push(`<div class="player-row svelte-1uha8ag"><div${attr_class("prof-badge svelte-1uha8ag", void 0, { "img-loaded": playerIconsLoaded[player.display_name] })}${attr_style(`background-color: ${stringify(getProfColor(player.profession))};`)}${attr("title", getSpecName(player))}><img${attr("src", getProfIcon(player))} alt="" class="prof-icon-img svelte-1uha8ag" onload="this.__e=event" onerror="this.__e=event"/> <span class="prof-abbr-fallback svelte-1uha8ag">${escape_html(getSpecAbbr(player))}</span></div> <div class="player-info svelte-1uha8ag"><span class="player-name svelte-1uha8ag">`);
                          if (isCommander(player)) {
                            $$renderer2.push("<!--[0-->");
                            $$renderer2.push(`<span class="commander-crown svelte-1uha8ag" title="Tank / Commander">👑</span>`);
                          } else {
                            $$renderer2.push("<!--[-1-->");
                          }
                          $$renderer2.push(`<!--]-->${escape_html(player.display_name)}</span> <span class="player-spec svelte-1uha8ag">${escape_html(player.account)}</span></div> `);
                          if (player.role) {
                            $$renderer2.push("<!--[0-->");
                            $$renderer2.push(`<span${attr_class(`role-chip role-${stringify(player.role.toLowerCase())}`, "svelte-1uha8ag")}>${escape_html(player.role)}</span>`);
                          } else {
                            $$renderer2.push("<!--[-1-->");
                          }
                          $$renderer2.push(`<!--]--></div>`);
                        }
                        $$renderer2.push(`<!--]--></div>`);
                      }
                      $$renderer2.push(`<!--]--></div>`);
                    }
                    $$renderer2.push(`<!--]--></div>`);
                  } else {
                    $$renderer2.push("<!--[-1-->");
                  }
                  $$renderer2.push(`<!--]--></div>`);
                }
                $$renderer2.push(`<!--]-->`);
              }
              $$renderer2.push(`<!--]--></div>`);
            } else {
              $$renderer2.push("<!--[-1-->");
            }
            $$renderer2.push(`<!--]--></div>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]-->`);
        }
        $$renderer2.push(`<!--]--></div>`);
      }
      $$renderer2.push(`<!--]--></div> `);
      {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div></div>`);
    }
    $$renderer2.push(`<!--]--></section> <footer class="app-status-bar svelte-1uha8ag"><div class="sb-item svelte-1uha8ag" title="File watcher status"><span${attr_class(`status-dot ${"online"}`, "svelte-1uha8ag")}></span> <span class="sb-label svelte-1uha8ag">${escape_html("Watcher Active")}</span></div> <button class="sb-path svelte-1uha8ag" title="Open folder in File Explorer">${escape_html("No folder configured")}</button> <div class="sb-divider svelte-1uha8ag"></div> <div class="sb-item svelte-1uha8ag" title="Checking upload API health at https://dps.report/uploadContent"><span${attr_class(
      `status-dot ${dpsReportStatus.startsWith("degraded_") ? "degraded" : "checking"}`,
      "svelte-1uha8ag"
    )}></span> <span class="sb-label svelte-1uha8ag">dps.report</span> <span${attr_class(
      `sb-badge ${dpsReportStatus.startsWith("degraded_") ? "warn" : "err"}`,
      "svelte-1uha8ag"
    )}>`);
    if (dpsReportStatus.startsWith("degraded_")) {
      $$renderer2.push("<!--[2-->");
      $$renderer2.push(`Degraded`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`…`);
    }
    $$renderer2.push(`<!--]--></span></div> `);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="sb-divider svelte-1uha8ag"></div> <div class="sb-item svelte-1uha8ag" title="Fallback API: b.dps.report"><span${attr_class(
        `status-dot ${bDpsReportStatus.startsWith("degraded_") ? "degraded" : "checking"}`,
        "svelte-1uha8ag"
      )}></span> <span class="sb-label svelte-1uha8ag">b.dps.report</span> <span${attr_class(
        `sb-badge ${bDpsReportStatus.startsWith("degraded_") ? "warn" : "err"}`,
        "svelte-1uha8ag"
      )}>`);
      if (bDpsReportStatus.startsWith("degraded_")) {
        $$renderer2.push("<!--[1-->");
        $$renderer2.push(`Degraded`);
      } else {
        $$renderer2.push("<!--[-1-->");
        $$renderer2.push(`…`);
      }
      $$renderer2.push(`<!--]--></span></div>`);
    }
    $$renderer2.push(`<!--]--> <div class="sb-divider svelte-1uha8ag"></div> <div class="sb-item svelte-1uha8ag" title="Checking upload API health at https://gw2wingman.com/runupload"><span${attr_class(
      `status-dot ${"checking"}`,
      "svelte-1uha8ag"
    )}></span> <span class="sb-label svelte-1uha8ag">Wingman</span> <span${attr_class(
      `sb-badge ${"muted"}`,
      "svelte-1uha8ag"
    )}>`);
    {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`…`);
    }
    $$renderer2.push(`<!--]--></span></div> <div class="sb-right svelte-1uha8ag">`);
    if (uploadQueue.length > 0 || uploadPaused) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<button${attr_class("sb-queue-pill upload-queue-pill svelte-1uha8ag", void 0, {
        "queue-pulsing": queuePulse,
        "queue-paused": uploadPaused
      })}${attr("title", "Click body to pause · click arrow to view queue")}>`);
      {
        $$renderer2.push("<!--[-1-->");
        $$renderer2.push(`<i class="fa-solid fa-layer-group svelte-1uha8ag"></i> ${escape_html(activeCount())} active`);
      }
      $$renderer2.push(`<!--]--> `);
      if (queuedCount() > 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<span class="sb-queue-count svelte-1uha8ag">${escape_html(queuedCount())} queued</span>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> <i${attr_class("fa-solid fa-chevron-up sb-chevron svelte-1uha8ag", void 0, { "open": queueDrawerOpen })} role="button" tabindex="0" title="Show upload queue"></i></button> `);
      {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]-->`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (dpsQueue.length > 0 || dpsQueueRunning) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="sb-queue-pill svelte-1uha8ag"><i class="fa-solid fa-rotate sb-spin svelte-1uha8ag"></i> dps.report re-upload ${escape_html(dpsQueue.length)}</span>`);
    } else if (onHoldCount() > 0 && !dpsQueueRunning && dpsQueue.length === 0) {
      $$renderer2.push("<!--[1-->");
      $$renderer2.push(`<button class="sb-retry-btn svelte-1uha8ag"${attr("disabled", dpsReportStatus !== "online", true)}${attr("title", "dps.report offline — retry paused")}><i class="fa-solid fa-rotate-right svelte-1uha8ag"></i> Retry On Hold (${escape_html(onHoldCount())})</button>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (wingmanQueue.length > 0 || wingmanQueueRunning) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="sb-queue-pill svelte-1uha8ag"><i class="fa-solid fa-rotate sb-spin svelte-1uha8ag"></i> Wingman retry ${escape_html(wingmanQueue.length)}</span>`);
    } else if (failedWingmanCount() > 0 && !wingmanQueueRunning && wingmanQueue.length === 0) {
      $$renderer2.push("<!--[1-->");
      $$renderer2.push(`<button class="sb-retry-btn svelte-1uha8ag"${attr("disabled", wingmanStatus === "offline", true)}${attr("title", "Re-send all failed Wingman imports now.")}><i class="fa-solid fa-rotate-right svelte-1uha8ag"></i> Retry Wingman (${escape_html(failedWingmanCount())})</button>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div></footer></main> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
  });
}
export {
  _page as default
};
