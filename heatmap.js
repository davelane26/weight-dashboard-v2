/**
 * heatmap.js — GitHub-style weight calendar heatmap
 * Renders a 26-week rolling calendar into #heatmap-grid.
 * Called from renderAll() in app.js on every data refresh.
 */

const HEATMAP_WEEKS = 26; // ~6 months

// Map weight → colour on a red→amber→green gradient (low weight = greener)
function _hmColor(weight, minW, maxW, isDark) {
  if (weight == null) return isDark ? '#252d40' : '#eef0f7';
  const t = Math.max(0, Math.min(1, 1 - (weight - minW) / (maxW - minW || 1)));
  // t=0 → heavy (red #ea1100), t=0.5 → amber (#ffc220), t=1 → light (green #2a8703)
  let r, g, b;
  if (t < 0.5) {
    const s = t * 2;
    r = Math.round(234 + (255 - 234) * s);
    g = Math.round(17  + (194 - 17)  * s);
    b = Math.round(0   + (32  - 0)   * s);
  } else {
    const s = (t - 0.5) * 2;
    r = Math.round(255 + (42  - 255) * s);
    g = Math.round(194 + (135 - 194) * s);
    b = Math.round(32  + (3   - 32)  * s);
  }
  const a = isDark ? 0.9 : 1;
  return `rgba(${r},${g},${b},${a})`;
}

function renderHeatmap(data) {
  const grid = document.getElementById('heatmap-grid');
  if (!grid) return;

  if (!data || !data.length) {
    grid.innerHTML = '<p style="font-size:0.8rem;color:#6d7a95">No weight data yet.</p>';
    return;
  }

  const isDark = document.getElementById('root')?.classList.contains('dark');

  // Build date → weight (latest reading wins per calendar day)
  const byDate = {};
  data.forEach(r => {
    const key = r.date.toLocaleDateString('en-CA'); // YYYY-MM-DD
    byDate[key] = r.weight;
  });

  const weights = Object.values(byDate);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);

  // Snap start to the Monday that is exactly HEATMAP_WEEKS weeks before today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDay = new Date(today);
  startDay.setDate(startDay.getDate() - HEATMAP_WEEKS * 7);
  const snapDow = (startDay.getDay() + 6) % 7; // Mon=0
  startDay.setDate(startDay.getDate() - snapDow);

  const totalWeeks = Math.ceil(((today - startDay) / 86400000 + 1) / 7);
  const CELL = 14, GAP = 3;
  const DAY_NAMES  = ['M', '', 'W', '', 'F', '', 'S'];
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build month label positions
  const monthLabels = [];
  for (let w = 0; w < totalWeeks; w++) {
    const d = new Date(startDay);
    d.setDate(d.getDate() + w * 7);
    if (w === 0 || d.getDate() <= 7) {
      monthLabels.push({ week: w, label: MONTH_ABBR[d.getMonth()] });
    }
  }

  // ── Build the grid HTML ──────────────────────────────────────────────
  let colsHtml = '';
  for (let w = 0; w < totalWeeks; w++) {
    colsHtml += '<div class="hm-col">';
    for (let d = 0; d < 7; d++) {
      const day = new Date(startDay);
      day.setDate(day.getDate() + w * 7 + d);
      if (day > today) {
        colsHtml += '<div class="hm-cell hm-future" aria-hidden="true"></div>';
        continue;
      }
      const key  = day.toLocaleDateString('en-CA');
      const wt   = byDate[key] ?? null;
      const bg   = _hmColor(wt, minW, maxW, isDark);
      const dateStr = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const tip  = wt != null ? `${dateStr}: ${wt.toFixed(1)} lbs` : `${dateStr}: no reading`;
      colsHtml += `<div class="hm-cell" style="background:${bg}" title="${tip}" aria-label="${tip}" role="img"></div>`;
    }
    colsHtml += '</div>';
  }

  const monthRowHtml = monthLabels
    .map(m => `<span class="hm-month" style="left:${m.week * (CELL + GAP)}px">${m.label}</span>`)
    .join('');

  const dayLabelsHtml = DAY_NAMES
    .map(n => `<div class="hm-day" style="height:${CELL}px;line-height:${CELL}px;margin-bottom:${GAP}px">${n}</div>`)
    .join('');

  grid.innerHTML = `
    <div class="hm-wrap">
      <div class="hm-day-labels">${dayLabelsHtml}</div>
      <div class="hm-scroll">
        <div class="hm-month-row" style="width:${totalWeeks * (CELL + GAP)}px">${monthRowHtml}</div>
        <div class="hm-grid">${colsHtml}</div>
      </div>
    </div>
    <div class="hm-legend">
      <span class="hm-leg-label">Heavier</span>
      <div class="hm-leg-bar"></div>
      <span class="hm-leg-label">Lighter</span>
      <span class="hm-leg-label" style="margin-left:0.75rem">· gray = no reading</span>
    </div>`;
}

window.renderHeatmap = renderHeatmap;
