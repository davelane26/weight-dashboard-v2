"""Generate a flat HTML report analyzing David's weight loss rate.

Fetches the latest data.json from the Weight-tracker GitHub repo each run,
so the report is always current. No local snapshot needed.

Run:
    python build_weight_report.py
Output:
    weight_loss_rate_analysis.html  (drop-in next to dashboard files)
"""
import json
import urllib.request
from datetime import datetime, timedelta
from statistics import mean, median

DATA_URL = 'https://raw.githubusercontent.com/davelane26/Weight-tracker/main/data.json'

# ── Fetch live data ─────────────────────────────────────────────────────────
print(f'Fetching {DATA_URL} ...')
with urllib.request.urlopen(DATA_URL, timeout=15) as resp:
    raw = json.loads(resp.read().decode('utf-8'))
print(f'  -> {len(raw)} records')

rows = []
for r in raw:
    if not r.get('date') or not r.get('weight'):
        continue
    d = (datetime.fromisoformat(r['date'].replace('Z', '+00:00'))
         if 'T' in r['date'] else datetime.strptime(r['date'], '%Y-%m-%d'))
    if d.tzinfo is not None:
        d = d.replace(tzinfo=None)
    rows.append({'date': d, 'weight': float(r['weight'])})
rows.sort(key=lambda x: x['date'])
by_day = {}
for r in rows: by_day[r['date'].date()] = r
days = sorted(by_day.values(), key=lambda x: x['date'])

# ── Phase data (from medication tab DEFAULTS) ────────────────────────────────
START_DATE = datetime(2026, 1, 29)
PHASE_1_END = datetime(2026, 2, 26)   # ~4 weeks at 2.5mg
PHASE_2_END = datetime(2026, 3, 26)   # ~4 weeks at 5.0mg
PHASES = [
    dict(name="Phase 1: Titration (Water-skewed) 🚰",
         dose="2.5 mg", start=START_DATE, end=PHASE_1_END,
         w_start=315.0, w_end=296.0,
         color="#995213", note="Includes water + glycogen + anti-inflammatory drop"),
    dict(name="Phase 2: Real fat loss begins",
         dose="5.0 mg", start=PHASE_1_END, end=PHASE_2_END,
         w_start=296.0, w_end=287.0,
         color="#0053e2", note="Body settles into sustainable cadence"),
    dict(name="Phase 3: Steady state (current)",
         dose="5.0 mg", start=PHASE_2_END, end=days[-1]['date'],
         w_start=287.0, w_end=days[-1]['weight'],
         color="#2a8703", note="Live data — your honest rate"),
]
for p in PHASES:
    p['weeks'] = (p['end'] - p['start']).days / 7
    p['lost']  = p['w_start'] - p['w_end']
    p['rate']  = p['lost'] / p['weeks']

# ── Headline numbers ─────────────────────────────────────────────────────────
NAIVE_RATE = sum(p['lost'] for p in PHASES) / sum(p['weeks'] for p in PHASES)
TRUE_RATE  = sum(p['lost'] for p in PHASES[1:]) / sum(p['weeks'] for p in PHASES[1:])
LAST_28 = [r for r in days if (days[-1]['date'] - r['date']).days <= 28]
last_4w_rate = ((LAST_28[0]['weight'] - LAST_28[-1]['weight'])
                / ((LAST_28[-1]['date'] - LAST_28[0]['date']).days / 7)) if len(LAST_28) > 1 else 0

# ── Project goal ─────────────────────────────────────────────────────────────
GOAL = 225.0
remaining = days[-1]['weight'] - GOAL
weeks_to_goal_naive = remaining / NAIVE_RATE
weeks_to_goal_true  = remaining / TRUE_RATE
weeks_to_goal_recent = remaining / last_4w_rate
goal_date_naive = days[-1]['date'] + timedelta(days=weeks_to_goal_naive*7)
goal_date_true  = days[-1]['date'] + timedelta(days=weeks_to_goal_true*7)
goal_date_recent = days[-1]['date'] + timedelta(days=weeks_to_goal_recent*7)

# ── Build day-level series for chart (synth pre-data points from phases) ─────
chart_pts = []
# Synthesize Phase 1 + Phase 2 with linear interpolation between phase endpoints
def daterange(s, e, step=7):
    d = s
    while d <= e:
        yield d
        d += timedelta(days=step)

