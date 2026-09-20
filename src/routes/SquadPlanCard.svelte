<!-- Portal Protocol - Log Uploader & Log Manager Suite -->
<!-- Copyright (C) 2026 Mestiak -->
<!-- Licensed under MIT License -->

<script lang="ts">
  import {
    type SquadPlan,
    slotIcon,
    slotColor,
    slotRoleItems,
    planWarnings,
    countRosters,
  } from "../lib/squadPlanner";
  import { bannerGradient, bannerImageUrl } from "../lib/encounterData";

  let {
    plan,
    onOpen,
    onEdit,
    onDuplicate,
    onDelete,
  }: {
    plan: SquadPlan;
    onOpen: () => void; // folder drill-in OR roster open-in-modal
    onEdit: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
  } = $props();

  let confirmingDelete = $state(false);

  const isFolder = $derived(plan.kind === "folder" || (plan.children?.length ?? 0) > 0);
  const bannerImg = $derived(
    plan.banner
      ? bannerImageUrl(plan.banner) ?? (plan.banner.startsWith("http") || plan.banner.startsWith("data:") ? plan.banner : undefined)
      : undefined
  );
  const bannerGrad = $derived(bannerGradient(plan.banner));

  // Folders click anywhere → drill in. Rosters click anywhere → open editor.
  function handleCardClick(e: MouseEvent | KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("button") || t.closest("textarea") || t.closest("input")) return;
    if (isFolder) onOpen();
    else onEdit();
  }
</script>

<div
  class="squad-card {isFolder ? 'is-folder' : 'is-roster'}"
  onclick={handleCardClick}
  onkeydown={(e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    handleCardClick(e);
  }}
  role="button"
  tabindex="0"
