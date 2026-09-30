# Implementation Plan: Dynamic Body Composition & Muscle Catabolism Protection Engine

Integrate the user's clinically anchored `calculateDynamicComposition` model into [dexa.js](file:///c:/Projects/weight-dashboard-v2/dexa.js) and [app-kpis.js](file:///c:/Projects/weight-dashboard-v2/app-kpis.js) to replace static ratio calculations with a 5% vascular/connective cushion model and impedance-gated muscle catabolism detection.

---

## User Review Required

> [!IMPORTANT]
> **Dynamic Anchor Calibration Shift**:
> - Previously, the ratio method assumed an 82% fat / 18% lean loss split (`FAT_LOSS_RATIO = 0.82`).
> - The new dynamic formula uses the July 27 clinical DEXA baseline (252.4 lbs start weight, 172.89 lbs lean mass = 31.5% body fat) with a **5% support cushion rate** (`SUPPORT_CUSHION_RATE = 0.05`), attributing ~95% of weight loss to fat tissue as long as muscle catabolism is not triggered.
> - At current weights (~245–250 lbs), this will adjust calculated Body Fat % slightly lower (more honest reflection of fat-exclusive loss with resistance training & protein) while actively guarding against muscle loss.

---

## Proposed Changes

### Component 1: Core Calculation Engine ([dexa.js](file:///c:/Projects/weight-dashboard-v2/dexa.js))

#### [MODIFY] [dexa.js](file:///c:/Projects/weight-dashboard-v2/dexa.js)
- Add `calculateDynamicComposition(todayRow, history = [])`:
  - **Clinical Anchor**: `DEXA_BASELINE_LEAN = 172.89`, `DEXA_START_WEIGHT = 252.4`, `SUPPORT_CUSHION_RATE = 0.05`.
  - **Rolling Average**: Computes 7-day rolling average scale LBM (`avgScaleLBM`) from `history.slice(-7)`.
  - **5% Cushion Base Lean Mass**: `expectedLeanMass = DEXA_BASELINE_LEAN - (0.05 * weightLostSinceDexa)`.
  - **Catabolism Gate**: If `avgScaleLBM < 170.0` AND `currentImpedance > 520 Ω`:
    - Steps down `expectedLeanMass = Math.min(expectedLeanMass, avgScaleLBM)`.
    - Triggers `hasMuscleLossAlert = true`.
  - **Returns**: `{ bodyFatPct, fatMass, leanMass, hasMuscleLossAlert, avgScaleLBM }`.
- Expose on `window.DexaCal.calculateDynamicComposition`, `window.DexaCal.getDynamicComposition`, and `window.calculateDynamicComposition`.
- Add UMD / Node export safeguard (`if (typeof module !== 'undefined' && module.exports)`).

---

### Component 2: Dashboard KPI Cards & Alert UI ([app-kpis.js](file:///c:/Projects/weight-dashboard-v2/app-kpis.js) & [index.html](file:///c:/Projects/weight-dashboard-v2/index.html))

#### [MODIFY] [index.html](file:///c:/Projects/weight-dashboard-v2/index.html)
- In the **Body Composition** card section:
  - Add an alert container `#kpi-catabolism-alert` directly below the section title:
    - Hidden by default.
    - When active: red-bordered callout banner warning of muscle catabolism detection (7-day LBM < 170.0 lbs and impedance > 520 Ω) advising protein & resistance training prioritization.
  - Update `#kpi-fat` unit descriptor from `(DEXA ratio method)` to `(DEXA dynamic method)`.
  - In `#body-comp-extras`: add a **Lean Body Mass** KPI card (`#kpi-lean-lbs`) showing the live anchored lean mass (e.g. `~172.5 lbs`) alongside Fat Mass and Muscle Mass.

#### [MODIFY] [app-kpis.js](file:///c:/Projects/weight-dashboard-v2/app-kpis.js)
- In `renderKPIs(latest, prev)`:
  - Execute `DexaCal.calculateDynamicComposition(latest, allData)` for the latest reading and previous reading.
  - Update `#kpi-fat` to use `dynComp.bodyFatPct`.
  - Update `#kpi-fat-lbs` to use `dynComp.fatMass`.
  - Update new `#kpi-lean-lbs` to display `dynComp.leanMass` and its delta from previous reading.
  - Evaluate `dynComp.hasMuscleLossAlert`:
    - Show and populate `#kpi-catabolism-alert` if triggered.
    - If clear, hide the alert banner and keep status healthy.

---

### Component 3: Data Ingestion ([cloudflare-worker/worker.js](file:///c:/Projects/weight-dashboard-v2/cloudflare-worker/worker.js))

#### [MODIFY] [cloudflare-worker/worker.js](file:///c:/Projects/weight-dashboard-v2/cloudflare-worker/worker.js)
- In `convertOpenScaleMeasurement(m)`:
  - Ensure `entry.impedance` is extracted from `m.impedance` or `byKey.impedance` so electrical impedance is retained across cloud syncs.

---

## Verification Plan

### Automated / Scratch Tests
- Run a Node.js verification script (`test_dynamic_composition.js`) to test:
  1. Standard loss case (weight = 245.0, impedance = 495, baseline LBM = 171.0) -> confirms 5% cushion calculation and no alert.
  2. Catabolism trigger case (weight = 245.0, rolling LBM = 168.5 < 170.0, impedance = 525 > 520) -> confirms anchor step-down and `hasMuscleLossAlert === true`.
  3. Hydration artifact case (rolling LBM = 168.0, impedance = 490 <= 520) -> confirms alert does NOT trip when impedance is normal.
  4. Missing/edge case inputs (empty history, missing impedance fallback to 495).

### Browser / Manual Verification
- Open dashboard or check local files to ensure:
  - No syntax errors in `dexa.js` or `app-kpis.js`.
  - Body composition cards render cleanly without breaking existing charts or toggles.
  - Collapsible `#body-comp-extras` displays Fat Mass, Muscle Mass, and the new Lean Body Mass cards correctly.
