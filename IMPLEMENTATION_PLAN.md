# Implementation Plan: Enhancements 1, 2, and 5 (Titration, Lean Preservation, Site Heatmap)

Implement three integrated enhancements across `titration-trajectory.js`, `medication.js`, `dexa.js`/`app-kpis.js`, and `index.html` strictly within `C:\Projects\weight-dashboard-v2`.

---

## User Review Required

> [!IMPORTANT]
> **Summary of User Approvals Needed**:
> 1. **Feature 1 (Titration Trajectory)**: The trajectory card on the Projector tab transitions from a hardcoded 7.5mg view to a **Dynamic Multi-Dose Trajectory Engine**. It defaults to your active **10mg** dose (anchoring to your first 10mg shot weight ~250.7 lbs) and adds selector pills (`10mg (Current)` · `7.5mg` · `5.0mg`) so you can toggle between historical phases and your active trajectory.
> 2. **Feature 2 (Lean Preservation & Quality Index)**: Adds a dedicated **Lean Muscle Preservation & Fat-Loss Quality Card** directly under the Body Composition metrics in the Weight tab. Quantifies your 95% fat / 5% lean loss ratio and 99.9% DEXA lean retention against clinical trial benchmarks (which average 25–40% lean loss).
> 3. **Feature 5 (Injection Site Heatmap & Balance Meter)**: Enhances the interactive SVG body map on the Medication tab with injection frequency counters per zone, subtle heatmap shading, a bilateral Left vs Right balance meter, and a clean toggle button.

---

## Proposed Changes

