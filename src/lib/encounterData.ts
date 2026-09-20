// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

// GW2 raid wings + strike missions, for the Squad Planner wing/boss selector.
// Boss data is the canonical raid list; strike missions grouped by campaign.
// `banner` on a plan references a BANNER_PRESETS key (rendered as a CSS gradient),
// an http(s)/data URL (rendered as an <img>), or one of the local squad-comp
// banner keys below (rendered from /static/squadcomp/<key>.png).

export interface EncounterBoss {
  id: string;
  name: string;
}

export interface EncounterGroup {
  id: string;
  label: string; // "RAID WING 1" / "STRIKE: IBS"
  kind: "raid" | "strike";
  accent: string; // banner gradient anchor color
  bosses: EncounterBoss[];
}

export const ENCOUNTERS: EncounterGroup[] = [
  {
    id: "wing1",
    label: "RAID WING 1",
    kind: "raid",
    accent: "#4a90d9",
    bosses: [
      { id: "vg", name: "Vale Guardian" },
      { id: "gorse", name: "Gorseval the Multifarious" },
      { id: "sabetha", name: "Sabetha the Saboteur" },
      { id: "spirit", name: "Spirit Run" },
    ],
  },
  {
    id: "wing2",
    label: "RAID WING 2",
    kind: "raid",
    accent: "#8e5bd6",
    bosses: [
      { id: "sloth", name: "Slothasor" },
      { id: "triple", name: "Bandit Trio" },
      { id: "matthias", name: "Matthias Gabrel" },
    ],
  },
  {
    id: "wing3",
    label: "RAID WING 3",
    kind: "raid",
    accent: "#3fb6a8",
    bosses: [
      { id: "escort", name: "Escort" },
      { id: "kc", name: "Keep Construct" },
      { id: "xera", name: "Xera" },
    ],
  },
  {
    id: "wing4",
    label: "RAID WING 4",
    kind: "raid",
    accent: "#d98a3f",
    bosses: [
      { id: "cairn", name: "Cairn the Indomitable" },
      { id: "mo", name: "Mursaat Overseer" },
      { id: "sam", name: "Samarog" },
      { id: "deimos", name: "Deimos" },
    ],
  },
  {
    id: "wing5",
    label: "RAID WING 5",
    kind: "raid",
    accent: "#d94a6a",
    bosses: [
      { id: "sh", name: "Soulless Horror" },
      { id: "dhuum", name: "Dhuum" },
    ],
  },
  {
    id: "wing6",
    label: "RAID WING 6",
    kind: "raid",
    accent: "#5bb0d9",
    bosses: [
      { id: "ca", name: "Conjured Amalgamate" },
      { id: "twins", name: "Twin Largos" },
      { id: "qadim", name: "Qadim" },
    ],
  },
  {
    id: "wing7",
    label: "RAID WING 7",
    kind: "raid",
    accent: "#b0d95b",
    bosses: [
      { id: "adina", name: "Adina, the First" },
      { id: "sabir", name: "Sabir, the Unsleeping" },
      { id: "qadim2", name: "Qadim the Peerless" },
    ],
  },
  {
    id: "wing8",
    label: "RAID WING 8",
    kind: "raid",
    accent: "#8a4ad9",
    bosses: [
      { id: "greer", name: "Greer, the Blightbringer" },
      { id: "decima", name: "Decima, the Stormsinger" },
      { id: "uro", name: "Ura, the Steaming Cacophony" },
    ],
  },
  {
    id: "strike-ibs",
    label: "STRIKE: IBS",
    kind: "strike",
    accent: "#6a8fd9",
    bosses: [
      { id: "shiverpeaks", name: "Icebrood Construct" },
      { id: "fraenir", name: "Fraenir of Jormag" },
      { id: "boneskinner", name: "Boneskinner" },
      { id: "whisper", name: "Whisper of Jormag" },
      { id: "varinia", name: "Varinia Stormsounder" },
    ],
  },
  {
    id: "strike-eod",
    label: "STRIKE: END OF DRAGONS",
    kind: "strike",
    accent: "#3fd98a",
    bosses: [
      { id: "ai", name: "Aetherblade Hideout" },
      { id: "kanax", name: "Kanax the Soulfeaster" },
      { id: "anju", name: "Ankka" },
      { id: "minister", name: "Minister Li" },
      { id: "void", name: "The Void" },
    ],
  },
  {
    id: "strike-soto",
    label: "STRIKE: SECRETS OF THE OBSERCURY",
    kind: "strike",
    accent: "#d9a93f",
    bosses: [
      { id: "greer", name: "Greer, the Blightbringer" },
      { id: "decima", name: "Decima, the Stormsinger" },
      { id: "uro", name: "Ura, the Steaming Cacophony" },
    ],
  },
  {
    id: "strike-janthir",
    label: "STRIKE: JANTHIR",
    kind: "strike",
    accent: "#d93f7a",
    bosses: [
      { id: "zagrosek", name: "Zagrosek, the Forgotten" },
      { id: "sanctum", name: "Ritualist's Sanctum" },
    ],
  },
];

