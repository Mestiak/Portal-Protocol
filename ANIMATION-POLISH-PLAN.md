# Animation & Polish Enhancement Plan

## Priority 1: Critical Response (Feel Alive) — ✅ COMPLETE

### 1.1 Button Press Feedback
**Files:** `src/app.css`
**Target:** All action buttons, checkboxes
**Change:** Instant `:active` scale + opacity on pointer-down

### 1.2 Log Card Entrance Animation
**Files:** `src/app.css`
**Target:** `.records-list > *` (log cards)
**Change:** Staggered slide-up + fade entrance (30ms delay per card)

### 1.3 Mode Badge Spring-In
**Files:** `src/app.css`
**Target:** `.cm-badge`, `.lcm-badge`, `.qp-badge`, `.ura-ahr-badge`
**Change:** Pop-in with spring overshoot

### 1.4 Checkbox Spring
**Files:** `src/app.css`
**Target:** `input[type="checkbox"]`
**Change:** Bounce on check flip

### 1.5 Focus Ring Animation
**Files:** `src/app.css`
**Target:** All textareas and inputs
**Change:** Animated focus ring with accent color glow

---

## Priority 2: Feedback & Delight — ✅ COMPLETE

### 2.1 Upload Stage Transitions
**Files:** `src/app.css`
**Target:** `.stage-step`
**Change:** Smooth color/scale transitions on stage change

### 2.2 Success/Error States
**Files:** `src/app.css`
**Target:** `.status-pill`
**Change:** Pop animation for success, shake animation for error

### 2.3 AHR Badge Pulse
**Files:** `src/app.css`
**Target:** `.ura-ahr-badge`
**Change:** Pulse ring on first appearance (glow effect)

### 2.4 Kaineng Phases Accordion
**Files:** `src/app.css`
**Target:** `.kai-phases-header`, `.kai-phase`
**Change:** Press feedback on header, staggered slide-in for phases

### 2.5 Chevron Toggle Animation
**Files:** `src/app.css`
**Target:** `.kai-phases-toggle i`
**Change:** Smooth rotation on toggle

---

## Priority 3: Materials & Depth — ✅ COMPLETE

### 3.1 Modal Materials
**Files:** `src/app.css`
**Target:** All modals
**Change:** Backdrop blur + scale-from-source animation

### 3.2 Sidebar Glass Material
**Files:** `src/app.css`
**Target:** `.sidebar`
**Change:** Translucent glass with `backdrop-filter: blur(20px)`

### 3.3 Format Textarea Focus Ring
**Files:** `src/app.css`
**Target:** Textarea in log formatter
**Change:** Covered by 1.5 Focus Ring Animation (already implemented)

### 3.4 Tooltip Spring-Pop
**Files:** `src/app.css`
**Target:** `.custom-tooltip-box`
**Change:** Spring scale from top center origin

---

## Priority 4: Spatial Consistency — ✅ COMPLETE

### 4.1 Format Panel Slide
**Target:** Formatter panel
**Change:** Slide down from header, not pop-in

### 4.2 Patch Notes Modal Sheet
**Target:** Patch notes modal
**Change:** Spring up from bottom (mobile-style)

### 4.3 Context Menus
**Files:** `src/app.css`
**Target:** Right-click menu (`.ctx-menu`) and card dropdown (`.card-dropdown-menu`)
**Change:** Spring scale from click position

---

## Priority 5: Reduced Motion (Accessibility) — ✅ COMPLETE

### 5.1 prefers-reduced-motion
**Target:** All animated elements (Priority 1-4)
**Change:** Replace slides/springs with simple opacity cross-fades

---

## Implementation Log

| Priority | Status | Date | Notes |
|----------|--------|------|-------|
| 1 | ✅ Complete | 2026-09-14 | Card entrance, button press, badge pop, checkbox spring, focus ring |
| 2 | ✅ Complete | 2026-09-14 | Stage transitions, status pop/shake, AHR pulse, Kaineng accordion |
| 3 | ✅ Complete | 2026-09-14 | Modal materials, sidebar glass, tooltip spring-pop |
| 4 | ✅ Complete | 2026-09-14 | Context menus: right-click + dropdown spring from click position |
| 5 | ✅ Complete | 2026-09-14 | prefers-reduced-motion for all P1-P4 animations |

## Files Modified

- `src/app.css` — All Priority 1-5 CSS animations
- `src/routes/+page.svelte` — AHR badge, formatter, patch notes, context menu
- `src/routes/ApiTracker.svelte` — Clears tab

## Estimated Effort

- Priority 1: ~2 hours ✅ Complete
- Priority 2: ~1.5 hours ✅ Complete
- Priority 3: ~1 hour ✅ Complete
- Priority 4: ~0.5 hours ✅ Complete
- Priority 5: ~0.5 hours ✅ Complete
- **Total: ~5.5 hours ✅ All Complete**