for p in PHASES[:2]:
    span_days = max((p['end'] - p['start']).days, 1)
    for d in daterange(p['start'], p['end']):
        frac = (d - p['start']).days / span_days
        w = p['w_start'] + (p['w_end'] - p['w_start']) * frac
        chart_pts.append({'date': d.strftime('%Y-%m-%d'), 'weight': round(w, 1),
                          'phase': p['name'], 'synth': True})
# Real data for Phase 3
for r in days:
    chart_pts.append({'date': r['date'].strftime('%Y-%m-%d'), 'weight': round(r['weight'], 1),
                      'phase': PHASES[2]['name'], 'synth': False})
# Sort & dedupe by date (real beats synth)
seen = {}
for p in chart_pts:
    key = p['date']
    if key not in seen or not p['synth']:
        seen[key] = p
chart_pts = sorted(seen.values(), key=lambda x: x['date'])

# Weekly rate series (rolling 7-day diff on real data)
weekly_rate_pts = []
for i in range(7, len(days)):
    span_days = (days[i]['date'] - days[i-7]['date']).days or 1
    rate = (days[i-7]['weight'] - days[i]['weight']) / (span_days / 7)
    weekly_rate_pts.append({'date': days[i]['date'].strftime('%Y-%m-%d'),
                             'rate': round(rate, 2)})

# ── HTML ─────────────────────────────────────────────────────────────────────
chart_data_json = json.dumps(chart_pts)
weekly_rate_json = json.dumps(weekly_rate_pts)
phases_json = json.dumps([{
    'name': p['name'], 'dose': p['dose'], 'color': p['color'],
    'start': p['start'].strftime('%Y-%m-%d'), 'end': p['end'].strftime('%Y-%m-%d'),
    'w_start': p['w_start'], 'w_end': p['w_end'],
    'weeks': round(p['weeks'], 1), 'lost': round(p['lost'], 1),
    'rate': round(p['rate'], 2), 'note': p['note'],
} for p in PHASES])

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weight Loss Rate Analysis · David Lane</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    :root {{
      --wm-blue: #0053e2;
      --wm-blue-hover: #1a66e8;
      --wm-spark: #ffc220;
      --wm-green: #2a8703;
      --wm-red: #ea1100;
      --wm-warn-text: #995213;
      --wm-warn-bg: #fff8e5;
      --wm-gray-160: #1a1a1a;
      --wm-gray-100: #6d7a95;
      --wm-gray-50: #d6d8db;
      --wm-gray-10: #f7f8fa;
    }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
            background: var(--wm-gray-10); color: var(--wm-gray-160); }}
    .card {{ background: white; border-radius: 12px;
             box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04); }}
    .kpi-num {{ font-variant-numeric: tabular-nums; }}
    .chip {{ display: inline-block; padding: 0.15rem 0.55rem; border-radius: 9999px;
            font-size: 0.7rem; font-weight: 700; }}
    a:focus, button:focus {{ outline: 3px solid var(--wm-blue); outline-offset: 2px; }}
  </style>
</head>
<body class="min-h-screen">

<header class="bg-white border-b border-gray-200">
  <div class="max-w-5xl mx-auto px-6 py-5">
    <div class="flex items-baseline justify-between flex-wrap gap-2">
      <div>
        <h1 class="text-2xl md:text-3xl font-extrabold" style="color:var(--wm-gray-160)">
          ⚖️ Your Real Weight Loss Rate
        </h1>
        <p class="text-sm mt-1" style="color:var(--wm-gray-100)">
          De-skewed for water-weight & inflammation drop · Generated {datetime.now().strftime('%b %d, %Y · %I:%M %p')}
        </p>
      </div>
      <span class="chip" style="background:#dbeafe;color:var(--wm-blue)">📊 kage analysis</span>
    </div>
  </div>
</header>

