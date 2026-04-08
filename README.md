# David's Weight Dashboard v2

A personal weight tracking dashboard powered by [openScale](https://github.com/oliexdev/openScale) data, built with vanilla HTML/CSS/JS and hosted on GitHub Pages.

🔗 **Live:** https://davelane26.github.io/weight-dashboard-v2/

---

## How It Works

1. You step on your Bluetooth scale
2. openScale on your phone syncs the reading
3. Data pushes to `data.json` in this repo
4. The dashboard auto-refreshes every 30 seconds and updates everything

No manual entry needed for weight data — it's all automatic.

---

## Features

### 📊 Trend Weight Hero
A Happy Scale-style headline at the top of the page showing your **7-day smoothed trend weight** rather than the raw daily reading. Turns green when you're trending down, red if trending up.

Includes a **decade badge** (e.g. "You're in the 280s!") that updates as you cross milestones.

### ⚖️ KPI Cards
Eight cards showing your latest reading across:
- Weight, BMI, Body Fat %, Muscle %, Body Water %
- Bone Mass, BMR, TDEE

All values animate in with a count-up effect on load.

### 🏆 Weight Loss Journey
Progress bar and stats tracking from your starting weight (315 lbs, Jan 23 2026) to today. Shows total lost, % of body weight lost, and current weight.

### 🎯 Goal Weight
Set a target weight and track your progress with:
- Remaining lbs to go
- Progress bar + percentage
- **Projected goal date** — two modes:
  - **Calorie-based** (when calories are logged) — uses your rolling average calorie intake vs TDEE
  - **Regression-based** (fallback) — linear regression on last 30 days of weigh-ins

### 🍔 7-Day Calorie Log
Log your daily calorie intake at the end of each day. The dashboard:
- Stores up to 30 days of entries in your browser (localStorage)
- Shows a table of the last 7 days with date, calories, and deficit/surplus vs your TDEE
- Calculates a **rolling 7-day average** shown as a badge
- Uses that average to drive the projected goal date
- Auto-migrates any previous single-value calorie entry

**Workflow:**
```
End of day → enter total calories → Log
Next day   → enter new total     → Log  (yesterday stays in the table)
```

Delete any entry with the × button. Projection automatically falls back to linear regression if no calories are logged.

### 📈 Weight Trend Chart
Full weight history chart with:
- Daily readings
- 7-day rolling average line
- Goal weight dashed line (when goal is set)
- **Time range pills** — 1M / 3M / 6M / All

### 🧬 Body Composition Charts
- Fat % vs Muscle % trend
- Body Water % trend

### 🔥 Streak Counter
Consecutive days you've weighed in. Keeps you accountable.

### 📅 Week-Over-Week Table
Weekly summary showing avg, min, max weight and change vs previous week.

### 🔥 Calorie & Goal Insights
Based on your TDEE from the scale:
- Calories to maintain
- Calories to lose 1 lb/week (−500 deficit)
- Calories to lose 2 lbs/week (−1,000 deficit)

---

## Goal Date Projection Logic

### Calorie-based (when calories are logged)
```
deficit    = TDEE − average daily calories
lbs/week   = deficit × 7 ÷ 3,500
days left  = lbs remaining ÷ daily rate
```

### Regression-based (fallback)
Linear regression on the last 30 days of daily weigh-ins gives a slope (lbs/day). Projected date = today + (remaining ÷ |slope|).

---

## Local Development

```bash
cd weight-dashboard-v2
python -m http.server 8900
# open http://localhost:8900
```

No build step, no dependencies, no framework. Just files.

---

## Stack
- Vanilla HTML + CSS + JavaScript
- [Chart.js](https://www.chartjs.org/) for charts
- [Inter](https://fonts.google.com/specimen/Inter) font
- GitHub Pages for hosting
- openScale for data collection

---

*Built by Code Puppy 🐶 on Walmart Eagle WiFi*