>
  <!-- MA-style banner -->
  <div
    class="squad-card-banner"
    style={bannerGrad ? `background:${bannerGrad}` : isFolder ? "background:linear-gradient(135deg,#2a2a3a,#4a4a6a)" : "background:linear-gradient(135deg,#1f2433,#2c3346)"}
  >
    {#if bannerImg}
      <img class="squad-card-banner-img" src={bannerImg} alt="" />
    {/if}
    <div class="squad-card-banner-overlay">
      <span class="squad-card-chip">{plan.encounterTag || (isFolder ? "FOLDER" : "COMPOSITION")}</span>
    </div>
  </div>

  <div class="squad-card-head">
    <div class="squad-card-title">
      <div>
        <div class="squad-card-name">{plan.name}</div>
        {#if plan.subtitle}
          <div class="squad-card-sub">{plan.subtitle}</div>
        {/if}
        {#if isFolder}
          <div class="squad-card-meta">{countRosters(plan)} composition{countRosters(plan) === 1 ? "" : "s"} inside</div>
        {/if}
      </div>
    </div>
    <div class="squad-card-actions">
      <button class="squad-card-btn" onclick={onEdit} title="Edit"><i class="fa-solid fa-pen"></i></button>
      {#if !isFolder}
        <button class="squad-card-btn" onclick={onDuplicate} title="Duplicate"
          ><i class="fa-solid fa-copy"></i></button
        >
      {/if}
      {#if confirmingDelete}
        <button class="squad-card-btn danger" onclick={onDelete} title="Confirm delete"
          ><i class="fa-solid fa-check"></i></button
        >
        <button class="squad-card-btn" onclick={() => (confirmingDelete = false)} title="Cancel"
          ><i class="fa-solid fa-xmark"></i></button
        >
      {:else}
        <button class="squad-card-btn danger" onclick={() => (confirmingDelete = true)} title="Delete"
          ><i class="fa-solid fa-trash"></i></button
        >
      {/if}
    </div>
  </div>

  {#if !isFolder}
    <div class="squad-card-body">
      <div class="squad-card-subs">
        {#each plan.subgroups as sg, gi (sg.id)}
          <div class="squad-card-sub">
            <div class="squad-card-sublabel">Subgroup {gi + 1}</div>
            <div class="squad-card-squares">
              {#each sg.slots as slot (slot.id)}
                {@const roleItems = slotRoleItems(slot)}
                <div class="cc-slot">
                  <div class="cc-square" class:filled={!!slot.professionId} style={`--prof-color:${slotColor(slot)}`}>
                    {#if slot.professionId}
                      <img class="cc-prof" src={slotIcon(slot)} alt="" />
                      {#if slot.playerName}
                        <div class="cc-player">{slot.playerName}</div>
                      {/if}
                    {/if}
                  </div>
                  {#if roleItems.length}
                    <div class="cc-roles">
                      {#each roleItems as ri (ri.key)}
                        {#if ri.kind === "icon"}
                          <img class="cc-role-icon" src={ri.src} alt={ri.title} title={ri.title} />
                        {:else}
                          <span class="cc-role-chip">{ri.short}</span>
                        {/if}
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>

    {@const warnings = planWarnings(plan)}
    {#if warnings.length}
      <div class="squad-card-warnings">
        {#each warnings as w (w)}<span class="squad-warn">⚠ {w}</span>{/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .squad-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: border-color 0.15s ease, transform 0.1s ease;
  }
  .squad-card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
  }
  .squad-card-banner {
    position: relative;
    height: 70px;
    width: 100%;
  }
  .squad-card-banner-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .squad-card-banner-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 10px 12px;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.45) 0%, rgba(0, 0, 0, 0) 60%);
  }
  .squad-card-chip {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.05em;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 6px;
    padding: 3px 7px;
  }
  .squad-card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px 5px;
  }
  .squad-card-title {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .squad-card-name {
    font-size: 16px;
    font-weight: 800;
    color: #fff;
    font-family: Georgia, "Times New Roman", serif;
  }
  .squad-card-sub {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 600;
    margin-top: 2px;
    max-width: 320px;
  }
  .squad-card-meta {
    font-size: 10px;
    color: var(--accent);
    font-weight: 700;
    margin-top: 3px;
  }
  .squad-card-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
  .squad-card-btn {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, #fff 5%, transparent);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
  }
  .squad-card-btn:hover {
    color: #fff;
    border-color: var(--accent);
  }
  .squad-card-btn.danger:hover {
    color: #ff7a7a;
    border-color: #ff7a7a;
  }

  .squad-card-body {
    padding: 4px 12px 12px;
  }
  .squad-card-subs {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .squad-card-sublabel {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin-bottom: 5px;
  }
  .squad-card-squares {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 7px;
  }
  .cc-square {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: 9px;
    border: 2px solid color-mix(in srgb, #fff 10%, transparent);
    background: color-mix(in srgb, #fff 3%, transparent);
    overflow: hidden;
  }
  .cc-square.filled {
    border-color: var(--prof-color, var(--accent));
    background: color-mix(in srgb, var(--prof-color, #444) 16%, transparent);
  }
  .cc-prof {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 6px;
    margin: auto;
    width: 74%;
    height: 74%;
    object-fit: contain;
  }
  .cc-player {
    position: absolute;
    top: 3px;
    left: 3px;
    right: 3px;
    font-size: 8px;
    font-weight: 700;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
    border-radius: 4px;
    padding: 1px 3px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cc-slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .cc-roles {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    justify-content: center;
    align-items: center;
    min-height: 17px;
  }
  .cc-role-icon {
    width: 17px;
    height: 17px;
    border-radius: 5px;
    background: rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.25);
    object-fit: contain;
    padding: 1px;
  }
  .cc-role-chip {
    font-size: 8px;
    font-weight: 800;
    text-transform: uppercase;
    color: #fff;
    background: rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    padding: 1px 3px;
    line-height: 1.3;
    white-space: nowrap;
  }

  .squad-card-warnings {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0 14px 14px;
  }
  .squad-warn {
    font-size: 10px;
    font-weight: 700;
    color: #ffcf6b;
    background: color-mix(in srgb, #ffcf6b 14%, transparent);
    border: 1px solid color-mix(in srgb, #ffcf6b 35%, transparent);
    border-radius: 7px;
    padding: 3px 8px;
  }

  @media (max-width: 560px) {
    .squad-card-squares {
      grid-template-columns: repeat(5, 1fr);
    }
  }
</style>
