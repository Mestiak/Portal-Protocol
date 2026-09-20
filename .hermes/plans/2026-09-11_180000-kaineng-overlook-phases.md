# Plan: Kaineng Overlook Phase Display

## Goal

Build a phase-aware display for Kaineng Overlook that shows the alternating Minister Li → adds → Li → adds → Li structure, with HP/killed status for each boss in the phase where the wipe occurred.

## Current context / assumptions

- EI's `KainengOverlook.cs` `GetPhases()` generates:
  - Phase 1: Minister Li (0-33%)
  - Split Phase 1: Enforcer + Mindblade + Ritualist (at 33%)
  - Phase 2: Minister Li (33-66%)
  - Split Phase 2: Mech Rider + Sniper (at 66%)
  - Phase 3: Minister Li (66-100%)
- Each phase has `Success`, `Targets`, and per-target `healthPercentBurned`
- The app currently doesn't consume EI's phases for Kaineng Overlook
- Boss images are ready at `static/bosses/`: `theenforcerer.png`, `mindblade.png`, `ritualist.png`, `themechrider.png`, `sniper.png`
- Minister Li's image: `ministerli.png` (already exists)

## Architecture / proposed approach

Use EI's `phases[]` JSON to build a phase timeline UI. Each phase shows the boss(es) with HP left or killed badges. The wipe phase is highlighted. The UI renders as a horizontal timeline with phase cards.

## Step-by-step tasks

### Task 1: Add `kaineng_phases` field to `UploadRecord`

**File:** `src-tauri/src/uploader.rs` (around line 1033, near `bosses_phases`)

Add a new field to store Kaineng Overlook phase data:

```rust
/// Kaineng Overlook phase timeline. Drives the phase display strip.
/// `None` for any other encounter.
#[serde(default)]
pub kaineng_phases: Option<Vec<crate::evtc_parser::KainengPhase>>,
```

**Verify:** `cargo check` passes.

### Task 2: Add `KainengPhase` struct to `evtc_parser.rs`

