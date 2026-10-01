# Implementation Plan: Transition Projections to Lifetime Journey Trend

Transition all projection and ETA calculations across the dashboard from the volatile 28-day rolling regression window to the proven, statistically robust **Lifetime Journey Trend** (~1.84 lbs/week), keeping all work strictly within `C:\Projects\weight-dashboard-v2`.

---

## 1. Why the Lifetime Trend is the Best Choice

### The Problem with the 28-Day Window
1. **Plateau Sensitivity**: In GLP-1 weight loss, progress naturally occurs in waves—periods of steady loss followed by 3–6 week adaptation plateaus. During David's recent plateau on 7.5mg, the 28-day linear regression slope flattened to near-zero (or temporarily fluctuated $\ge 0$).
2. **Division by Zero & Mathematical Breakdown**: When a 28-day slope approaches 0:
   - Calculating arrival dates ($30\text{ lbs} \div 0.05\text{ lbs/wk}$) generates dates decades in the future (e.g., year 2035).
   - When slope $\ge 0$, the code executes `!useModel`, hard-disabling the UI with: *"Trend is flat or gaining — projection unavailable"*, making the date picker, target slider, and countdown cards completely unusable.
3. **Titration Blindspot**: When titrating up to a new dose (e.g., 10mg), there are only 1–2 scale readings on the new dose. The 28-day window still looks back into the stalled 7.5mg tail, leaving the projector locked in an error state for another month.

### Why the Lifetime Trend is Statistically & Clinically Superior
1. **Proven Empirical Velocity**: David has logged over 200+ consistent weigh-ins from Jan 29, 2026 to Oct 1, 2026 (35 weeks).
   - Starting Weight: `315.0 lbs`
   - Current Weight: `~250.7 lbs`
   - Total Lost: `64.3 lbs` across 245 days = **~1.84 lbs/week** (`0.263 lbs/day`).
   - This matches clinical trial data (SURPASS-1 / SURPASS-2) and represents David's true metabolic velocity.
2. **Immunity to Water-Weight & Adaptation Dips**: Sodium fluctuations, travel, or short-term titration stalls no longer disable the dashboard.
3. **Realistic & Actionable ETAs**:
   - At ~1.84 lbs/wk, reaching 220 lbs (~30.7 lbs to go) projects to $\sim 16.7\text{ weeks}$ (late January / early February 2027), giving David a clear, motivating target.
4. **Already Proven on Main Dashboard**: The "Next Milestone ETA" on the Weight tab already uses this lifetime rate for this exact reason.

---

## Proposed Changes

### Component 1: Weight Projector Tab (`app-goal.js`)
**File**: [app-goal.js](file:///c:/Projects/weight-dashboard-v2/app-goal.js)

#### [MODIFY] [app-goal.js](file:///c:/Projects/weight-dashboard-v2/app-goal.js)
1. **`computeProjection()`**:
   - Replace `rate28` as the primary projection rate with the **Lifetime Journey Rate**:
     $$\text{lifetimeRatePerDay} = \frac{\text{START\_WEIGHT} - \text{projLatestWeight}}{\text{totalDaysElapsed}} \approx 0.263\text{ lbs/day}\ (1.84\text{ lbs/wk})$$
   - Remove the `if (!useModel)` blocking guard that hides the countdown card and displays *"Trend is flat or gaining — projection unavailable"*.
   - **Date Picker (`#proj-date-input`)**: Computes projected weight for any chosen future date using the lifetime pace.
   - **Target Slider (`#proj-weight-input`)**: Always calculates arrival date, days away, total lost, and remaining pounds using the lifetime pace.
   - **Range Band**: In `#proj-cd-adjusted-wrap`, display a scenario range band:
     - Conservative pace ($1.50\text{ lbs/wk}$)
     - Base Case lifetime pace ($1.84\text{ lbs/wk}$)
     - Fast pace ($2.00\text{ lbs/wk}$)
   - **Header Blurb (`#proj-trend-blurb`)**:
     Update to: *"Based on your lifetime pace of ~1.8 lbs/wk across 35 weeks (64.3 lbs lost). Pick a date or target below to see your arrival projections."*
   - **Diagnostic Slowdown Check**: Keep the Slowdown Check below the projector intact as a diagnostic card (showing last 4 wks vs prior 4 wks), but decoupled from blocking the interactive projector.

2. **`renderGoal(latest, data)`** (Weight Tab Goal Card):
   - Replace the unstable 14d/28d regression ETA with the lifetime journey rate.
   - Computes ETA to `goalWeight` based on the lifetime pace, with a realistic buffer (e.g., target arrival date and weeks remaining).

---

### Component 2: Centralized Projection Rate in `app-kpis.js` & `rate-analysis.js`
**Files**: [app-kpis.js](file:///c:/Projects/weight-dashboard-v2/app-kpis.js), [rate-analysis.js](file:///c:/Projects/weight-dashboard-v2/rate-analysis.js)

#### [MODIFY] [app-kpis.js](file:///c:/Projects/weight-dashboard-v2/app-kpis.js)
- In `renderJourney()`:
  - Set `projSlopeLbsPerDay` to the lifetime slope (negative for loss):
    `projSlopeLbsPerDay = -(totalLostJourney / totalDaysElapsed);`
  - Ensures all downstream listeners and cards reference the stable lifetime slope.

#### [MODIFY] [rate-analysis.js](file:///c:/Projects/weight-dashboard-v2/rate-analysis.js)
- In `renderRateAnalysis()`:
  - Prevent overwriting `projSlopeLbsPerDay` with a stalled 28-day slope.

---

## Verification Plan

### Automated Browser Testing
- Run Microsoft Edge in headless mode (`--headless=new --disable-gpu --dump-dom`).
- Test Cases:
  1. **Projector Availability**: Verify `#proj-date-result` and `#proj-weight-result` do **NOT** show "Trend is flat or gaining — projection unavailable".
  2. **Target Slider & Countdown**: Verify sliding to 220 lbs displays the countdown card `#proj-countdown` with an arrival date in ~16–17 weeks (early 2027).
  3. **Date Picker**: Verify picking a future date (e.g., Dec 31, 2026) displays projected weight reduction based on ~1.84 lbs/week.
  4. **Goal Card on Weight Tab**: Verify `#goal-eta` displays a stable, sensible date reflecting the lifetime pace.
