// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

// Squad Planner data model + helpers.
// Single source of truth for slots, roles, role icons, and slot/swap logic.
// DRY with professionData.ts (PROFESSIONS / ELITE_SPEC_ICONS for icons + colors).

import { PROFESSIONS, PROFESSION_GROUPS, ELITE_SPEC_ICONS } from "./professionData";
import { ENCOUNTERS } from "./encounterData";

export type SquadRole =
  | "dps"
  | "quick_dps"
  | "alac_dps"
  | "quick_heal"
  | "alac_heal"
  | "cele_quick_heal"
  | "cele_alac_heal"
  | "tank"
  | "portal"
  // Boss-specific mechanic roles (gated by raid wing):
  | "flak"          // Sabetha (W1)
  | "mushroom"      // Slothasor (W2)
  | "feedback"      // Matthias Gabrel (W2)
  | "tower"         // Escort (W3)
  | "dispel"        // Mursaat Overseer (W4)
  | "claim"         // Mursaat Overseer (W4)
  | "protect"       // Mursaat Overseer (W4)
  | "push"          // Samarog (W4)
  | "pull"          // Samarog (W4)
  | "immobile"      // Samarog (W4)
  | "light";        // Statue of Darkness / Eyes (W5)

export interface SquadSlot {
  id: string;
  professionId?: number;
  eliteSpecId?: number;
  roles: SquadRole[];
  playerName?: string;
}

export interface SquadSubgroup {
  id: string;
  slots: SquadSlot[]; // GW2 subgroup = 5 slots
}

export type SquadPlanKind = "folder" | "roster";