**File:** `src-tauri/src/evtc_parser.rs` (after `DragonPhase` struct, around line 565)

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KainengPhase {
    pub phase_type: String,  // "boss" or "split"
    pub name: String,        // "Minister Li", "Split Phase 1", etc.
    pub success: Option<bool>,
    pub targets: Vec<KainengTarget>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KainengTarget {
    pub key: String,         // "ministerli", "enforcer", "mindblade", etc.
    pub name: String,        // "Minister Li", "The Enforcer", etc.
    pub icon: String,        // icon filename without extension
    pub hp_left: Option<f64>, // None if killed
    pub killed: bool,
}
```

**Verify:** `cargo check` passes.

### Task 3: Populate `kaineng_phases` from EI JSON in `enrich_record_from_ei`

**File:** `src-tauri/src/ei_runner.rs` (in `enrich_record_from_ei`, after line ~530)

Add code to extract EI's `phases[]` for Kaineng Overlook:

```rust
// Kaineng Overlook: extract phase timeline from EI
if record.boss_name.as_deref().map_or(false, |n| n.to_lowercase().contains("kaineng")) {
    if let Some(phases) = ei.get("phases").and_then(|v| v.as_array()) {
        let mut kai_phases: Vec<crate::evtc_parser::KainengPhase> = Vec::new();
        for phase in phases {
            let name = phase.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let success = phase.get("success").and_then(|v| v.as_bool());
            
            // Determine phase type
            let phase_type = if name.contains("Split") {
                "split".to_string()
            } else {
                "boss".to_string()
            };
            
            // Extract targets
            let mut targets: Vec<crate::evtc_parser::KainengTarget> = Vec::new();
            if let Some(phase_targets) = phase.get("targets").and_then(|v| v.as_array()) {
                for (idx, target_idx) in phase_targets.iter().enumerate() {
                    let target_idx = target_idx.as_u64().unwrap_or(0) as usize;
                    if let Some(target) = ei.get("targets").and_then(|t| t.as_array()).and_then(|t| t.get(target_idx)) {
                        let target_name = target.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let burned = target.get("healthPercentBurned").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let hp_left = if burned > 0.0 { Some(100.0 - burned) } else { None };
                        
                        let key = target_name.to_lowercase().replace(|c: char| !c.is_ascii_alphanumeric(), "");
                        let icon = match key.as_str() {
                            "ministerli" => "ministerli",
                            "theenforcer" => "theenforcerer",
                            "themindblade" => "mindblade",
                            "theritualist" => "ritualist",
                            "themechrider" => "themechrider",
                            "thesniper" => "sniper",
                            _ => "unknown",
                        };
                        
                        targets.push(crate::evtc_parser::KainengTarget {
                            key: key.clone(),
                            name: target_name.to_string(),
                            icon: icon.to_string(),
                            hp_left,
                            killed: hp_left.is_none(),
                        });
                    }
                }
            }
            
            kai_phases.push(crate::evtc_parser::KainengPhase {
                phase_type,
                name: name.to_string(),
                success,
                targets,
            });
        }
        if !kai_phases.is_empty() {
            record.kaineng_phases = Some(kai_phases);
        }
    }
}
```

**Verify:** `cargo check` passes.

### Task 4: Add test for Kaineng phase extraction

**File:** `src-tauri/src/ei_runner.rs` (at end of file, in existing `#[cfg(test)]` module)

```rust
#[test]
fn ei_phases_populate_kaineng_phases() {
    let ei = json!({
        "bossName": "Kaineng Overlook",
        "phases": [
            {"name": "Phase 1", "success": true, "targets": [0]},
            {"name": "Split Phase 1", "success": false, "targets": [1, 2, 3]},
            {"name": "Phase 2", "success": false, "targets": [0]}
        ],
        "targets": [
            {"name": "Minister Li", "healthPercentBurned": 33.0},
            {"name": "The Enforcer", "healthPercentBurned": 100.0},
            {"name": "The Mindblade", "healthPercentBurned": 100.0},
            {"name": "The Ritualist", "healthPercentBurned": 50.0}
        ]
    });
    let mut record = crate::uploader::UploadRecord::default();
    record.boss_name = Some("Kaineng Overlook".to_string());
    enrich_record_from_ei(&mut record, &ei);
    let phases = record.kaineng_phases.expect("should have phases");
    assert_eq!(phases.len(), 3);
    assert_eq!(phases[0].phase_type, "boss");
    assert!(phases[0].success.unwrap());  // Phase 1 completed
    assert_eq!(phases[1].phase_type, "split");
    assert!(!phases[1].success.unwrap()); // Split Phase 1 failed
    assert_eq!(phases[1].targets.len(), 3);
    assert_eq!(phases[1].targets[2].key, "theritualist");
    assert_eq!(phases[1].targets[2].hp_left, Some(50.0));
}
```

**Verify:** `cargo test ei_runner::tests::ei_phases_populate_kaineng_phases` passes.

### Task 5: Build frontend phase timeline component

**File:** `src/routes/+page.svelte` (after Dragon Council section, around line 5057)

Add a new section for Kaineng Overlook phases:

```svelte
{#if isKainengOverlook(log.boss_name) && log.kaineng_phases && log.kaineng_phases.length}
  <div class="kaineng-phases" aria-label="Kaineng Overlook Phases">
    {#each log.kaineng_phases as phase, i}
      <div class="kai-phase" class:boss-phase={phase.phase_type === 'boss'} class:split-phase={phase.phase_type === 'split'} class:wiped={!phase.success}>
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
  </div>
{/if}
```

Add the helper function:

```javascript
function isKainengOverlook(bossName: string): boolean {
  if (!bossName) return false;
  const c = clean(bossName);
  return c === "kainengoverlook" || c === "ministerli";
}
```

**Verify:** `npm run check` passes.

### Task 6: Add CSS for Kaineng phase display

**File:** `src/app.css` (after Dragon Council styles, around line 3494)

```css
/* Kaineng Overlook phase timeline */
.kaineng-phases {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}

.kai-phase {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.kai-phase.boss-phase {
  background: rgba(139, 92, 246, 0.1);
}

.kai-phase.split-phase {
  background: rgba(239, 68, 68, 0.1);
}

.kai-phase.wiped {
  border-color: rgba(239, 68, 68, 0.4);
}

.kai-phase-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
}

.kai-phase-status.cleared {
  color: #4ade80;
}

.kai-phase-status.wiped {
  color: #f87171;
}

.kai-phase-targets {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.kai-target {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
}

.kai-target.killed {
  opacity: 0.6;
}

.kai-target-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.kai-target-name {
  font-size: 11px;
  color: #e2e8f0;
}

.kai-target-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 600;
}

.kai-target-badge.killed {
  background: rgba(74, 222, 128, 0.2);
  color: #4ade80;
}

.kai-target-badge.hp {
  background: rgba(248, 113, 113, 0.2);
  color: #f87171;
}
```

**Verify:** `npm run check` passes.

### Task 7: Manual verification

Upload a Kaineng Overlook log and verify:
- Phase timeline shows all phases (boss/split alternating)
- Wipe phase is highlighted red
- Killed bosses show "Killed" badge
- Surviving bosses show HP% left
- Minister Li phases show his image
- Split phases show add images (Enforcer, Mindblade, Ritualist, Mech Rider, Sniper)

**Command:** `npm run tauri dev` → upload log → inspect phase display.

## Tests / validation

| Step | Command | Expected |
|------|---------|----------|
| 1 | `cargo check` | exit 0 |
| 2 | `cargo check` | exit 0 |
| 3 | `cargo check` | exit 0 |
| 4 | `cargo test ei_runner::tests::ei_phases_populate_kaineng_phases` | passed |
| 5 | `npm run check` | 0 errors, 0 warnings |
| 6 | `npm run check` | 0 errors, 0 warnings |
| 7 | `npm run tauri dev` + upload log | Phase timeline renders correctly |

## Risks, tradeoffs, and open questions

1. **EI target indexing**: EI's `phases[].targets` contains indices into `targets[]`. Need to verify this mapping is correct by inspecting real EI JSON output.

2. **Phase naming**: EI names phases "Phase 1", "Split Phase 1", etc. May want to rename for clarity (e.g., "Minister Li (0-33%)", "Adds: Enforcer/Mindblade/Ritualist").

3. **HP% display**: For Minister Li phases, HP% left should show the boss's remaining health at wipe time. For split phases, each add's HP% is independent.

4. **Kill detection**: `healthPercentBurned > 0` means the boss took damage. `healthPercentBurned >= 100` means killed. Need to verify EI's threshold.

5. **Historical logs**: Existing Kaineng Overlook logs won't have `kaineng_phases` populated. They'll show the old single-boss card. No regression.

6. **CM vs NM**: EI generates the same phase structure for both modes. The display works for both.