export interface BannerPreset {
  key: string;
  label: string;
  gradient: string; // CSS background
}

// Gradient-only presets — no asset files needed. A plan's `banner` field is either
// one of these keys (rendered as a gradient), an http(s)/data URL (rendered as <img>),
// or one of the keys listed in `LOCAL_BANNER_ITEMS` (rendered from /static/squadcomp/).
export const BANNER_PRESETS: BannerPreset[] = [
  { key: "aurora", label: "Aurora", gradient: "linear-gradient(135deg, #5b6fd9 0%, #8e5bd6 60%, #d94a6a 100%)" },
  { key: "ember", label: "Ember", gradient: "linear-gradient(135deg, #d98a3f 0%, #d94a6a 100%)" },
  { key: "frost", label: "Frost", gradient: "linear-gradient(135deg, #3fb6a8 0%, #5bb0d9 100%)" },
  { key: "verdant", label: "Verdant", gradient: "linear-gradient(135deg, #3fd98a 0%, #b0d95b 100%)" },
  { key: "midnight", label: "Midnight", gradient: "linear-gradient(135deg, #2a2a3a 0%, #4a4a6a 100%)" },
  { key: "amethyst", label: "Amethyst", gradient: "linear-gradient(135deg, #6a3fd9 0%, #8e5bd6 100%)" },
];

// Wing banner images — static/squadcomp/<key>.png, keyed by encounter group id.
// These are NOT boss banners (separate list below); they are the 8 wing banners the
// user made. Keep this list in the same order as the wings in ENCOUNTERS so the
// folder-creator wing selector maps cleanly. If a wing has no image yet, leave it
// out and its folder will fall back to a gradient until the PNG is dropped in.
export const WING_BANNER_ITEMS: { key: string; label: string }[] = [
  { key: "spiritvale", label: "Wing 1 — Spirit Vale" },
  { key: "salvationpass", label: "Wing 2 — Salvation Pass" },
  { key: "strongholdofthefaithful", label: "Wing 3 — Stronghold of the Faithful" },
  { key: "bastionofthepenitent", label: "Wing 4 — Bastion of the Penitent" },
  { key: "hallofchains", label: "Wing 5 — Hall of Chains" },
  { key: "mythwrightgambit", label: "Wing 6 — Mythwright Gambit" },
  { key: "keyofahdashim", label: "Wing 7 — Key of Ahdashim" },
  { key: "mountbalrior", label: "Wing 8 — Mount Balrior" },
];

// Boss banners — static/squadcomp/<key>.png when you add them later.
// Empty for now; add an entry per boss PNG when you drop it in the folder.
// Key = either the boss id or its name, whichever you name the PNG by.
export const BOSS_BANNER_ITEMS: { key: string; label: string }[] = [];

// All local squad-comp banner assets, for the swatch picker rows. Keep wings and
// bosses in separate lists so we can render them as separate rows later if we want,
// but both here for the swatch picker until that split lands.
export const LOCAL_BANNER_ITEMS: { key: string; label: string }[] = [
  ...WING_BANNER_ITEMS,
  ...BOSS_BANNER_ITEMS,
];

export function wingBannerKey(wingId: string): string | undefined {
  return WING_BANNER_ITEMS.find((w) => w.key === wingId)?.key;
}

// Wing dropdowns pass the encounter group `label` (e.g. "RAID WING 1"), but
// `WING_BANNER_ITEMS` is keyed by filename stem.  Map label → key by matching
// the encounter-group index against the banner list order.
export function wingBannerKeyForLabel(wingLabel: string): string | undefined {
  const idx = ENCOUNTERS.findIndex((g) => g.label === wingLabel);
  if (idx < 0 || idx >= WING_BANNER_ITEMS.length) return undefined;
  return WING_BANNER_ITEMS[idx].key;
}

export function bannerGradient(key?: string): string | undefined {
  if (!key) return undefined;
  if (key.startsWith("http") || key.startsWith("data:")) return undefined;
  return BANNER_PRESETS.find((b) => b.key === key)?.gradient;
}

export function bannerImageUrl(key: string): string | undefined {
  // Local squad-comp asset (key must be one of LOCAL_BANNER_ITEMS above).
  if (LOCAL_BANNER_ITEMS.some((b) => b.key === key)) return `/squadcomp/${key}.png`;
  // Anything that already looks like a URL is left alone for the URL input path.
  if (key.startsWith("http") || key.startsWith("data:")) return undefined;
  // Boss-level: map boss id or name to a file when you drop those in later.
  const group = ENCOUNTERS.find((g) =>
    g.bosses.some((b) => b.id === key || b.name === key)
  );
  if (group) return `/squadcomp/${key}.png`;
  return undefined;
}
