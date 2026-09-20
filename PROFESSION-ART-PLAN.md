# Profession Artwork for Golem Log Cards

## Overview
Add profession-themed artwork to all Golem log cards (Standard Kitty Golem) for all 9 professions (5 core + 4 elite specializations).

---

## Current Log Card Dimensions

Based on app measurement:

| Element | Dimensions |
|---------|------------|
| Log card width | ~100% of content area (flexible) |
| Log card collapsed height | ~64px |
| Log card padding | 8px 10px |
| Available art area | ~50px height × ~40px width (right side) |

## Artwork Specifications

### Download Source
- Guild Wars 2 Wiki: Profession guardian/fighter/etc artwork
- File type: PNG with transparency preferred

### Required Dimensions (per profession)
| Asset | Size | Format |
|-------|------|--------|
| Original download | ~400×600px (wiki default) | PNG |
| Cropped/edited | **48×64px** | PNG with transparency |
| Safe zone | Top 60% of original (face/upper torso) | — |

### Cropping Guide
- **Show:** Head, shoulders, upper chest
- **Hide:** Lower body, feet, weapons below chest
- **Anchor:** Center horizontally, top-aligned
- **Aspect ratio:** 3:4 (portrait)

---

## File Structure

```
static/
└── professions/
    ├── core/
    │   ├── guardian.png
    │   ├── revenant.png
    │   ├── engineer.png
    │   ├── ranger.png
    │   ├── thief.png
    │   ├── elementalist.png
    │   ├── mesmer.png
    │   ├── necromancer.png
    │   └── warrior.png
    └── elite/
        ├── berserker.png
        ├── spellbreaker.png
        ├── dragonhunter.png
        ├── firebrand.png
        ├── scrapper.png
        ├── holosmith.png
        ├── druid.png
        ├── soulbeast.png
        ├── daredevil.png
        ├── deadeye.png
        ├── tempest.png
        ├── weaver.png
        ├── chronomancer.png
        ├── mirage.png
        ├── reaper.png
        ├── scourge.png
        ├── blademaster.png  (or similar)
        └── catalyst.png
```

---

## Artwork Placement

### Layout (Golem Log Card)
```
┌─────────────────────────────────────────────┐
│ [Icon]  Standard Kitty Golem     [Art] │
│         35,814 DPS | 1:50 | 1 Players  │
│ [Badges]                              │
└─────────────────────────────────────────────┘
```

### CSS
```css
.golem-log-card {
  position: relative;
  overflow: hidden;
}

.golem-profession-art {
  position: absolute;
  right: 0;
  top: 0;
  width: 48px;
  height: 64px;
  object-fit: cover;
  object-position: top;
  opacity: 0.7;
  mask-image: linear-gradient(to right, transparent 0%, rgba(0,0,0,0.5) 40%, rgba(0,0,0,0.7) 100%);
  -webkit-mask-image: linear-gradient(to right, transparent 0%, rgba(0,0,0,0.5) 40%, rgba(0,0,0,0.7) 100%);
}
```

---

## Implementation Steps

### Step 1: Download Artwork
- [ ] Download all profession artwork from wiki
- [ ] Core professions (9)
- [ ] Elite specializations (~18-20)

### Step 2: Edit Artwork
- [ ] Resize to 48×64px
- [ ] Crop to upper portion (face/upper torso)
- [ ] Add transparency where needed
- [ ] Ensure consistent style across all

### Step 3: Place Files
- [ ] Save to `static/professions/core/` and `static/professions/elite/`

### Step 4: Implement in Code
- [ ] Detect Golem logs (existing logic)
- [ ] Extract profession from log data
- [ ] Render profession art on card
- [ ] Style with gradient mask for smooth edge

### Step 5: Test & Refine
- [ ] Verify all 27+ professions render correctly
- [ ] Check responsive behavior
- [ ] Ensure art doesn't overlap text/badges

---

## Notes

- Art should blend seamlessly with the dark card background
- Gradient mask on left edge ensures art doesn't clash with text
- No vertical expansion of the card — art fits within existing ~64px height
- Consider a subtle colored glow behind art matching profession color (optional enhancement)

## Questions to Resolve

1. Which wiki pages have the best artwork for each profession?
2. Should elite specs have unique art, or reuse core profession art with a colored border/glow fallback?
3. Do we want colored edge glow per profession (e.g., orange for Elementalist, blue for Mesmer)?
