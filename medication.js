// medication.js — GLP-1 Tracker v4
(function () {
  const GLP1_KEY = 'glp1_v4';
  const SYM_KEY  = 'glp1_sym_v4';
  const SUP_KEY  = 'glp1_sup_v4';
  const ACCENT   = '#534ab7';
  const SEED_VER = 2;

  const PK = { ka: 0.03, ke: 0.00578 };

  const PHASES = [
    { name:'Launch',      start:0,   end:12,  emoji:'💉', color:'#f59f00',
      what:'Drug absorbing subcutaneously; plasma levels near zero',
      side:'Injection site tenderness, minimal systemic effects',
      watch:'Avoid rubbing the injection site; rotate locations' },
    { name:'Rise',        start:12,  end:36,  emoji:'📈', color:'#2f9e44',
      what:'Plasma levels climbing rapidly toward peak concentration',
      side:'Nausea, belching, reduced appetite beginning',
      watch:'Stay hydrated; eat smaller portions; note early satiety' },
    { name:'Peak Effect', start:36,  end:72,  emoji:'⚡', color:'#534ab7',
      what:'Maximum GIP/GLP-1 receptor activation across all tissues',
      side:'Nausea at its peak, possible vomiting, fatigue, dizziness',
      watch:'Avoid large meals; best window for weigh-in accuracy' },
    { name:'Cruise',      start:72,  end:108, emoji:'🛳️', color:'#1971c2',
      what:'Sustained therapeutic plasma level; stable receptor activation',
      side:'GI effects easing; appetite suppression continues',
      watch:'Optimal window for hitting protein goals and exercising' },
    { name:'Descent',     start:108, end:144, emoji:'📉', color:'#e67700',
      what:'Levels tapering as clearance outpaces absorption tail',
      side:'Appetite returning; food noise increasing',
      watch:'Stick to meal schedule; log any returning cravings' },
    { name:'Pre-Shot',    start:144, end:168, emoji:'⏰', color:'#c92a2a',
      what:'Below therapeutic threshold — GI protection largely gone',
      side:'Appetite mostly restored; possible pre-shot hunger surge',
      watch:'Prep next pen; log pre-shot weight for best trend data' },
  ];

  const SYMPTOMS = [
    'Nausea','Vomiting','Diarrhea','Constipation','Fatigue','Headache',
    'Dizziness','Injection Site Pain','Belching','Heartburn',
    'Appetite Loss','Food Noise High','Mood Changes','Sleep Disruption',
    'Hair Loss','Muscle Aches',
  ];

  const SHOT_SEED = [
    { id:'i1',  date:'2026-01-29T17:30', med:'Mounjaro 2.5mg', dose:2.5, site:'Abdomen Lower Left', imported:true, weight:null  },
    { id:'i2',  date:'2026-02-05T17:30', med:'Mounjaro 2.5mg', dose:2.5, site:'Lower Mid',          imported:true, weight:null  },
    { id:'i3',  date:'2026-02-12T17:30', med:'Mounjaro 2.5mg', dose:2.5, site:'Abdomen Lower Left', imported:true, weight:null  },
    { id:'i4',  date:'2026-02-19T17:30', med:'Mounjaro 2.5mg', dose:2.5, site:'Lower Mid',          imported:true, weight:null  },
    { id:'i5',  date:'2026-02-26T17:30', med:'Mounjaro 5mg',   dose:5.0, site:'Abdomen Lower Left', imported:true, weight:null  },
    { id:'i6',  date:'2026-03-05T17:30', med:'Mounjaro 5mg',   dose:5.0, site:'Lower Mid',          imported:true, weight:null  },
    { id:'i7',  date:'2026-03-12T17:30', med:'Mounjaro 5mg',   dose:5.0, site:'Abdomen Lower Left', imported:true, weight:null  },
    { id:'i8',  date:'2026-03-19T17:30', med:'Mounjaro 5mg',   dose:5.0, site:'Lower Mid',          imported:true, weight:287.7 }, // Mar 21 (earliest scale reading)
    { id:'i9',  date:'2026-03-26T17:30', med:'Mounjaro 5mg',   dose:5.0, site:'Abdomen Lower Left', imported:true, weight:288.1 }, // Mar 25 morning
    { id:'i10', date:'2026-04-02T17:30', med:'Mounjaro 5mg',   dose:5.0, site:'Lower Mid',          imported:true, weight:284.8 }, // Apr 1 morning
    { id:'i11', date:'2026-04-09T17:30', med:'Mounjaro 5mg',   dose:5.0, site:'Abdomen Lower Left', imported:true, weight:284.8 }, // Apr 9 morning
    { id:'i12', date:'2026-04-16T17:30', med:'Mounjaro 5mg',   dose:5.0, site:'Lower Mid',          imported:true, weight:277.8 }, // Apr 13 morning (closest before)
    { id:'i13', date:'2026-04-23T17:30', med:'Mounjaro 5mg',   dose:5.0, site:'Abdomen Lower Left', imported:true, weight:274.0 }, // Apr 23 morning
    { id:'i14', date:'2026-04-30T17:30', med:'Mounjaro 5mg',   dose:5.0, site:'Lower Mid',          imported:true, weight:271.6 }, // Apr 30 morning
    { id:'i15', date:'2026-05-07T17:30', med:'Mounjaro 5mg',   dose:5.0, site:'Abdomen Lower Left', imported:true, weight:270.7 }, // May 3 morning (May 5 3am spike excluded)
    { id:'i16', date:'2026-05-14T17:30', med:'Mounjaro 5mg',   dose:5.0, site:'Lower Mid',          imported:true, weight:269.4 }, // May 14 morning
  ];

  // ── Storage ───────────────────────────────────────────────────────────────
  function loadShots()     { try { return JSON.parse(localStorage.getItem(GLP1_KEY)) || []; } catch(e) { return []; } }
  function saveShots(s)    { localStorage.setItem(GLP1_KEY, JSON.stringify(s)); }
  function loadSymptoms()  { try { return JSON.parse(localStorage.getItem(SYM_KEY))  || []; } catch(e) { return []; } }
  function saveSymptoms(s) { localStorage.setItem(SYM_KEY, JSON.stringify(s)); }
  function loadSupply()    { try { return JSON.parse(localStorage.getItem(SUP_KEY))  || {}; } catch(e) { return {}; } }
  function saveSupply(s)   { localStorage.setItem(SUP_KEY, JSON.stringify(s)); }

  // ── Seed ──────────────────────────────────────────────────────────────────
  function seed() {
    const seeded = parseInt(localStorage.getItem('glp1_seed_v') || '0');
    if (seeded >= SEED_VER) return;
    const existing = loadShots();
    const idMap = {};
    existing.forEach(s => { idMap[s.id] = s; });
    let changed = false;
    SHOT_SEED.forEach(s => {
      if (!idMap[s.id]) {
        existing.push(s);
        changed = true;
      } else if (s.weight != null && idMap[s.id].weight == null) {
        idMap[s.id].weight = s.weight; // backfill weight onto existing imported shot
        changed = true;
      }
    });
    if (changed) {
      existing.sort((a, b) => new Date(a.date) - new Date(b.date));
      saveShots(existing);
    }
    localStorage.setItem('glp1_seed_v', String(SEED_VER));
  }

  // ── PK math ───────────────────────────────────────────────────────────────
  function pkRaw(t) {
    return (Math.exp(-PK.ke * t) - Math.exp(-PK.ka * t)) / (PK.ka - PK.ke);
  }
  function pkPeakT() {
    return Math.log(PK.ka / PK.ke) / (PK.ka - PK.ke);
  }
  function pkNorm(t) {
    const max = pkRaw(pkPeakT());
    return max > 0 ? Math.max(0, pkRaw(t) / max) : 0;
  }

  function getLastShot() {
    const shots = loadShots();
    return shots.length ? shots[shots.length - 1] : null;
  }
  function getElapsedHours(shot) {
    if (!shot) return null;
    return (Date.now() - new Date(shot.date).getTime()) / 3600000;
  }
  function getCurrentPhase(elapsedHours) {
    if (elapsedHours === null) return null;
    const h = ((elapsedHours % 168) + 168) % 168;
    return PHASES.find(p => h >= p.start && h < p.end) || PHASES[PHASES.length - 1];
  }

  // ── Sub-tab switching ─────────────────────────────────────────────────────
  let activeMedTab = 'dashboard';
  const MED_PANELS = ['dashboard', 'phases', 'logshot', 'symptoms', 'supply', 'history'];

  function switchMedTab(name) {
    activeMedTab = name;
    MED_PANELS.forEach(p => {
      const panel = document.getElementById('medpanel-' + p);
      const btn   = document.getElementById('medtab-btn-' + p);
      if (!panel || !btn) return;
      if (p === name) {
        panel.removeAttribute('hidden');
        btn.style.background = ACCENT;
        btn.style.color = '#fff';
      } else {
        panel.setAttribute('hidden', '');
        btn.style.background = 'transparent';
        btn.style.color = '#6d7a95';
      }
    });
    if (name === 'dashboard') renderGlp1Dashboard();
    if (name === 'phases')    renderGlp1Dial();
    if (name === 'logshot')   initLogShotForm();
    if (name === 'symptoms')  renderGlp1Symptoms();
    if (name === 'supply')    renderGlp1Supply();
    if (name === 'history')   renderGlp1History();
  }
  window.switchMedTab = switchMedTab;

  // ── Dashboard ─────────────────────────────────────────────────────────────
  let g1PkChart = null;

  function renderGlp1Dashboard() {
    const shots   = loadShots();
    const last    = shots.length ? shots[shots.length - 1] : null;
    const elapsed = getElapsedHours(last);
    const phase   = getCurrentPhase(elapsed);

    setText('g1-total-shots', shots.length);

    if (phase && elapsed !== null) {
      const h = ((elapsed % 168) + 168) % 168;
      setText('g1-phase', phase.emoji + ' ' + phase.name);
      setText('g1-phase-hours', Math.floor(h - phase.start) + 'h into phase');
    } else {
      setText('g1-phase', 'No shots yet');
      setText('g1-phase-hours', '');
    }

    if (last) {
      const nextMs = new Date(last.date).getTime() + 168 * 3600000;
      const diffH  = (nextMs - Date.now()) / 3600000;
      if (diffH > 0) {
        const d = Math.floor(diffH / 24);
        const h = Math.floor(diffH % 24);
        setText('g1-next-shot', d > 0 ? d + 'd ' + h + 'h' : h + 'h');
        setText('g1-next-hours', 'until next dose');
      } else {
        setText('g1-next-shot', 'Due now');
        setText('g1-next-hours', 'or overdue');
      }
      const doseMatch = last.med.match(/(\d+(?:\.\d+)?)\s*mg/);
      setText('g1-dose', doseMatch ? doseMatch[1] : '—');
    } else {
      setText('g1-next-shot', '—');
      setText('g1-next-hours', '');
      setText('g1-dose', '—');
    }

    drawPkChart(elapsed);
    renderProgressCharts();
  }

  function drawPkChart(elapsed) {
    const canvas = document.getElementById('g1PkChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = [], data = [];
    for (let t = 0; t <= 168; t += 2) {
      labels.push(t % 48 === 0 ? (t === 0 ? 'Shot' : 'Day ' + (t / 24)) : '');
      data.push(+(pkNorm(t) * 100).toFixed(1));
    }

    const nowIdx = elapsed !== null ? Math.min(Math.round(((elapsed % 168) + 168) % 168 / 2), data.length - 1) : null;

    if (g1PkChart) { g1PkChart.destroy(); g1PkChart = null; }

    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 175);
    grad.addColorStop(0, 'rgba(83,74,183,0.32)');
    grad.addColorStop(1, 'rgba(83,74,183,0.02)');

    const annotations = {};
    if (nowIdx !== null) {
      annotations.nowLine = {
        type: 'line', xMin: nowIdx, xMax: nowIdx,
        borderColor: '#e03131', borderWidth: 2, borderDash: [4, 3],
        label: { content: 'Now', display: true, position: 'start', color: '#e03131', font: { size: 9, weight: '700' }, backgroundColor: 'transparent', padding: 2 }
      };
    }

    g1PkChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{ data, borderColor: ACCENT, backgroundColor: grad, borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ctx.parsed.y.toFixed(0) + '% concentration' } },
          annotation: Object.keys(annotations).length ? { annotations } : undefined,
        },
        scales: {
          x: { ticks: { font: { size: 9 }, maxRotation: 0, color: '#9aa5b4', autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
          y: { min: 0, max: 108, ticks: { font: { size: 9 }, color: '#9aa5b4', callback: v => v + '%' }, grid: { color: '#f0f1f5' } }
        }
      }
    });
  }

  // ── Progress charts ───────────────────────────────────────────────────────
  let g1WeightTrendChart = null;
  let g1WeightChangeChart = null;

  function buildProgressPoints() {
    const shots = loadShots();
    const pts   = [];
    shots.forEach((s, idx) => {
      if (s.weight == null) return;
      const prev = pts.length ? pts[pts.length - 1] : null;
      const change = prev ? +(prev.weight - s.weight).toFixed(1) : null; // positive = lost weight
      pts.push({
        label: 'Shot ' + (idx + 1),
        shortLabel: '#' + (idx + 1),
        date: s.date.slice(0, 10),
        weight: s.weight,
        change,
      });
    });
    return pts;
  }

  function renderProgressCharts() {
    const pts = buildProgressPoints();
    if (pts.length < 2) return;

    const labels      = pts.map(p => p.shortLabel);
    const weights     = pts.map(p => p.weight);
    const changes     = pts.slice(1).map(p => p.change); // first has no change
    const changeLabels = pts.slice(1).map(p => p.shortLabel);
    const changeColors = changes.map(c => c >= 0 ? '#2f9e44' : '#e03131');

    // ── Weight trend line chart ───────────────────────────────────────────
    const trendCanvas = document.getElementById('g1WeightTrendChart');
    if (trendCanvas && typeof Chart !== 'undefined') {
      if (g1WeightTrendChart) { g1WeightTrendChart.destroy(); g1WeightTrendChart = null; }
      const tctx  = trendCanvas.getContext('2d');
      const tgrad = tctx.createLinearGradient(0, 0, 0, 150);
      tgrad.addColorStop(0, 'rgba(83,74,183,0.25)');
      tgrad.addColorStop(1, 'rgba(83,74,183,0.02)');
      g1WeightTrendChart = new Chart(trendCanvas, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            data: weights,
            borderColor: ACCENT,
            backgroundColor: tgrad,
            borderWidth: 2.5,
            pointBackgroundColor: ACCENT,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.3,
            fill: true,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: ctx => pts[ctx[0].dataIndex].label + ' · ' + pts[ctx[0].dataIndex].date,
                label: ctx => ctx.parsed.y.toFixed(1) + ' lbs',
              }
            }
          },
          scales: {
            x: { ticks: { font: { size: 9 }, color: '#9aa5b4' }, grid: { display: false } },
            y: {
              ticks: { font: { size: 9 }, color: '#9aa5b4', callback: v => v + ' lbs' },
              grid: { color: '#f0f1f5' },
              suggestedMin: Math.min(...weights) - 3,
              suggestedMax: Math.max(...weights) + 3,
            }
          }
        }
      });
    }

    // ── Weekly change bar chart ───────────────────────────────────────────
    const changeCanvas = document.getElementById('g1WeightChangeChart');
    if (changeCanvas && typeof Chart !== 'undefined') {
      if (g1WeightChangeChart) { g1WeightChangeChart.destroy(); g1WeightChangeChart = null; }
      g1WeightChangeChart = new Chart(changeCanvas, {
        type: 'bar',
        data: {
          labels: changeLabels,
          datasets: [{
            data: changes,
            backgroundColor: changeColors,
            borderRadius: 5,
            borderSkipped: false,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: ctx => pts[ctx[0].dataIndex + 1].label + ' · ' + pts[ctx[0].dataIndex + 1].date,
                label: ctx => {
                  const v = ctx.parsed.y;
                  return v >= 0 ? '−' + v.toFixed(1) + ' lbs lost' : '+' + Math.abs(v).toFixed(1) + ' lbs gained';
                }
              }
            }
          },
          scales: {
            x: { ticks: { font: { size: 9 }, color: '#9aa5b4' }, grid: { display: false } },
            y: {
              ticks: { font: { size: 9 }, color: '#9aa5b4', callback: v => (v >= 0 ? '−' : '+') + Math.abs(v) + ' lbs' },
              grid: { color: '#f0f1f5' },
            }
          }
        }
      });
    }
  }

  // ── Phases dial ───────────────────────────────────────────────────────────
  function renderGlp1Dial() {
    const svgEl = document.getElementById('g1-dial');
    if (!svgEl) return;

    const last    = getLastShot();
    const elapsed = getElapsedHours(last);
    const h       = elapsed !== null ? ((elapsed % 168) + 168) % 168 : null;

    const CX = 100, CY = 100, R = 80, SW = 18;
    const C  = 2 * Math.PI * R; // ≈ 502.655

    let m = '';

    // Background ring
    m += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#edeef2" stroke-width="${SW}"/>`;

    // Phase arcs (each is a dashed circle segment rotated to start at top)
    PHASES.forEach(p => {
      const len = ((p.end - p.start) / 168) * C;
      const off = -((p.start / 168) * C);
      m += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${p.color}" stroke-width="${SW}" stroke-dasharray="${len.toFixed(3)} ${C.toFixed(3)}" stroke-dashoffset="${off.toFixed(3)}" transform="rotate(-90 ${CX} ${CY})" stroke-linecap="butt"/>`;
    });

    // Center: emoji + phase name
    const activePhase = h !== null ? getCurrentPhase(h) : null;
    const centerEmoji = activePhase ? activePhase.emoji : '💊';
    const centerName  = activePhase ? activePhase.name  : 'No shots';
    m += `<text x="${CX}" y="${CY - 5}" text-anchor="middle" font-size="22" font-family="system-ui,sans-serif">${centerEmoji}</text>`;
    m += `<text x="${CX}" y="${CY + 13}" text-anchor="middle" font-size="8.5" font-family="system-ui,sans-serif" font-weight="700" fill="#374151">${centerName}</text>`;

    // Current position dot
    if (h !== null) {
      const ang  = (h / 168) * 2 * Math.PI - Math.PI / 2;
      const dotX = CX + R * Math.cos(ang);
      const dotY = CY + R * Math.sin(ang);
      m += `<circle cx="${dotX.toFixed(2)}" cy="${dotY.toFixed(2)}" r="7" fill="#fff" stroke="#e03131" stroke-width="3"/>`;
    }

    // Emoji labels around the outside
    PHASES.forEach(p => {
      const midH  = (p.start + p.end) / 2;
      const ang   = (midH / 168) * 2 * Math.PI - Math.PI / 2;
      const LR    = R + 24;
      const lx    = CX + LR * Math.cos(ang);
      const ly    = CY + LR * Math.sin(ang);
      m += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="13" font-family="system-ui,sans-serif">${p.emoji}</text>`;
    });

    svgEl.innerHTML = m;

    // Countdown label
    const cntEl = document.getElementById('g1-dial-countdown');
    if (cntEl && last) {
      const diffH = (new Date(last.date).getTime() + 168 * 3600000 - Date.now()) / 3600000;
      if (diffH > 0) {
        const d = Math.floor(diffH / 24), hh = Math.floor(diffH % 24);
        cntEl.textContent = 'Next shot in ' + (d > 0 ? d + 'd ' : '') + hh + 'h';
        cntEl.style.color = '#374151';
      } else {
        cntEl.textContent = 'Shot due now!';
        cntEl.style.color = '#e03131';
      }
    } else if (cntEl) {
      cntEl.textContent = 'No shots logged yet';
    }

    // Phase info cards
    const cardsEl = document.getElementById('g1-phase-cards');
    if (!cardsEl) return;
    cardsEl.innerHTML = PHASES.map(p => {
      const isNow = activePhase && activePhase.name === p.name;
      return `<div style="border-left:4px solid ${p.color};padding:0.75rem 1rem;background:${isNow ? '#f8f7ff' : '#f9fafb'};border-radius:0 8px 8px 0;${isNow ? 'box-shadow:0 1px 6px rgba(83,74,183,0.12)' : ''}">
  <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.35rem;flex-wrap:wrap">
    <span style="font-size:1.1rem">${p.emoji}</span>
    <span style="font-weight:800;font-size:0.85rem;color:${p.color}">${p.name}</span>
    <span style="font-size:0.7rem;color:#9aa5b4;margin-left:auto">Hour ${p.start}–${p.end}</span>
    ${isNow ? `<span style="font-size:0.65rem;font-weight:800;background:${p.color};color:#fff;border-radius:20px;padding:0.1rem 0.5rem;margin-left:0.25rem">NOW</span>` : ''}
  </div>
  <div style="font-size:0.75rem;color:#374151;line-height:1.45;margin-bottom:0.2rem"><strong>What's happening:</strong> ${p.what}</div>
  <div style="font-size:0.75rem;color:#6d7a95;line-height:1.45;margin-bottom:0.2rem"><strong>Side effects:</strong> ${p.side}</div>
  <div style="font-size:0.75rem;color:#6d7a95;line-height:1.45"><strong>Pay attention to:</strong> ${p.watch}</div>
</div>`;
    }).join('');
  }

  // ── Log Shot form ─────────────────────────────────────────────────────────
  function initLogShotForm() {
    const dtEl = document.getElementById('g1-shot-dt');
    if (!dtEl || dtEl.value) return;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    dtEl.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T17:30`;

    // Auto-rotate injection site
    const shots = loadShots();
    const sites = ['Abdomen Lower Left', 'Lower Mid'];
    if (shots.length) {
      const last    = shots[shots.length - 1];
      const lastIdx = sites.indexOf(last.site);
      const next    = sites[(lastIdx + 1) % sites.length];
      const siteEl  = document.getElementById('g1-shot-site');
      if (siteEl) {
        for (const opt of siteEl.options) {
          if (opt.value === next) { opt.selected = true; break; }
        }
      }
    }

    // Auto-prefill weight from most recent scale reading (today or yesterday)
    const weightEl   = document.getElementById('g1-shot-weight');
    const weightNote = document.getElementById('g1-shot-weight-note');
    if (weightEl && !weightEl.value && window.allWeightData && window.allWeightData.length) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 1);
      cutoff.setHours(0, 0, 0, 0);

      const recent = window.allWeightData
        .filter(r => new Date(r.date) >= cutoff)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      if (recent.length) {
        const reading = recent[0];
        weightEl.value = reading.weight;
        weightEl.style.borderColor = '#534ab7';
        if (weightNote) {
          const readingTime = new Date(reading.date).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
          const readingDay  = new Date(reading.date) < new Date(new Date().setHours(0,0,0,0)) ? 'yesterday' : 'today';
          weightNote.textContent = 'Auto-filled from scale (' + readingDay + ' at ' + readingTime + ')';
          weightNote.style.display = 'block';
        }
      }
    }
  }

  function saveGlp1Shot() {
    const med   = document.getElementById('g1-shot-med')?.value || '';
    const dt    = document.getElementById('g1-shot-dt')?.value  || '';
    const site  = document.getElementById('g1-shot-site')?.value || '';
    const wt    = parseFloat(document.getElementById('g1-shot-weight')?.value) || null;
    const noise = document.getElementById('g1-shot-noise')?.value || 'none';
    const notes = (document.getElementById('g1-shot-notes')?.value || '').trim();

    if (!dt) { alert('Please enter the date and time.'); return; }

    const doseM = med.match(/(\d+(?:\.\d+)?)\s*mg/);
    const shot  = {
      id: 'u' + Date.now(),
      date: dt, med, dose: doseM ? parseFloat(doseM[1]) : null,
      site, weight: wt, foodNoise: noise, notes,
    };

    const shots = loadShots();
    shots.push(shot);
    shots.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveShots(shots);

    const dtEl2      = document.getElementById('g1-shot-dt');
    const notesEl   = document.getElementById('g1-shot-notes');
    const weightEl  = document.getElementById('g1-shot-weight');
    const weightNote = document.getElementById('g1-shot-weight-note');
    if (dtEl2)     { dtEl2.value = ''; }
    if (notesEl)   { notesEl.value = ''; }
    if (weightEl)  { weightEl.value = ''; weightEl.style.borderColor = ''; }
    if (weightNote){ weightNote.style.display = 'none'; weightNote.textContent = ''; }

    switchMedTab('dashboard');
  }
  window.saveGlp1Shot = saveGlp1Shot;

  // ── Symptoms ──────────────────────────────────────────────────────────────
  let selectedSymptoms = new Set();

  function renderGlp1Symptoms() {
    const grid = document.getElementById('g1-symptom-grid');
    if (!grid) return;

    grid.innerHTML = SYMPTOMS.map(s => {
      const active = selectedSymptoms.has(s);
      const safeId = 'sym-' + s.replace(/\s+/g, '-');
      return `<button id="${safeId}" onclick="toggleSymptom('${s}')"
        style="border:1.5px solid ${active ? ACCENT : '#d1d5db'};background:${active ? ACCENT : '#f9fafb'};color:${active ? '#fff' : '#374151'};border-radius:20px;padding:0.3rem 0.75rem;font-size:0.75rem;font-weight:600;cursor:pointer;transition:all 0.15s">${s}</button>`;
    }).join('');

    const histEl = document.getElementById('g1-symptom-history');
    if (!histEl) return;
    const history = loadSymptoms().slice(-5).reverse();
    histEl.innerHTML = history.length
      ? '<p style="font-size:0.72rem;font-weight:700;color:#6d7a95;margin-bottom:0.4rem;margin-top:1rem">RECENT LOGS</p>' +
        history.map(e =>
          `<div style="font-size:0.75rem;color:#374151;padding:0.35rem 0;border-bottom:1px solid #f0f1f5">
            <span style="color:#9aa5b4;margin-right:0.5rem">${e.date}</span>${e.symptoms.length ? e.symptoms.join(', ') : 'No symptoms logged'}
          </div>`
        ).join('')
      : '';
  }

  function toggleSymptom(name) {
    if (selectedSymptoms.has(name)) selectedSymptoms.delete(name);
    else selectedSymptoms.add(name);
    renderGlp1Symptoms();
  }
  window.toggleSymptom = toggleSymptom;

  function saveGlp1Symptoms() {
    const today   = new Date().toISOString().slice(0, 10);
    const history = loadSymptoms();
    const idx     = history.findIndex(e => e.date === today);
    const entry   = { date: today, symptoms: [...selectedSymptoms] };
    if (idx >= 0) history[idx] = entry;
    else history.push(entry);
    saveSymptoms(history);
    selectedSymptoms.clear();
    renderGlp1Symptoms();
  }
  window.saveGlp1Symptoms = saveGlp1Symptoms;

  // ── Supply ────────────────────────────────────────────────────────────────
  function renderGlp1Supply() {
    const sup   = loadSupply();
    const pens  = parseInt(sup.pens || 0);
    const dpn   = parseInt(sup.dosesPerPen || 4);
    const doses = pens * dpn;

    setText('g1-sup-pens',  pens);
    setText('g1-sup-doses', doses);
    setText('g1-sup-weeks', doses);

    if (sup.expiry) {
      const exp   = new Date(sup.expiry);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const diff  = Math.round((exp - today) / 86400000);
      setText('g1-sup-exp',  exp.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }));
      const daysEl = document.getElementById('g1-sup-days');
      if (daysEl) {
        daysEl.textContent = diff >= 0 ? diff + ' days left' : 'EXPIRED';
        daysEl.style.color = diff < 14 ? '#e03131' : '#6d7a95';
      }
    } else {
      setText('g1-sup-exp',  '—');
      setText('g1-sup-days', 'No expiry set');
    }

    const maxPens = 12;
    const pct = Math.min(100, Math.round((pens / maxPens) * 100));
    setText('g1-sup-pct', pct + '%');
    const bar = document.getElementById('g1-sup-bar');
    if (bar) bar.style.width = pct + '%';

    const pIn = document.getElementById('g1-sup-input-pens');
    const dIn = document.getElementById('g1-sup-input-dpn');
    const eIn = document.getElementById('g1-sup-input-exp');
    if (pIn) pIn.value = pens;
    if (dIn) dIn.value = dpn;
    if (eIn) eIn.value = sup.expiry || '';
  }

  function saveGlp1Supply() {
    const pens = parseInt(document.getElementById('g1-sup-input-pens')?.value) || 0;
    const dpn  = parseInt(document.getElementById('g1-sup-input-dpn')?.value)  || 4;
    const exp  = document.getElementById('g1-sup-input-exp')?.value || '';
    saveSupply({ pens, dosesPerPen: dpn, expiry: exp });
    renderGlp1Supply();
  }
  window.saveGlp1Supply = saveGlp1Supply;

  // ── History ───────────────────────────────────────────────────────────────
  function renderGlp1History() {
    const tbody = document.getElementById('g1-history-body');
    if (!tbody) return;
    const shots = loadShots().slice().reverse();
    if (!shots.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:#6d7a95">No shots logged yet</td></tr>';
      return;
    }
    tbody.innerHTML = shots.map(s => {
      const dt      = new Date(s.date);
      const dateStr = dt.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
                    + ' ' + dt.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
      const importBadge = s.imported
        ? ' <span style="font-size:0.6rem;background:#f0eeff;color:#534ab7;border-radius:4px;padding:0.1rem 0.35rem;font-weight:700">imported</span>'
        : '';
      const delBtn = !s.imported
        ? `<button onclick="deleteGlp1Shot('${s.id}')" style="background:none;border:none;color:#e03131;cursor:pointer;font-size:0.8rem;font-weight:700;padding:0 0.25rem" title="Delete">✕</button>`
        : '';
      return `<tr style="border-bottom:1px solid #f0f1f5">
  <td style="padding:0.5rem 0.75rem;white-space:nowrap;font-size:0.78rem">${dateStr}</td>
  <td style="padding:0.5rem 0.75rem;font-size:0.78rem">${s.med || '—'}${importBadge}</td>
  <td style="padding:0.5rem 0.75rem;font-size:0.78rem;white-space:nowrap">${s.site || '—'}</td>
  <td style="padding:0.5rem 0.75rem;font-size:0.78rem">${s.weight ? s.weight + ' lbs' : '—'}</td>
  <td style="padding:0.5rem 0.75rem;font-size:0.78rem;text-transform:capitalize">${s.foodNoise || '—'}</td>
  <td style="padding:0.5rem 0.75rem;font-size:0.78rem">${s.notes || '—'}</td>
  <td style="padding:0.5rem 0.25rem;text-align:center">${delBtn}</td>
</tr>`;
    }).join('');
  }

  function deleteGlp1Shot(id) {
    if (!confirm('Delete this shot?')) return;
    saveShots(loadShots().filter(s => s.id !== id));
    renderGlp1History();
  }
  window.deleteGlp1Shot = deleteGlp1Shot;

  function exportGlp1CSV() {
    const shots = loadShots();
    const rows  = [['Date', 'Medication', 'Dose (mg)', 'Site', 'Weight (lbs)', 'Food Noise', 'Notes', 'Imported']];
    shots.forEach(s => rows.push([s.date, s.med||'', s.dose||'', s.site||'', s.weight||'', s.foodNoise||'', s.notes||'', s.imported ? 'yes' : 'no']));
    const csv  = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'glp1-shots.csv';
    a.click();
  }
  window.exportGlp1CSV = exportGlp1CSV;

  // ── Utility ───────────────────────────────────────────────────────────────
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function initGlp1() {
    seed();
    switchMedTab('dashboard');
    if (!window._glp1Interval) {
      window._glp1Interval = setInterval(() => {
        if (activeMedTab === 'dashboard') renderGlp1Dashboard();
        if (activeMedTab === 'phases')    renderGlp1Dial();
      }, 60000);
    }
  }

  // Preserved name for app-tabs.js compatibility
  function initMedication() { initGlp1(); }
  window.initMedication = initMedication;
  window.initGlp1       = initGlp1;
})();
