// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

// Shared GW2 profession data for the two-step Profession filter (core → elite
// specs). Imported by +page.svelte (Feed/History/Folders) and
// AnalyticsDashboard.svelte so both use one source of truth.

export interface ProfessionInfo {
  name: string;
  icon: string;
  color: string;
  abbr: string;
}

export const PROFESSIONS: Record<number, ProfessionInfo> = {
  1: { name: "Guardian", icon: "/professions/guardian.png", color: "#2d6cdf", abbr: "Gd" },
  2: { name: "Warrior", icon: "/professions/warrior.png", color: "#c2410c", abbr: "Wr" },
  3: { name: "Engineer", icon: "/professions/engineer.png", color: "#ca8a04", abbr: "En" },
  4: { name: "Ranger", icon: "/professions/ranger.png", color: "#16a34a", abbr: "Rg" },
  5: { name: "Thief", icon: "/professions/thief.png", color: "#6b7280", abbr: "Th" },
  6: { name: "Elementalist", icon: "/professions/elementalist.png", color: "#dc2626", abbr: "El" },
  7: { name: "Mesmer", icon: "/professions/mesmer.png", color: "#7c3aed", abbr: "Ms" },
  8: { name: "Necromancer", icon: "/professions/necromancer.png", color: "#15803d", abbr: "Nc" },
  9: { name: "Revenant", icon: "/professions/revenant.png", color: "#0f766e", abbr: "Rv" },
};

// Maps a GW2 elite-specialization ID (from arcdps / dps.report, per the official
// GW2 API) to its icon asset under /static/professions/. 0 / undefined = core profession.
export const ELITE_SPEC_ICONS: Record<number, string> = {
  // Core professions (fallback handled separately)
  5: "/professions/druid.png", // Ranger
  7: "/professions/daredevil.png", // Thief
  18: "/professions/berserker.png", // Warrior
  27: "/professions/dragonhunter.png", // Guardian
  34: "/professions/reaper.png", // Necromancer
  40: "/professions/chronomancer.png", // Mesmer
  43: "/professions/scrapper.png", // Engineer
  48: "/professions/tempest.png", // Elementalist
  52: "/professions/herald.png", // Revenant
  55: "/professions/soulbeast.png", // Ranger
  56: "/professions/weaver.png", // Elementalist
  57: "/professions/holosmith.png", // Engineer
  58: "/professions/deadeye.png", // Thief
  59: "/professions/mirage.png", // Mesmer
  60: "/professions/scourge.png", // Necromancer
  61: "/professions/spellbreaker.png", // Warrior
  62: "/professions/firebrand.png", // Guardian
  63: "/professions/renegade.png", // Revenant
  64: "/professions/harbinger.png", // Necromancer
  65: "/professions/willbender.png", // Guardian
  66: "/professions/virtuoso.png", // Mesmer
  67: "/professions/catalyst.png", // Elementalist
  68: "/professions/bladesworn.png", // Warrior
  69: "/professions/vindicator.png", // Revenant
  70: "/professions/mechanist.png", // Engineer
  71: "/professions/specter.png", // Thief
  72: "/professions/untamed.png", // Ranger
  73: "/professions/troubadour.png", // (Janthir)
  74: "/professions/paragon.png",
  75: "/professions/amalgam.png",
  76: "/professions/ritualist.png",
  77: "/professions/antiquary.png",
  78: "/professions/galeshot.png",
  79: "/professions/conduit.png",
  80: "/professions/evoker.png",
  81: "/professions/luminary.png",
};

// Spec→core mapping verified against the official GW2 API
// (api.guildwars2.com/v2/specializations?ids=all, elite specs only).
// Base profession ids: 1 Guardian, 2 Warrior, 3 Engineer, 4 Ranger,
// 5 Thief, 6 Elementalist, 7 Mesmer, 8 Necromancer, 9 Revenant.
export const SPEC_CORE: Record<number, number> = {
  5: 4, 55: 4, 72: 4, // Ranger: Druid, Soulbeast, Untamed
  7: 5, 58: 5, 71: 5, // Thief: Daredevil, Deadeye, Specter
  18: 2, 61: 2, 68: 2, // Warrior: Berserker, Spellbreaker, Bladesworn
  27: 1, 62: 1, 65: 1, 81: 1, // Guardian: Dragonhunter, Firebrand, Willbender, Luminary
  34: 8, 60: 8, 64: 8, // Necromancer: Reaper, Scourge, Harbinger
  40: 7, 59: 7, 66: 7, // Mesmer: Chronomancer, Mirage, Virtuoso
  43: 3, 57: 3, 70: 3, // Engineer-focused; clarified below
  48: 6, 56: 6, 67: 6, // Elementalist: Tempest, Weaver, Catalyst
  52: 9, 63: 9, 69: 9, // Revenant: Herald, Renegade, Vindicator
  73: 7, 74: 2, 75: 3, 76: 8, 77: 5, 78: 4, 79: 9, 80: 6,
  // Janthir: Troubadour(Mes), Paragon(War), Amalgam(Eng),
  // Ritualist(Nec), Antiquary(Thf), Galeshot(Rgr),
  // Conduit(Rev), Evoker(Ele)
};

export interface ProfessionGroup {
  id: number;
  name: string;
  icon: string;
  specs: { id: number; name: string; icon: string }[];
}

// Build the two-step picker groups: each core profession + the elite specs that
// branch off it (window 1 = cores, window 2 = that core's specs).
export function buildProfessionGroups(): ProfessionGroup[] {
  return Object.entries(PROFESSIONS).map(([id, p]) => {
    const coreId = Number(id);
    const specs = Object.entries(SPEC_CORE)
      .filter(([, c]) => c === coreId)
      .map(([sid]) => {
        const specId = Number(sid);
        const icon = ELITE_SPEC_ICONS[specId] ?? p.icon;
        const name = (icon.split("/").pop() ?? "core")
          .replace(".png", "")
          .replace(/^\w/, (c) => c.toUpperCase());
        return { id: specId, name, icon };
      });
    return { id: coreId, name: p.name, icon: p.icon, specs };
  });
}

// Convenience singleton: the two-step picker groups, built once at module load.
export const PROFESSION_GROUPS: ProfessionGroup[] = buildProfessionGroups();