### Component 1: Dynamic Active Dose Trajectory (10mg Upgrade)
**Files**: [titration-trajectory.js](file:///c:/Projects/weight-dashboard-v2/titration-trajectory.js), [index.html](file:///c:/Projects/weight-dashboard-v2/index.html)

#### [MODIFY] [titration-trajectory.js](file:///c:/Projects/weight-dashboard-v2/titration-trajectory.js)
- Remove hardcoded `TITRATION_DATE = new Date('2026-05-21')` and `DOSE_LABEL = '7.5mg Mounjaro'`.
- Add dynamic dose discovery via `TitrationUtils.currentDoseStart(shots)` and episode grouping from `loadShots()`.
- Add active dose state: `let activeDose = null;` (defaults to latest dose in shots, e.g. `10.0`).
- Implement dose switcher pills at the top of the card (`#tj-dose-pills`):
  - Renders pills for all detected doses (e.g. `10mg (Current)`, `7.5mg`, `5.0mg`).
  - Clicking a pill updates `activeDose` and re-runs `renderTitrationTrajectory()` instantaneously.
- Dynamically recompute:
  - Pre-shot baseline weight for the selected dose using `TitrationUtils.preChangeBaseline`.
  - Post-titration data slice for the selected dose.
  - "Days on dose" headline metric and label (`Days on 10mg`).
  - Scenario projection curves starting from the selected dose baseline/current weight down to 220 lbs.
  - Milestone ETAs and pace badge reflecting the selected dose.

#### [MODIFY] [index.html](file:///c:/Projects/weight-dashboard-v2/index.html)
- Update Section header from static `7.5mg Titration Trajectory` to dynamic container `<h2 class="card-title" id="tj-card-title">&#128137; Titration Trajectory</h2>`.
- Add `<div id="tj-dose-pills" style="display:flex;gap:0.4rem;margin:0.5rem 0 1rem;flex-wrap:wrap"></div>`.
- Bump `titration-trajectory.js?v=8`.

---

### Component 2: Lean Preservation & Fat-Loss Quality Index
**Files**: [dexa.js](file:///c:/Projects/weight-dashboard-v2/dexa.js), [app-kpis.js](file:///c:/Projects/weight-dashboard-v2/app-kpis.js), [index.html](file:///c:/Projects/weight-dashboard-v2/index.html)

#### [MODIFY] [dexa.js](file:///c:/Projects/weight-dashboard-v2/dexa.js)
- Add `computeLeanPreservationMetrics(currentWeight, dynComp)`:
  - Computes total weight lost since July 27 DEXA anchor (252.4 lbs) and journey start (315.0 lbs).
  - Computes lean mass retained percentage: `(dynComp.leanMass / 172.89) * 100` (e.g. `99.9%`).
  - Computes fat-loss quality ratio: `(fatMassLost / totalWeightLost) * 100` (e.g. `~95%`).
  - Compares against clinical trial benchmark (SURPASS / STEP average: `65% fat / 35% lean loss`).
  - Returns structured preservation data and status tier (`Elite Preservation`).

#### [MODIFY] [app-kpis.js](file:///c:/Projects/weight-dashboard-v2/app-kpis.js)
- In `renderKPIs`:
  - Call `DexaCal.computeLeanPreservationMetrics` and populate the new Lean Preservation card `#card-lean-preservation`.
  - Render progress comparison bars, retention gauge, and clinical protection summary.

#### [MODIFY] [index.html](file:///c:/Projects/weight-dashboard-v2/index.html)
- Add `#card-lean-preservation` in the Weight tab directly below the Body Composition KPI drawer:
  - Three key metric callouts:
    1. **Fat Loss Purity**: `~95%` (`⭐ Elite Preservation` badge).
    2. **Lean Mass Retained**: `172.8 / 172.9 lbs` (`99.9%` retained since DEXA).
    3. **Catabolism Defense**: `🛡️ Protected` (impedance normal, 7d rolling LBM > 170.0 lbs).
  - Visual comparison bar contrasting David's 95% fat / 5% lean ratio against the clinical trial average (65% fat / 35% lean).
  - Explanatory clinical note highlighting dietary protein & resistance training efficacy.
- Bump `dexa.js?v=2` and `app-kpis.js?v=3`.

---

### Component 3: Injection Site Heatmap & Bilateral Balance Meter
**Files**: [medication.js](file:///c:/Projects/weight-dashboard-v2/medication.js), [index.html](file:///c:/Projects/weight-dashboard-v2/index.html)

#### [MODIFY] [medication.js](file:///c:/Projects/weight-dashboard-v2/medication.js)
- Add state variable `let showSiteHeatmap = false;` (with persistence in `localStorage('g1_heatmap_v1')`).
- In `renderBodyMap()`:
  - Count historical injection frequency per site across all logged shots.
  - Calculate bilateral distribution: Left sites count vs Right sites count.
  - If heatmap mode is active:
    - Apply color tinting to zone rectangles based on frequency (soft emerald for low/rested, violet/amber for frequently used).
    - Render subtle frequency counter badge (`Nx`) on each zone card.
- Below the SVG map, render the **Bilateral Balance Meter**:
  - Horizontal split bar comparing Left vs Right percentages.
  - Status indicator: `⚖️ Well Balanced (Tissue Recovery Optimal)` or side-favoring recommendation.
  - Toggle button: `🗺️ Heatmap: [On / Off]`.

#### [MODIFY] [index.html](file:///c:/Projects/weight-dashboard-v2/index.html)
- Add container `#g1-site-balance-container` under `#g1-body-map`.
- Bump `medication.js?v=209`.

---

## Verification Plan

### Automated / Browser Verification
1. **Headless Microsoft Edge Execution**:
   - Verify `switchTab('projector')`:
     - Trajectory card defaults to active `10mg` dose.
     - Pills render for `10mg (Current)` and `7.5mg`.
     - Toggling pills dynamically updates pre-shot baseline, milestone ETAs, and chart datasets.
   - Verify `switchTab('weight')`:
     - `#card-lean-preservation` displays `95%` fat loss purity, `99.9%` lean mass retained, and `🛡️ Protected`.
     - Comparison bar and clinical benchmark render cleanly without layout shift.
   - Verify `switchTab('medication')`:
     - SVG body map displays usage badges and heatmap toggle.
     - Bilateral balance meter displays Left vs Right breakdown.
     - Clicking zones updates the selection dropdown and triggers re-render.
2. **Git Integrity & Clean Tree**:
   - Verify zero linter/syntax errors.
   - Commit and push to `origin main`.