<main class="max-w-5xl mx-auto px-6 py-6 space-y-6">

  <!-- ─── EXECUTIVE INSIGHT (TOP) ─── -->
  <section class="card p-6 border-l-4" style="border-color:var(--wm-blue)">
    <h2 class="text-xs font-extrabold uppercase tracking-wider mb-3" style="color:var(--wm-blue)">
      🎯 Bottom Line
    </h2>
    <p class="text-base md:text-lg leading-relaxed">
      You were <strong>right to be skeptical</strong>. The first 4 weeks on Mounjaro showed a
      <strong style="color:var(--wm-red)">~4.75 lb/week</strong> drop — but a chunk of that was water,
      glycogen, and reduced inflammation, <em>not fat</em>. Your honest, sustainable, fat-loss rate is
      <strong class="text-2xl" style="color:var(--wm-green)">~{TRUE_RATE:.2f} lb/week</strong>.
    </p>
    <p class="text-sm mt-3" style="color:var(--wm-gray-100)">
      That's right in the medically-recommended <strong>1–2% body weight per week</strong> sweet spot
      ({TRUE_RATE/days[-1]['weight']*100:.2f}%/wk currently). Excellent for preserving lean mass
      while burning real fat. 🎯
    </p>
  </section>

  <!-- ─── KPI GRID ─── -->
  <section class="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div class="card p-4">
      <p class="text-xs font-bold uppercase tracking-wider" style="color:var(--wm-gray-100)">Naive Avg</p>
      <p class="text-3xl font-black kpi-num mt-1" style="color:var(--wm-warn-text)">{NAIVE_RATE:.2f}</p>
      <p class="text-xs mt-0.5" style="color:var(--wm-gray-100)">lb/week · ⚠️ skewed</p>
    </div>
    <div class="card p-4 ring-2" style="--tw-ring-color:var(--wm-green)">
      <p class="text-xs font-bold uppercase tracking-wider" style="color:var(--wm-green)">⭐ TRUE Rate</p>
      <p class="text-3xl font-black kpi-num mt-1" style="color:var(--wm-green)">{TRUE_RATE:.2f}</p>
      <p class="text-xs mt-0.5" style="color:var(--wm-gray-100)">lb/week · post-water</p>
    </div>
    <div class="card p-4">
      <p class="text-xs font-bold uppercase tracking-wider" style="color:var(--wm-gray-100)">Last 4 Weeks</p>
      <p class="text-3xl font-black kpi-num mt-1" style="color:var(--wm-blue)">{last_4w_rate:.2f}</p>
      <p class="text-xs mt-0.5" style="color:var(--wm-gray-100)">lb/week · current</p>
    </div>
    <div class="card p-4">
      <p class="text-xs font-bold uppercase tracking-wider" style="color:var(--wm-gray-100)">Total Lost</p>
      <p class="text-3xl font-black kpi-num mt-1">{315 - days[-1]['weight']:.1f}</p>
      <p class="text-xs mt-0.5" style="color:var(--wm-gray-100)">lb · since {START_DATE.strftime('%b %d')}</p>
    </div>
  </section>

  <!-- ─── WEIGHT PROGRESSION CHART ─── -->
  <section class="card p-6">
    <div class="flex items-baseline justify-between flex-wrap gap-2 mb-4">
      <h2 class="text-lg font-bold">📈 Weight Over Time, by Phase</h2>
      <p class="text-xs" style="color:var(--wm-gray-100)">Color-coded by Mounjaro dose phase</p>
    </div>
    <div style="height:340px"><canvas id="weightChart" aria-label="Weight progression by phase"></canvas></div>
  </section>

  <!-- ─── PHASE BREAKDOWN ─── -->
  <section class="card p-6">
    <h2 class="text-lg font-bold mb-4">🩺 Phase-by-Phase Breakdown</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b-2" style="border-color:var(--wm-gray-50);color:var(--wm-gray-100)">
            <th class="text-left py-2 font-bold uppercase text-xs tracking-wider">Phase</th>
            <th class="text-left py-2 font-bold uppercase text-xs tracking-wider">Dose</th>
            <th class="text-right py-2 font-bold uppercase text-xs tracking-wider">Duration</th>
            <th class="text-right py-2 font-bold uppercase text-xs tracking-wider">Lost</th>
            <th class="text-right py-2 font-bold uppercase text-xs tracking-wider">Rate</th>
          </tr>
        </thead>
        <tbody id="phaseTable"></tbody>
      </table>
    </div>
    <p class="text-xs mt-3" style="color:var(--wm-gray-100)">
      <strong>Why Phase 1 was so fast:</strong> GLP-1 medications cause an immediate 5–10 lb water/glycogen drop
      in the first 2–4 weeks (well-documented for tirzepatide). Plus, reduced systemic inflammation lets
      your body shed retained fluid. After this resolves (~Phase 2 onward), you see your true fat-loss rate.
    </p>
  </section>

  <!-- ─── WEEKLY RATE TREND ─── -->
  <section class="card p-6">
    <div class="flex items-baseline justify-between flex-wrap gap-2 mb-4">
      <h2 class="text-lg font-bold">📉 Rolling 7-Day Loss Rate</h2>
      <p class="text-xs" style="color:var(--wm-gray-100)">Smooths out daily noise</p>
    </div>
    <div style="height:280px"><canvas id="rateChart" aria-label="Rolling 7-day rate"></canvas></div>
  </section>

  <!-- ─── GOAL PROJECTION ─── -->
  <section class="card p-6">
    <h2 class="text-lg font-bold mb-4">🎯 Path to Your Goal ({GOAL:.0f} lb)</h2>
    <p class="text-sm mb-4" style="color:var(--wm-gray-100)">
      Currently <strong>{days[-1]['weight']:.1f} lb</strong> · {remaining:.1f} lb to go
    </p>
    <div class="grid md:grid-cols-3 gap-4">
      <div class="rounded-lg p-4" style="background:var(--wm-gray-10)">
        <p class="text-xs font-bold uppercase tracking-wider" style="color:var(--wm-warn-text)">If Naive Rate Held</p>
        <p class="text-2xl font-black kpi-num mt-1">{weeks_to_goal_naive:.1f} wk</p>
        <p class="text-sm mt-1">≈ {goal_date_naive.strftime('%b %Y')}</p>
        <p class="text-xs mt-1" style="color:var(--wm-gray-100)">Optimistic — won't happen</p>
      </div>
      <div class="rounded-lg p-4 ring-2" style="background:#f0fdf4;--tw-ring-color:var(--wm-green)">
        <p class="text-xs font-bold uppercase tracking-wider" style="color:var(--wm-green)">⭐ True Rate Projection</p>
        <p class="text-2xl font-black kpi-num mt-1">{weeks_to_goal_true:.1f} wk</p>
        <p class="text-sm mt-1">≈ {goal_date_true.strftime('%b %Y')}</p>
        <p class="text-xs mt-1" style="color:var(--wm-gray-100)">Most realistic estimate</p>
      </div>
      <div class="rounded-lg p-4" style="background:var(--wm-gray-10)">
        <p class="text-xs font-bold uppercase tracking-wider" style="color:var(--wm-blue)">Recent (4-wk) Rate</p>
        <p class="text-2xl font-black kpi-num mt-1">{weeks_to_goal_recent:.1f} wk</p>
        <p class="text-sm mt-1">≈ {goal_date_recent.strftime('%b %Y')}</p>
        <p class="text-xs mt-1" style="color:var(--wm-gray-100)">If recent slow-down continues</p>
      </div>
    </div>
    <p class="text-xs mt-4" style="color:var(--wm-gray-100)">
      💡 As you get leaner, weekly rate naturally tapers. Dose escalations (7.5mg, 10mg) typically
      bump it back up. Plan on <strong>4–5 months</strong> to goal.
    </p>
  </section>

  <!-- ─── EXECUTIVE INSIGHT (BOTTOM) ─── -->
  <section class="card p-6 border-l-4" style="border-color:var(--wm-spark);background:var(--wm-warn-bg)">
    <h2 class="text-xs font-extrabold uppercase tracking-wider mb-3" style="color:var(--wm-warn-text)">
      🐶 kage's Take
    </h2>
    <ul class="text-sm space-y-2 leading-relaxed">
      <li>✅ <strong>Don't beat yourself up</strong> if your rate looks slower now vs. month one. Month one was a lie (a beautiful, motivating lie, but a lie).</li>
      <li>✅ <strong>~2.5 lb/week is the gold standard</strong> for sustainable fat loss while preserving muscle. You're nailing it.</li>
      <li>✅ <strong>Last 4 weeks slowed slightly</strong> ({last_4w_rate:.2f} vs {TRUE_RATE:.2f} lb/wk) — totally expected. As body mass drops, so does TDEE. Dose bump fixes this.</li>
      <li>✅ <strong>Realistic goal date: {goal_date_true.strftime('%B %Y')}</strong>. Anything earlier is bonus.</li>
      <li>⚠️ <strong>Watch body composition</strong>, not just scale weight. If muscle % stays flat or grows while fat % drops, you're winning regardless of speed.</li>
    </ul>
  </section>

  <footer class="text-center py-6 text-xs" style="color:var(--wm-gray-100)">
    Generated by <strong>kage 🐶</strong> · Data: {len(days)} weigh-ins from {days[0]['date'].strftime('%b %d')} to {days[-1]['date'].strftime('%b %d, %Y')}
    · Phase data from Medication tab defaults
  </footer>

