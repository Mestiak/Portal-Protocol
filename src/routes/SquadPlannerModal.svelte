<!-- Portal Protocol - Log Uploader & Log Manager Suite -->
<!-- Copyright (C) 2026 Mestiak -->
<!-- Licensed under MIT License -->

<script lang="ts">
  import {
    PROFESSION_GROUPS,
    PROFESSIONS,
  } from "../lib/professionData";
  import {
    type SquadPlan,
    type SquadSlot,
    type SquadRole,
    ROLE_ORDER,
    ROLE_LABELS,
    visibleRoles,
    resolveWingLabel,
    slotIcon,
    slotColor,
    slotCornerBadges,
    slotTextRoles,
    slotSpecName,
    newSubgroup,
    swapSlotsWithin,
    moveSlotAcross,
  } from "../lib/squadPlanner";
  import { ENCOUNTERS, BANNER_PRESETS, bannerGradient, bannerImageUrl, LOCAL_BANNER_ITEMS, wingBannerKey, wingBannerKeyForLabel } from "../lib/encounterData";
  import { onDestroy } from "svelte";

  let {
    plan = $bindable(),
    onSave,
    onCancel,
    encounterContext,
  }: {
    plan: SquadPlan;
    onSave: (p: SquadPlan) => void;
    onCancel: () => void;
    encounterContext?: string; // wing label inherited from the parent folder (if any)
  } = $props();

  const isFolder = $derived(plan.kind === "folder");

  // Profession picker
  let picker = $state<{ sg: number; slot: number; step: "core" | "spec"; coreId?: number } | null>(null);
  let dragSrc = $state<{ sg: number; slot: number } | null>(null);
  let dropTarget = $state<string | null>(null);

  function key(sg: number, slot: number) {
    return `${sg}:${slot}`;
  }

  function openPicker(sg: number, slot: number) {
    picker = { sg, slot, step: "core" };
  }
  function closePicker() {
    picker = null;
  }

  function pickCore(coreId: number) {
    if (!picker) return;
    picker = { ...picker, step: "spec", coreId };
  }

  function assignProfession(coreId: number, specId?: number) {
    if (!picker) return;
    const sg = plan.subgroups[picker.sg];
    const slots = sg.slots.slice();
    slots[picker.slot] = {
      ...slots[picker.slot],
      professionId: coreId,
      eliteSpecId: specId,
    };
    plan.subgroups[picker.sg] = { ...sg, slots };
    plan.updatedAt = Date.now();
    closePicker();
  }

  function clearSlot(sg: number, slot: number) {
    const grp = plan.subgroups[sg];
    const slots = grp.slots.slice();
    slots[slot] = { id: slots[slot].id, roles: [] };
    plan.subgroups[sg] = { ...grp, slots };
    plan.updatedAt = Date.now();
  }

  function toggleRole(sg: number, slot: number, role: SquadRole) {
    const grp = plan.subgroups[sg];
    const slots = grp.slots.slice();
    const cur = slots[slot];
    const has = cur.roles.includes(role);
    const roles = has ? cur.roles.filter((r) => r !== role) : [...cur.roles, role];
    slots[slot] = { ...cur, roles };
    plan.subgroups[sg] = { ...grp, slots };
    plan.updatedAt = Date.now();
  }

  function setPlayerName(sg: number, slot: number, val: string) {
    const grp = plan.subgroups[sg];
    const slots = grp.slots.slice();
    slots[slot] = { ...slots[slot], playerName: val || undefined };
    plan.subgroups[sg] = { ...grp, slots };
    plan.updatedAt = Date.now();
  }

  function addSubgroup() {
    plan.subgroups = [...plan.subgroups, newSubgroup()];
    plan.updatedAt = Date.now();
  }

  function removeSubgroup(idx: number) {
    if (plan.subgroups.length <= 1) return;
    plan.subgroups = plan.subgroups.filter((_, i) => i !== idx);
    plan.updatedAt = Date.now();
  }

  // Wing / boss selector
  // Resolve the initial wing + boss from a stored encounter tag so a re-opened
  // folder shows its previously chosen wing (and boss) instead of blank selects.
  // A tag is either a wing label (RAID WING 1) or a boss name (Mursaat Overseer).
  function initWingFromTag(tag?: string): { wing: string; boss: string } {
    if (!tag) return { wing: "", boss: "" };
    if (ENCOUNTERS.some((g) => g.label === tag)) return { wing: tag, boss: "" };
    for (const g of ENCOUNTERS) {
      if (g.bosses.some((b) => b.name === tag)) return { wing: g.label, boss: tag };
    }
    return { wing: "", boss: "" };
  }
  const _initWing = initWingFromTag(plan.encounterTag);
  // When this plan lives inside a folder, inherit the folder's wing as the
  // default selector value. Only carry over the saved boss if it actually
  // belongs to that same wing; otherwise clear it so the dropdown shows the
  // folder's current bosses.
  let selectedWing = $state<string>(_initWing.wing);
  let selectedBoss = $state<string>(_initWing.boss);
  let wingOpen = $state(false);
  let bossOpen = $state(false);
  let compBossOpen = $state(false);

  // If this plan lives inside a folder, keep the wing/boss selectors synced
  // to the folder context unless the user is actively interacting with a
  // dropdown.
  $effect(() => {
    const ctx = encounterContext || "";
    if (!ctx) return;
    if (wingOpen || bossOpen) return;
    selectedWing = ctx;
    if (resolveWingLabel(plan.encounterTag) !== ctx) {
      selectedBoss = "";
    }
  });

  // Close dropdowns when clicking outside the modal controls.
  let closeDocHandler: ((e: MouseEvent) => void) | null = null;
  onDestroy(() => {
    if (closeDocHandler) {
      document.removeEventListener("click", closeDocHandler, false);
    }
  });

  function ensureDocCloseListener() {
    if (closeDocHandler) return;
    closeDocHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".squad-custom-select")) {
        wingOpen = false;
        bossOpen = false;
        compBossOpen = false;
      }
    };
    document.addEventListener("click", closeDocHandler, false);
  }

  function setDropdownOpen(which: "wing" | "boss" | "compBoss", open: boolean) {
    if (which === "wing") {
      wingOpen = open;
      if (open) bossOpen = false;
    } else if (which === "boss") {
      bossOpen = open;
      if (open) wingOpen = false;
    } else {
      compBossOpen = open;
      if (open) { wingOpen = false; bossOpen = false; }
    }
    if (open) {
      ensureDocCloseListener();
    } else if (!wingOpen && !bossOpen && !compBossOpen && closeDocHandler) {
      document.removeEventListener("click", closeDocHandler, false);
      closeDocHandler = null;
    }
  }

  // Wing context that gates boss-specific mechanic roles. Folders use their own
  // wing selector (`selectedWing`); rosters/compositions use their encounter tag.
  // folder inherits the folder's wing when its own tag is blank.
  const effectiveWing = $derived(
    selectedWing ||
      encounterContext ||
      resolveWingLabel(plan.encounterTag) ||
      "",
  );
  // The encounter wing group (if any) used to populate a boss dropdown for comps.
  const effectiveWingGroup = $derived(ENCOUNTERS.find((g) => g.label === effectiveWing) ?? null);
  function onWingChange(value: string) {
    selectedWing = value;
    selectedBoss = "";
    plan.encounterTag = selectedWing || undefined;
    const wKey = wingBannerKeyForLabel(selectedWing);
    plan.banner = wKey || plan.banner;
  }
  function onBossChange(value: string) {
    selectedBoss = value;
    plan.encounterTag = value || undefined;
  }

  // Banner picker
  function pickBanner(keyName: string) {
    plan.banner = keyName;
  }

  // Drag and drop
  function onDragStart(sg: number, slot: number, slotObj: SquadSlot, e: DragEvent) {
    if (!slotObj.professionId) return;
    dragSrc = { sg, slot };
    e.dataTransfer?.setData("text/plain", key(sg, slot));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }
  function onDragOver(k: string, e: DragEvent) {
    if (!dragSrc) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dropTarget = k;
  }
  function onDrop(sg: number, slot: number, e: DragEvent) {
    e.preventDefault();
    dropTarget = null;
    if (!dragSrc) return;
    const src = dragSrc;
    dragSrc = null;
    if (src.sg === sg) {
      plan.subgroups[sg] = swapSlotsWithin(plan.subgroups[sg], plan.subgroups[sg].slots[src.slot].id, plan.subgroups[sg].slots[slot].id);
    } else {
      const res = moveSlotAcross(plan.subgroups[src.sg], plan.subgroups[sg], plan.subgroups[src.sg].slots[src.slot].id, plan.subgroups[sg].slots[slot].id);
      plan.subgroups[src.sg] = res.source;
      plan.subgroups[sg] = res.target;
    }
    plan.updatedAt = Date.now();
  }
  function onDragEnd() {
    dragSrc = null;
    dropTarget = null;
  }

  function save() {
    plan.updatedAt = Date.now();
    onSave(plan);
  }

  const bannerImg = $derived(
    plan.banner
      ? bannerImageUrl(plan.banner) ?? (plan.banner.startsWith("http") || plan.banner.startsWith("data:") ? plan.banner : undefined)
      : undefined
  );
  const bannerGrad = $derived(bannerGradient(plan.banner));