export interface SquadPlan {
  id: string;
  name: string;
  kind: SquadPlanKind; // folder = container (children), roster = has professions
  encounterTag?: string;
  // MA-style banner card:
  banner?: string; // preset key or http(s) URL or data: URL
  subtitle?: string;
  accent?: string; // banner overlay accent color
  // Roster payload:
  subgroups: SquadSubgroup[];
  // Folder payload:
  children: SquadPlan[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

// Roles that have a real icon asset (verified in static/boons/). Others render as text chips.
export const ROLE_ICONS: Partial<Record<SquadRole, string>> = {
  dps: "/boons/dps.png",
  alac_heal: "/boons/alacheal.png",
  quick_heal: "/boons/quickheal.png",
  quick_dps: "/boons/quickness.png",
  alac_dps: "/boons/alacrity.png",
  cele_quick_heal: "/boons/celequickheal.jpg",
  cele_alac_heal: "/boons/celealacheal.png",
  tank: "/boons/tank.png",
  portal: "/boons/mesmerportal.png", // default portal icon; thief overrides below
  // Boss-specific mechanic roles (gated by raid wing):
  flak: "/boons/flakkite.png",
  mushroom: "/boons/mushroom.png",
  feedback: "/boons/feedback.png",
  tower: "/boons/tower.png",
  dispel: "/boons/dispel.png",
  claim: "/boons/claim.png",
  protect: "/boons/protect.png",
  push: "/boons/push.png",
  pull: "/boons/pull.png",
  immobile: "/boons/immobile.png",
  light: "/boons/light.png",
};

export const ROLE_LABELS: Record<SquadRole, string> = {
  dps: "DPS",
  quick_dps: "Quick DPS",
  alac_dps: "Alac DPS",
  quick_heal: "Quick Heal",
  alac_heal: "Alac Heal",
  cele_quick_heal: "Cele Quick Heal",
  cele_alac_heal: "Cele Alac Heal",
  tank: "Tank",
  portal: "Portal",
  flak: "Flak Kiter",
  mushroom: "Mushroom",
  feedback: "Feedback",
  tower: "Tower",
  dispel: "Dispel",
  claim: "Claim",
  protect: "Protect",
  push: "Push",
  pull: "Pull",
  immobile: "Immobile",
  light: "Light",
};

// Each boss-specific role is only shown in the picker when the matching raid wing
// is selected (so the mechanic roles don't clutter unrelated comps). Keyed by the
// ENCOUNTERS wing `label` (e.g. "RAID WING 4").
export const ROLE_WINGS: Partial<Record<SquadRole, string[]>> = {
  flak: ["RAID WING 1"],
  mushroom: ["RAID WING 2"],
  feedback: ["RAID WING 2"],
  tower: ["RAID WING 3"],
  dispel: ["RAID WING 4"],
  claim: ["RAID WING 4"],
  protect: ["RAID WING 4"],
  push: ["RAID WING 4"],
  pull: ["RAID WING 4"],
  immobile: ["RAID WING 4"],
  light: ["RAID WING 5"],
};

// Resolve which raid wing a free-text encounter tag belongs to, using ENCOUNTERS.
// Matches an exact wing label, an exact boss name, or a substring of either.
export function resolveWingLabel(tag?: string): string | undefined {
  if (!tag) return undefined;
  const t = tag.trim().toLowerCase();
  if (!t) return undefined;
  for (const g of ENCOUNTERS) {
    if (g.label.toLowerCase() === t) return g.label;
    if (g.bosses.some((b) => b.name.toLowerCase() === t || b.name.toLowerCase().includes(t))) return g.label;
  }
  for (const g of ENCOUNTERS) {
    if (g.label.toLowerCase().includes(t)) return g.label;
  }
  return undefined;
}

// Roles shown in the picker: the always-available set, plus any boss-specific
// roles whose wing matches the active wing context.
export function visibleRoles(wing?: string): SquadRole[] {
  if (!wing) return ROLE_ORDER;
  const extra = (Object.keys(ROLE_WINGS) as SquadRole[]).filter((r) => (ROLE_WINGS[r] ?? []).includes(wing));
  return [...ROLE_ORDER, ...extra];
}

// Order shown in the role-picker row.
export const ROLE_ORDER: SquadRole[] = [
  "dps",
  "tank",
  "quick_dps",
  "alac_dps",
  "quick_heal",
  "alac_heal",
  "cele_quick_heal",
  "cele_alac_heal",
  "portal",
];

// Profession-driven portal icon (Mesmer=7, Thief=5 per professionData.ts).
export function portalIconFor(professionId?: number): string {
  if (professionId === 7) return "/boons/mesmerportal.png";
  if (professionId === 5) return "/boons/thiefportal.png";
  return "/boons/mesmerportal.png";
}

export function slotIcon(slot: SquadSlot): string | undefined {
  if (slot.eliteSpecId && ELITE_SPEC_ICONS[slot.eliteSpecId]) return ELITE_SPEC_ICONS[slot.eliteSpecId];
  if (slot.professionId && PROFESSIONS[slot.professionId]) return PROFESSIONS[slot.professionId].icon;
  return undefined;
}

export function slotColor(slot: SquadSlot): string {
  return slot.professionId && PROFESSIONS[slot.professionId]
    ? PROFESSIONS[slot.professionId].color
    : "#3a3a4a";
}

export function slotProfessionName(slot: SquadSlot): string {
  if (slot.professionId && PROFESSIONS[slot.professionId]) return PROFESSIONS[slot.professionId].name;
  return "";
}

// The displayed name: elite spec name when chosen, else core profession name.
export function slotSpecName(slot: SquadSlot): string {
  if (slot.eliteSpecId) {
    for (const g of PROFESSION_GROUPS) {
      const spec = g.specs?.find((s) => s.id === slot.eliteSpecId);
      if (spec) return spec.name;
    }
  }
  return slotProfessionName(slot);
}

// Corner badges for a slot: icon roles (dps, tank, heals, dps boons, cele, boss mechs) + auto portal if Mesmer/Thief.
export function slotCornerBadges(slot: SquadSlot): { src: string; title: string }[] {
  const out: { src: string; title: string }[] = [];
  if (slot.roles.includes("dps")) out.push({ src: ROLE_ICONS.dps!, title: "DPS" });
  if (slot.roles.includes("tank")) out.push({ src: ROLE_ICONS.tank!, title: "Tank" });
  if (slot.roles.includes("alac_heal")) out.push({ src: ROLE_ICONS.alac_heal!, title: "Alac Heal" });
  if (slot.roles.includes("quick_heal")) out.push({ src: ROLE_ICONS.quick_heal!, title: "Quick Heal" });
  if (slot.roles.includes("quick_dps")) out.push({ src: ROLE_ICONS.quick_dps!, title: "Quick DPS" });
  if (slot.roles.includes("alac_dps")) out.push({ src: ROLE_ICONS.alac_dps!, title: "Alac DPS" });
  if (slot.roles.includes("cele_quick_heal")) out.push({ src: ROLE_ICONS.cele_quick_heal!, title: "Cele Quick Heal" });
  if (slot.roles.includes("cele_alac_heal")) out.push({ src: ROLE_ICONS.cele_alac_heal!, title: "Cele Alac Heal" });
  if (slot.roles.includes("flak")) out.push({ src: ROLE_ICONS.flak!, title: "Flak Kiter" });
  if (slot.roles.includes("mushroom")) out.push({ src: ROLE_ICONS.mushroom!, title: "Mushroom" });
  if (slot.roles.includes("feedback")) out.push({ src: ROLE_ICONS.feedback!, title: "Feedback" });
  if (slot.roles.includes("tower")) out.push({ src: ROLE_ICONS.tower!, title: "Tower" });
  if (slot.roles.includes("dispel")) out.push({ src: ROLE_ICONS.dispel!, title: "Dispel" });
  if (slot.roles.includes("claim")) out.push({ src: ROLE_ICONS.claim!, title: "Claim" });
  if (slot.roles.includes("protect")) out.push({ src: ROLE_ICONS.protect!, title: "Protect" });
  if (slot.roles.includes("push")) out.push({ src: ROLE_ICONS.push!, title: "Push" });
  if (slot.roles.includes("pull")) out.push({ src: ROLE_ICONS.pull!, title: "Pull" });
  if (slot.roles.includes("immobile")) out.push({ src: ROLE_ICONS.immobile!, title: "Immobile" });
  if (slot.roles.includes("light")) out.push({ src: ROLE_ICONS.light!, title: "Light" });
  if (slot.roles.includes("portal")) out.push({ src: portalIconFor(slot.professionId), title: "Portal" });
  return out;
}

// Roles without a dedicated icon → rendered as a small text chip under the square.
export function slotTextRoles(slot: SquadSlot): SquadRole[] {
  return slot.roles.filter((r) => !ROLE_ICONS[r]);
}

// Each selected role as a small row item: a boon image (alac/quick/portal/heals)
// or a text chip (DPS / Cele Q / Cele A). `details` is true for icon roles so the
// caller can show only the image and drop the redundant text.
export interface RoleItem {
  key: string;
  kind: "icon" | "chip";
  src?: string;
  title: string;
  short: string;
  details: boolean;
}
// Render EVERY selected role (always-available + wing-specific like flak/push),
// in the order the user picked them. Previously this only iterated ROLE_ORDER, so
// wing-specific roles were saved correctly but never shown on the card.
export function slotRoleItems(slot: SquadSlot): RoleItem[] {
  return slot.roles
    .filter((r): r is SquadRole => r in ROLE_LABELS)
    .map((r) => {
      const src = r === "portal" ? portalIconFor(slot.professionId) : ROLE_ICONS[r];
      if (src) return { key: r, kind: "icon", src, title: ROLE_LABELS[r], short: ROLE_LABELS[r], details: true } as RoleItem;
      return { key: r, kind: "chip", title: ROLE_LABELS[r], short: ROLE_LABELS[r], details: false } as RoleItem;
    });
}

export function newSlot(): SquadSlot {
  return { id: crypto.randomUUID(), roles: [] };
}

// Repair pre-2026-08-29 data where folders ended up nested inside other folders
// (caused by a create-inside-folder bug). Pulls every nested folder up to the root
// level so folders are always siblings, and drops any duplicate ids that surfaced.
export function normalizeSquadPlans(plans: SquadPlan[]): SquadPlan[] {
  const seen = new Set<string>();
  const out: SquadPlan[] = [];
  const walk = (list: SquadPlan[]): SquadPlan[] => {
    const collected: SquadPlan[] = [];
    for (const p of list) {
      if (seen.has(p.id)) continue; // de-dup stray duplicates
      seen.add(p.id);
      const children = p.children ? walk(p.children) : [];
      collected.push({ ...p, children });
    }
    return collected;
  };
  return walk(plans);
}

export function newSubgroup(): SquadSubgroup {
  return { id: crypto.randomUUID(), slots: Array.from({ length: 5 }, newSlot) };
}

export function newPlan(name = "Squad 1"): SquadPlan {
  const now = Date.now();
  return { id: crypto.randomUUID(), name, kind: "roster", subgroups: [newSubgroup()], children: [], createdAt: now, updatedAt: now };
}

// Two-level auto: top-level New = folder (no professions); inside = roster.
export function newFolder(name = "New Folder"): SquadPlan {
  const now = Date.now();
  return { id: crypto.randomUUID(), name, kind: "folder", subgroups: [], children: [], createdAt: now, updatedAt: now };
}

export function newRoster(name = "New Composition"): SquadPlan {
  const now = Date.now();
  return { id: crypto.randomUUID(), name, kind: "roster", subgroups: [newSubgroup()], children: [], createdAt: now, updatedAt: now };
}

// ─── Tree-aware plan ops (root list + nested folder children) ────────────────

// Find a plan by id anywhere in the tree.
export function findPlan(list: SquadPlan[], id: string): SquadPlan | undefined {
  for (const p of list) {
    if (p.id === id) return p;
    if (p.children?.length) {
      const found = findPlan(p.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

// Insert or replace a plan by id, anywhere in the tree. Returns a new list.
export function upsertPlan(list: SquadPlan[], plan: SquadPlan): SquadPlan[] {
  const out: SquadPlan[] = [];
  let replaced = false;
  for (const p of list) {
    if (p.id === plan.id) {
      out.push(plan);
      replaced = true;
    } else if (p.children?.length) {
      out.push({ ...p, children: upsertPlan(p.children, plan) });
    } else {
      out.push(p);
    }
  }
  if (!replaced) out.push(plan);
  return out;
}

// Remove a plan by id anywhere in the tree. Returns a new list.
export function removePlan(list: SquadPlan[], id: string): SquadPlan[] {
  return list
    .filter((p) => p.id !== id)
    .map((p) => (p.children?.length ? { ...p, children: removePlan(p.children, id) } : p));
}

// Count rosters nested under a folder (for the card's "N comps" badge).
export function countRosters(folder: SquadPlan): number {
  return (folder.children ?? []).reduce((n, c) => n + (c.kind === "folder" ? countRosters(c) : 1), 0);
}

// Swap two slots within the same subgroup by id.
export function swapSlotsWithin(sg: SquadSubgroup, aId: string, bId: string): SquadSubgroup {
  const slots = sg.slots.slice();
  const ia = slots.findIndex((s) => s.id === aId);
  const ib = slots.findIndex((s) => s.id === bId);
  if (ia < 0 || ib < 0) return sg;
  [slots[ia], slots[ib]] = [slots[ib], slots[ia]];
  return { ...sg, slots };
}

// Move a slot from one subgroup to another (replacing the target; the displaced slot
// goes back into the source position). Used by cross-subgroup drag-and-drop.
export function moveSlotAcross(
  source: SquadSubgroup,
  target: SquadSubgroup,
  aId: string,
  bId: string
): { source: SquadSubgroup; target: SquadSubgroup } {
  const aSlots = source.slots.slice();
  const bSlots = target.slots.slice();
  const ia = aSlots.findIndex((s) => s.id === aId);
  const ib = bSlots.findIndex((s) => s.id === bId);
  if (ia < 0 || ib < 0) return { source, target };
  const moving = aSlots[ia];
  const displaced = bSlots[ib];
  aSlots[ia] = displaced;
  bSlots[ib] = moving;
  return {
    source: { ...source, slots: aSlots },
    target: { ...target, slots: bSlots },
  };
}

// Boon-coverage sanity check (cheap, high-value). Returns warnings for the card footer.
export function planWarnings(plan: SquadPlan): string[] {
  const w: string[] = [];
  const all = plan.subgroups.flatMap((g) => g.slots);
  const filled = all.filter((s) => s.professionId);
  if (filled.length === 0) return w; // empty plan: nothing to warn about yet
  const hasQuick = filled.some((s) => s.roles.includes("quick_heal") || s.roles.includes("quick_dps"));
  const hasAlac = filled.some((s) => s.roles.includes("alac_heal") || s.roles.includes("alac_dps"));
  const hasHeal = filled.some(
    (s) =>
      s.roles.includes("quick_heal") ||
      s.roles.includes("alac_heal") ||
      s.roles.includes("cele_quick_heal") ||
      s.roles.includes("cele_alac_heal")
  );
  const hasPortal = filled.some(
    (s) => s.professionId === 7 || s.professionId === 5 || s.roles.includes("portal")
  );
  if (!hasQuick) w.push("No Quickness provider");
  if (!hasAlac) w.push("No Alacrity provider");
  if (!hasHeal) w.push("No healer");
  if (!hasPortal) w.push("No portal (Mesmer/Thief)");
  return w;
}