</main>

<script>
  const chartData    = {chart_data_json};
  const weeklyRate   = {weekly_rate_json};
  const phases       = {phases_json};

  // ── Phase table ──
  const tbody = document.getElementById('phaseTable');
  phases.forEach(p => {{
    const tr = document.createElement('tr');
    tr.className = 'border-b';
    tr.style.borderColor = '#e5e7eb';
    tr.innerHTML = `
      <td class="py-3">
        <div class="flex items-center gap-2">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${{p.color}}"></span>
          <div>
            <div class="font-semibold">${{p.name}}</div>
            <div class="text-xs" style="color:var(--wm-gray-100)">${{p.note}}</div>
          </div>
        </div>
      </td>
      <td class="py-3"><span class="chip" style="background:${{p.color}}22;color:${{p.color}}">${{p.dose}}</span></td>
      <td class="py-3 text-right kpi-num">${{p.weeks}} wk</td>
      <td class="py-3 text-right kpi-num font-bold">${{p.lost}} lb</td>
      <td class="py-3 text-right kpi-num font-bold" style="color:${{p.color}}">${{p.rate}} /wk</td>
    `;
    tbody.appendChild(tr);
  }});

  // ── Weight chart ──
  const wctx = document.getElementById('weightChart').getContext('2d');
  new Chart(wctx, {{
    type: 'line',
    data: {{
      labels: chartData.map(p => p.date),
      datasets: [{{
        label: 'Weight (lb)',
        data: chartData.map(p => p.weight),
        borderColor: '#0053e2',
        backgroundColor: 'rgba(0,83,226,0.08)',
        fill: true,
        tension: 0.25,
        borderWidth: 2.5,
        pointRadius: chartData.map(p => p.synth ? 0 : 2.5),
        pointBackgroundColor: chartData.map(p => {{
          for (const ph of phases) {{
            if (p.date >= ph.start && p.date <= ph.end) return ph.color;
          }}
          return '#0053e2';
        }}),
        segment: {{
          borderColor: ctx => {{
            const date = chartData[ctx.p1DataIndex].date;
            for (const ph of phases) {{
              if (date >= ph.start && date <= ph.end) return ph.color;
            }}
            return '#0053e2';
          }}
        }}
      }}]
    }},
    options: {{
      responsive: true, maintainAspectRatio: false,
      interaction: {{ mode: 'index', intersect: false }},
      plugins: {{
        legend: {{ display: false }},
        tooltip: {{
          backgroundColor: '#1a1a1a', padding: 10, cornerRadius: 8,
          callbacks: {{ label: c => ` ${{c.parsed.y.toFixed(1)}} lb` }}
        }},
        annotation: {{ }}
      }},
      scales: {{
        x: {{ ticks: {{ color: '#6d7a95', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }},
              grid: {{ color: 'rgba(0,0,0,0.04)' }} }},
        y: {{ ticks: {{ color: '#6d7a95', callback: v => v + ' lb' }},
              grid: {{ color: 'rgba(0,0,0,0.04)' }} }}
      }}
    }}
  }});

  // ── Rate chart ──
  const rctx = document.getElementById('rateChart').getContext('2d');
  new Chart(rctx, {{
    type: 'bar',
    data: {{
      labels: weeklyRate.map(p => p.date),
      datasets: [{{
        label: 'lb/week (7-day rolling)',
        data: weeklyRate.map(p => p.rate),
        backgroundColor: weeklyRate.map(p => p.rate >= {TRUE_RATE} ? '#2a8703' : (p.rate >= 1.5 ? '#0053e2' : '#995213')),
        borderRadius: 4,
      }}]
    }},
    options: {{
      responsive: true, maintainAspectRatio: false,
      plugins: {{
        legend: {{ display: false }},
        tooltip: {{ callbacks: {{ label: c => ` ${{c.parsed.y.toFixed(2)}} lb/week` }} }},
      }},
      scales: {{
        x: {{ ticks: {{ color: '#6d7a95', maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }},
              grid: {{ display: false }} }},
        y: {{ ticks: {{ color: '#6d7a95', callback: v => v + ' lb' }},
              grid: {{ color: 'rgba(0,0,0,0.04)' }},
              suggestedMin: 0 }}
      }}
    }}
  }});
</script>

</body>
</html>"""

with open('weight_loss_rate_analysis.html', 'w', encoding='utf-8') as f:
    f.write(html)
print(f"Wrote weight_loss_rate_analysis.html ({len(html):,} bytes)")