</script>

<div
  class="squad-modal-overlay"
  role="button"
  tabindex="0"
  aria-label="Close"
  onclick={(e) => {
    if (e.target === e.currentTarget) onCancel();
  }}
  onkeydown={(e) => {
    if (e.key === "Escape") onCancel();
  }}
>
  <div class="squad-modal" role="dialog" aria-modal="true">
    <div class="squad-modal-head">
      <div class="squad-head-fields">
        <label class="field-label" for="sq-name">Composition name</label>
        <input
          id="sq-name"
          class="squad-name-input"
          bind:value={plan.name}
          placeholder={isFolder ? "Folder name (e.g. Wing 4 Cairn)" : "Composition name (e.g. Squad 1 / Harvest Temple)"}
          maxlength="60"
        />
        {#if isFolder}
          <div class="squad-custom-select">
            <button type="button" class="squad-select" onclick={() => setDropdownOpen("wing", !wingOpen)}>
              {selectedWing || 'Raid / Strike wing'}
              <i class="fa-solid fa-chevron-down" style="font-size:10px;opacity:.7;"></i>
            </button>
            {#if wingOpen}
              <div
                class="session-selector-dropdown"
                role="listbox"
                tabindex="-1"
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => {
                  if (e.key === 'Escape') setDropdownOpen('wing', false);
                }}
              >
                {#each ENCOUNTERS as g (g.id)}
                  <button
                    type="button"
                    class="dropdown-item"
                    class:active={selectedWing === g.label}
                    onclick={() => { onWingChange(g.label); setDropdownOpen('wing', false); }}
                  >{g.label}</button>
                {/each}
              </div>
            {/if}
          </div>
          {#if selectedWing}
          <div class="squad-custom-select">
            <button type="button" class="squad-select" onclick={() => setDropdownOpen("boss", !bossOpen)}>
              {selectedBoss || 'Specific boss'}
              <i class="fa-solid fa-chevron-down" style="font-size:10px;opacity:.7;"></i>
            </button>
            {#if bossOpen}
              <div
                class="session-selector-dropdown"
                role="listbox"
                tabindex="-1"
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => {
                  if (e.key === 'Escape') setDropdownOpen('boss', false);
                }}
              >
                {#each ENCOUNTERS.find((g) => g.label === selectedWing)?.bosses ?? [] as b (b.id)}
                  <button
                    type="button"
                    class="dropdown-item"
                    class:active={selectedBoss === b.name}
                    onclick={() => { onBossChange(b.name); setDropdownOpen('boss', false); }}
                  >{b.name}</button>
                {/each}
              </div>
            {/if}
          </div>
          {/if}
          <input
            class="squad-enc-input"
            bind:value={plan.subtitle}
            placeholder="Subtitle / description (e.g. Track players caught in the spike)"
            maxlength="120"
          />
        {:else}
          <label class="field-label" for="sq-enc">Encounter tag</label>
          {#if effectiveWingGroup}
            <div class="squad-custom-select">
              <button type="button" class="squad-select" onclick={() => setDropdownOpen("compBoss", !compBossOpen)}>
                {plan.encounterTag && resolveWingLabel(plan.encounterTag) === effectiveWing ? plan.encounterTag : `${effectiveWingGroup.label} boss…`}
                <i class="fa-solid fa-chevron-down" style="font-size:10px;opacity:.7;"></i>
              </button>
              {#if compBossOpen}
                <div
                  class="session-selector-dropdown"
                  role="listbox"
                  tabindex="-1"
                  onclick={(e) => e.stopPropagation()}
                  onkeydown={(e) => {
                    if (e.key === 'Escape') setDropdownOpen('compBoss', false);
                  }}
                >
                  <button
                    type="button"
                    class="dropdown-item"
                    class:active={!plan.encounterTag || resolveWingLabel(plan.encounterTag) !== effectiveWing}
                    onclick={() => { plan.encounterTag = undefined; setDropdownOpen('compBoss', false); }}
                  >{effectiveWingGroup.label} boss…</button>
                  {#each effectiveWingGroup.bosses as b (b.id)}
                    <button
                      type="button"
                      class="dropdown-item"
                      class:active={plan.encounterTag === b.name}
                      onclick={() => { plan.encounterTag = b.name; setDropdownOpen('compBoss', false); }}
                    >{b.name}</button>
                  {/each}
                </div>
              {/if}
            </div>
          {:else}
            <input
              id="sq-enc"
              class="squad-enc-input"
              bind:value={plan.encounterTag}
              placeholder="Raid / Strike / Custom tag (optional)"
              maxlength="60"
            />
          {/if}
          <div class="banner-picker">
            <span class="banner-picker-label">Banner</span>
            <div class="banner-swatches">
              {#each LOCAL_BANNER_ITEMS as item (item.key)}
              <button
                type="button"
                class="banner-swatch"
                class:active={plan.banner === item.key}
                style={`background-image:url('/squadcomp/${item.key}.png');background-size:cover;background-position:center`}
                title={item.label}
                onclick={() => pickBanner(item.key)}
              ></button>
              {/each}
              {#each BANNER_PRESETS as b (b.key)}
                <button
                  type="button"
                  class="banner-swatch"
                  class:active={plan.banner === b.key}
                  style={`background:${b.gradient}`}
                  title={b.label}
                  onclick={() => pickBanner(b.key)}
                ></button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      <button class="squad-modal-close" onclick={onCancel} aria-label="Close"
        ><i class="fa-solid fa-xmark"></i></button
      >
    </div>

    <div class="squad-modal-scroll">
    {#if !isFolder}
      <div
        class="banner-preview"
        class:img={!!bannerImg}
        style={bannerImg ? `background-image:url('${bannerImg}')` : `background:${bannerGrad}`}
      >
        <span class="banner-preview-name">{plan.name || "Untitled composition"}</span>
      </div>
    {/if}

    {#if isFolder}
      <div class="squad-folder-note">
        This is a folder. Save it, then click it to add compositions inside.
      </div>
    {:else}
      <!-- Composition body is ALWAYS mounted (even while the profession picker is
           open) so the modal scroll position is preserved between picks. -->
      <div class="squad-body">
        {#each plan.subgroups as sg, gi (sg.id)}
          <div class="squad-subgroup">
            <div class="squad-subgroup-head">
              <span class="squad-subgroup-label">Subgroup {gi + 1}</span>
              <button
                class="squad-subgroup-del"
                disabled={plan.subgroups.length <= 1}
                onclick={() => removeSubgroup(gi)}
                aria-label="Remove subgroup"
                title="Remove subgroup"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
            <div class="slot-rows">
              {#each sg.slots as slot, si (slot.id)}
                {@const badges = slotCornerBadges(slot)}
                <div class="slot-row" class:filled={!!slot.professionId}>
                  <div
                    class="slot-chip"
                    class:filled={!!slot.professionId}
                    class:drag-over={dropTarget === key(gi, si)}
                    class:dragging={dragSrc && dragSrc.sg === gi && dragSrc.slot === si}
                    role="button"
                    tabindex="0"
                    draggable={!!slot.professionId}
                    ondragstart={(e) => onDragStart(gi, si, slot, e)}
                    ondragover={(e) => onDragOver(key(gi, si), e)}
                    ondrop={(e) => onDrop(gi, si, e)}
                    ondragend={onDragEnd}
                  >
                    {#if slot.professionId}
                      <img class="slot-chip-prof" src={slotIcon(slot)} alt="" style={`--prof-color:${slotColor(slot)}`} />
                      <button class="slot-clear" onclick={() => clearSlot(gi, si)} aria-label="Clear slot"
                        ><i class="fa-solid fa-xmark"></i></button
                      >
                    {:else}
                      <button class="slot-add" onclick={() => openPicker(gi, si)} aria-label="Add slot">
                        <i class="fa-solid fa-plus"></i>
                      </button>
                    {/if}
                  </div>

                  <div class="slot-row-main">
                    <div class="slot-row-top">
                      <span class="slot-roles-name">{slot.professionId ? slotSpecName(slot) : "Empty slot"}</span>
                      {#if slot.professionId}
                        <input
                          class="slot-player-input"
                          placeholder="Account name (e.g. Prof.1234)"
                          value={slot.playerName ?? ""}
                          onchange={(e) => setPlayerName(gi, si, (e.target as HTMLInputElement).value)}
                        />
                      {/if}
                    </div>
                    {#if slot.professionId && badges.length}
                      <div class="slot-icons">
                        {#each badges as b (b.src + b.title)}
                          <img class="slot-icon" src={b.src} alt={b.title} title={b.title} />
                        {/each}
                      </div>
                    {/if}
                    {#if slot.professionId}
                      <div class="slot-roles-row">
                        {#each visibleRoles(effectiveWing) as role (role)}
                          <button
                            class="role-chip"
                            class:active={slot.roles.includes(role)}
                            onclick={() => toggleRole(gi, si, role)}
                          >
                            {ROLE_LABELS[role]}
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/each}

        <button class="squad-add-sub" onclick={addSubgroup}>
          <i class="fa-solid fa-plus"></i> Add Subgroup
        </button>

        <p class="squad-hint">
          Tip: click a filled square and drag it onto another square (even in a different subgroup) to swap
          roles.
        </p>
      </div>
    {/if}

    </div>

      {#if picker}
        <!-- Profession picker is an OVERLAY over the whole modal, not a body
             replacement, so the body stays mounted and the scroll position is
             preserved between picks. -->
        <div
          class="prof-picker-overlay"
          role="button"
          tabindex="0"
          aria-label="Close picker"
          onclick={(e) => { if (e.target === e.currentTarget) closePicker(); }}
          onkeydown={(e) => { if (e.key === "Escape") closePicker(); }}
        >
          <div class="prof-picker">
            <div class="prof-picker-head">
              <span>Select profession</span>
              <button class="prof-picker-back" onclick={closePicker}
                ><i class="fa-solid fa-arrow-left"></i> Back</button
              >
            </div>
            {#if picker.step === "core"}
              <div class="prof-grid">
                {#each PROFESSION_GROUPS as g (g.id)}
                  <button class="prof-cell" onclick={() => pickCore(g.id)}>
                    <img src={PROFESSIONS[g.id]?.icon} alt="" />
                    {PROFESSIONS[g.id]?.name}
                  </button>
                {/each}
              </div>
            {:else}
              <div class="prof-grid">
                {#each PROFESSION_GROUPS.find((g) => g.id === picker?.coreId)?.specs ?? [] as spec (spec.id)}
                  <button class="prof-cell" onclick={() => assignProfession(picker!.coreId!, spec.id)}>
                    <img src={spec.icon} alt="" />
                    {spec.name}
                  </button>
                {/each}
                {#if PROFESSION_GROUPS.find((g) => g.id === picker?.coreId)?.specs?.length}
                  <button class="prof-cell" onclick={() => assignProfession(picker!.coreId!)}>
                    <i class="fa-solid fa-user"></i>
                    Core
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/if}

    <div class="squad-modal-foot">
      <button class="squad-cancel" onclick={onCancel}>Cancel</button>
      <button class="squad-save" onclick={save}><i class="fa-solid fa-check"></i> Save</button>
    </div>
  </div>
</div>

<style>
  .squad-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 1400;
    background: rgba(0, 0, 0, 0.58);
    backdrop-filter: blur(5px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    animation: fadeIn 0.15s ease;
  }
  .squad-modal {
    position: relative;
    width: min(720px, 96vw);
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 20px;
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
    animation: vl-modal-in 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
  }
  .squad-modal-scroll {
    min-height: 0;
    overflow-y: auto;
    flex: 1;
  }
  .squad-modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  .squad-head-fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }
  .field-label {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .squad-name-input,
  .squad-enc-input,
  .squad-select {
    box-sizing: border-box;
    width: 100%;
    background: color-mix(in srgb, #fff 5%, transparent);
    border: 1px solid var(--border);
    border-radius: 10px;
    color: #fff;
    padding: 9px 12px;
    font-size: 14px;
    font-weight: 700;
    width: 100%;
    font-family: inherit;
  }
  .squad-enc-input {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .squad-select {
    font-size: 12px;
    font-weight: 600;
    color: #fff;
    cursor: pointer;
  }
  .squad-name-input:focus,
  .squad-enc-input:focus,
  .squad-select:focus {
    outline: none;
    border-color: var(--accent);
  }
  .squad-custom-select {
    position: relative;
  }
  .squad-custom-select .squad-select {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    text-align: left;
    gap: 8px;
  }
  .banner-picker {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .banner-picker-label {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .banner-swatches {
    display: flex;
    gap: 7px;
    align-items: center;
    flex-wrap: wrap;
  }
  .banner-swatch {
    width: 34px;
    height: 24px;
    border-radius: 7px;
    border: 2px solid transparent;
    cursor: pointer;
  }
  .banner-swatch.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .banner-preview {
    margin-top: 16px;
    height: 64px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background-size: cover;
    background-position: center;
    display: flex;
    align-items: flex-end;
    overflow: hidden;
    box-shadow: inset 0 -22px 30px rgba(0, 0, 0, 0.55);
  }
  .banner-preview.img {
    background-size: cover;
    background-position: center;
  }
  .banner-preview-name {
    font-size: 13px;
    font-weight: 800;
    color: #fff;
    padding: 6px 12px;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  }
  .squad-modal-close {
    background: color-mix(in srgb, #fff 6%, transparent);
    border: 1px solid var(--border);
    color: var(--text-muted);
    width: 30px;
    height: 30px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    flex-shrink: 0;
    transition: background-color 0.15s ease, color 0.15s ease;
  }
  .squad-modal-close:hover {
    color: #fff;
    background: color-mix(in srgb, #fff 12%, transparent);
  }
  .squad-folder-note {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    color: #fff;
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 13px;
    font-weight: 600;
  }

  .squad-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .squad-subgroup {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px;
    background: color-mix(in srgb, #fff 2%, transparent);
  }
  .squad-subgroup-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .squad-subgroup-label {
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .squad-subgroup-del {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: 7px;
    width: 26px;
    height: 26px;
    cursor: pointer;
    font-size: 11px;
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  .squad-subgroup-del:hover:not(:disabled) {
    color: #ff7a7a;
    border-color: #ff7a7a;
  }
  .squad-subgroup-del:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .slot-rows {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .slot-row {
    display: flex;
    gap: 10px;
    align-items: stretch;
  }
  .slot-chip {
    position: relative;
    flex-shrink: 0;
    width: 56px;
    height: 56px;
    border-radius: 11px;
    border: 2px dashed color-mix(in srgb, #fff 16%, transparent);
    background: color-mix(in srgb, #fff 3%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    overflow: hidden;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }
  .slot-chip.filled {
    border-style: solid;
    border-color: var(--prof-color, var(--accent));
    background: color-mix(in srgb, var(--prof-color, #444) 14%, #15171f);
  }
  .slot-chip.drag-over {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .slot-chip.dragging {
    opacity: 0.5;
  }
  .slot-chip-prof {
    width: 70%;
    height: 70%;
    object-fit: contain;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
  }
  .slot-icons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .slot-icon {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.35);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
    object-fit: contain;
    padding: 2px;
  }
  .slot-row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    justify-content: center;
  }
  .slot-row-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .slot-roles-name {
    font-size: 12px;
    font-weight: 800;
    color: #fff;
    white-space: nowrap;
  }
  .slot-clear {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    border: none;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    cursor: pointer;
    font-size: 10px;
  }
  .slot-add {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 20px;
    cursor: pointer;
  }
  .slot-roles-row {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    align-items: center;
    margin-top: 2px;
  }
  .role-chip {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: #c7c7d4;
    background: color-mix(in srgb, #fff 7%, transparent);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 4px 8px;
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
  }
  .role-chip:hover {
    color: #fff;
  }
  .role-chip.active {
    color: #fff;
    background: var(--accent);
    border-color: var(--accent);
  }
  .slot-player-input {
    box-sizing: border-box;
    width: 100%;
    background: color-mix(in srgb, #fff 5%, transparent);
    border: 1px solid var(--border);
    border-radius: 10px;
    color: #fff;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 700;
    font-family: inherit;
  }
  .slot-player-input::placeholder {
    color: var(--text-muted);
    font-weight: 600;
    opacity: 1;
  }
  .slot-player-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .squad-add-sub {
    background: color-mix(in srgb, #fff 5%, transparent);
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: 10px;
    padding: 9px 16px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: color 0.15s ease;
  }
  .squad-add-sub:hover {
    color: #fff;
  }
  .squad-hint {
    font-size: 11px;
    color: var(--text-muted);
    margin: 0;
  }

  .prof-picker-overlay {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(8, 9, 15, 0.74);
    backdrop-filter: blur(2px);
    animation: fadeIn 0.12s ease;
  }
  .prof-picker {
    width: min(440px, 100%);
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 14px;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
    animation: vl-modal-in 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
  }
  .prof-picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
    font-size: 13px;
    font-weight: 800;
    color: #fff;
  }
  .prof-picker-back {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: 8px;
    padding: 5px 10px;
    font-size: 11px;
    cursor: pointer;
    transition: color 0.15s ease;
  }
  .prof-picker-back:hover {
    color: #fff;
  }
  .prof-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .prof-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 6px;
    background: color-mix(in srgb, #fff 4%, transparent);
    border: 1px solid var(--border);
    border-radius: 12px;
    cursor: pointer;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
  }
  .prof-cell:hover {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    transform: translateY(-2px);
  }
  .prof-cell img {
    width: 38px;
    height: 38px;
    object-fit: contain;
  }

  .squad-modal-foot {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 18px;
    padding-top: 14px;
    background: var(--bg-card);
    border-top: 1px solid var(--border);
  }
  .squad-cancel {
    background: color-mix(in srgb, #fff 5%, transparent);
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: 10px;
    padding: 9px 16px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: color 0.15s ease;
  }
  .squad-cancel:hover {
    color: #fff;
  }
  .squad-save {
    background: var(--accent);
    border: 1px solid var(--accent);
    color: #fff;
    border-radius: 10px;
    padding: 9px 16px;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 7px;
    transition: filter 0.15s ease;
  }
  .squad-save:hover {
    filter: brightness(1.1);
  }
</style>
