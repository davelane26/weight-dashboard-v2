/**
 * healthcard.js — Export a health summary card as a PNG download.
 * Pure Canvas API — no external libraries.
 * Call window.exportHealthCard() from any button.
 */

const HC_W = 640, HC_H = 340;

function _hcCtx() {
  const canvas  = document.createElement('canvas');
  canvas.width  = HC_W * 2; // Retina 2x
  canvas.height = HC_H * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  return { canvas, ctx };
}

function _hcFill(ctx, x, y, w, h, r, color) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function _hcText(ctx, text, x, y, size, weight, color, align = 'left') {
  ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

function _hcStat(ctx, x, y, label, value, color) {
  _hcText(ctx, label, x, y,      9,  '600', '#6d7a95');
  _hcText(ctx, value, x, y + 18, 20, '900', color);
}

async function exportHealthCard() {
  const btn = document.getElementById('export-card-btn');
  if (btn) { btn.textContent = '⏳ Generating…'; btn.disabled = true; }

  try {
    const { canvas, ctx } = _hcCtx();

    // ── Background ────────────────────────────────────────────────────────
    _hcFill(ctx, 0, 0, HC_W, HC_H, 16, '#ffffff');

    // ── Header gradient bar ───────────────────────────────────────────────
    const hdrGrad = ctx.createLinearGradient(0, 0, HC_W, 0);
    hdrGrad.addColorStop(0,   '#0053e2');
    hdrGrad.addColorStop(0.6, '#0073ff');
    hdrGrad.addColorStop(1,   '#7c3aed');
    _hcFill(ctx, 0, 0, HC_W, 72, 16, '#0053e2'); // base
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, HC_W, 72);
    ctx.clip();
    ctx.fillStyle = hdrGrad;
    ctx.fillRect(0, 0, HC_W, 72);
    ctx.restore();
    // Round only top corners — cover bottom corners with a rect
    ctx.fillStyle = '#0053e2';
    ctx.fillRect(0, 56, HC_W, 16);

    // Header text
    _hcText(ctx, "David's Health Board", 24, 30, 18, '800', '#ffffff');
    _hcText(ctx, '⚖️ · 🩸 · 🏃 · 💊', 24, 54, 11, '600', 'rgba(255,255,255,0.7)');

    const today = new Date().toLocaleDateString('en-US',
      { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    _hcText(ctx, today, HC_W - 24, 38, 11, '600', 'rgba(255,255,255,0.85)', 'right');

    // ── Health score ring ─────────────────────────────────────────────────
    const score    = typeof calcHealthScore === 'function' ? calcHealthScore() : null;
    const GRADE_BANDS = [
      { min: 90, grade: 'A+', color: '#2a8703' },
      { min: 80, grade: 'A',  color: '#2a8703' },
      { min: 70, grade: 'B',  color: '#0053e2' },
      { min: 60, grade: 'C',  color: '#995213' },
      { min: 45, grade: 'D',  color: '#ea1100' },
      { min: 0,  grade: 'F',  color: '#7f1d1d' },
    ];
    const gradeInfo = score != null
      ? (GRADE_BANDS.find(b => score >= b.min) || GRADE_BANDS[GRADE_BANDS.length - 1])
      : { grade: '—', color: '#6d7a95' };

    const cx = 80, cy = 170, R = 42;
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    if (score != null) {
      ctx.strokeStyle = gradeInfo.color;
      ctx.beginPath();
      ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + (score / 100) * Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    _hcText(ctx, score != null ? String(score) : '—', cx, cy - 4,  22, '900', gradeInfo.color, 'center');
    _hcText(ctx, 'TODAY', cx, cy + 12, 8, '700', '#6d7a95', 'center');

    // ── Stats grid ────────────────────────────────────────────────────────
    const stats = _gatherStats();
    const COL   = 148;
    const ROW1  = 104, ROW2 = 200;

    _hcStat(ctx, 152, ROW1, 'Current Weight',  stats.weight,   '#0053e2');
    _hcStat(ctx, 152 + COL, ROW1, 'Total Lost', stats.lost,    '#2a8703');
    _hcStat(ctx, 152 + COL * 2, ROW1, 'BMI',    stats.bmi,     '#7c3aed');
    _hcStat(ctx, 152 + COL * 3, ROW1, 'On Journey', stats.days, '#995213');

    _hcStat(ctx, 152, ROW2, 'Steps Today',      stats.steps,   '#0053e2');
    _hcStat(ctx, 152 + COL, ROW2, 'Glucose',    stats.glucose, '#2a8703');
    _hcStat(ctx, 152 + COL * 2, ROW2, 'Sleep',  stats.sleep,   '#7c3aed');
    _hcStat(ctx, 152 + COL * 3, ROW2, 'Streak', stats.streak,  '#995213');

    // ── Divider lines ─────────────────────────────────────────────────────
    ctx.strokeStyle = '#f3f4f6';
    ctx.lineWidth   = 1;
    [152, 152 + COL, 152 + COL * 2, 152 + COL * 3].forEach(x => {
      if (x > 152) { ctx.beginPath(); ctx.moveTo(x - 12, 88); ctx.lineTo(x - 12, 240); ctx.stroke(); }
    });
    ctx.beginPath(); ctx.moveTo(148, 168); ctx.lineTo(HC_W - 24, 168); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(24, 168);  ctx.lineTo(136, 168);         ctx.stroke();

    // ── Journey progress bar ──────────────────────────────────────────────
    const lostN    = parseFloat(stats.lost) || 0;
    const startW   = typeof START_WEIGHT !== 'undefined' ? START_WEIGHT : 315;
    const goalW    = 200;
    const pct      = Math.min(1, lostN / (startW - goalW));
    const barY     = 256, barH = 10, barX = 24, barW2 = HC_W - 48;
    _hcFill(ctx, barX, barY, barW2, barH, 5, '#e5e7eb');
    if (pct > 0) {
      const grad = ctx.createLinearGradient(barX, 0, barX + barW2, 0);
      grad.addColorStop(0, '#ea1100');
      grad.addColorStop(0.5, '#ffc220');
      grad.addColorStop(1,   '#2a8703');
      _hcFill(ctx, barX, barY, barW2 * pct, barH, 5, '#ea1100');
      ctx.save();
      ctx.beginPath();
      ctx.rect(barX, barY, barW2 * pct, barH);
      ctx.clip();
      ctx.fillStyle = grad;
      ctx.fillRect(barX, barY, barW2, barH);
      ctx.restore();
    }
    _hcText(ctx, `${startW} lbs`, barX,       barY + 22, 9, '600', '#6d7a95');
    _hcText(ctx, `Goal: ${goalW} lbs`, barX + barW2, barY + 22, 9, '600', '#6d7a95', 'right');

    // ── Footer ────────────────────────────────────────────────────────────
    _hcText(ctx, 'Built by Code Puppy 🐶  ·  davelane26.github.io/weight-dashboard-v2',
      HC_W / 2, HC_H - 10, 8, '400', '#9ca3af', 'center');

    // ── Download ──────────────────────────────────────────────────────────
    const link    = document.createElement('a');
    const dateStr = new Date().toLocaleDateString('en-CA');
    link.download = `health-card-${dateStr}.png`;
    link.href     = canvas.toDataURL('image/png');
    link.click();
  } finally {
    if (btn) { btn.textContent = '🃏 Export Health Card'; btn.disabled = false; }
  }
}

function _gatherStats() {
  const wData  = window.allWeightData || [];
  const latest = wData.length ? wData[wData.length - 1] : null;
  const act    = window.snapActivityNow || {};

  const startW = typeof START_WEIGHT !== 'undefined' ? START_WEIGHT : 315;
  const weight = latest ? latest.weight.toFixed(1) + ' lbs' : '—';
  const lost   = latest ? (startW - latest.weight).toFixed(1) + ' lbs' : '—';
  const bmi    = latest?.bmi ? latest.bmi.toFixed(1) : '—';
  const startD = typeof START_DATE !== 'undefined' ? new Date(START_DATE) : new Date('2026-01-23');
  const dayN   = Math.floor((Date.now() - startD) / 86400000);
  const days   = `Day ${dayN}`;

  const steps  = act.steps ? act.steps.toLocaleString() : '—';
  const g      = window.snapGlucoseNow;
  const glucose = g != null ? g + ' mg/dL' : '—';
  const sleep  = act.sleepScore != null ? act.sleepScore + ' pts'
               : act.sleepHours ? act.sleepHours.toFixed(1) + 'h' : '—';

  // Streak from weight data
  const dates  = [...new Set(wData.map(r => r.date.toDateString()))].sort((a, b) => new Date(b) - new Date(a));
  let streak   = 0;
  for (let i = 0; i < dates.length; i++) {
    if (i === 0) { streak = 1; continue; }
    const diff = (new Date(dates[i - 1]) - new Date(dates[i])) / 86400000;
    if (diff === 1) streak++; else break;
  }
  return { weight, lost, bmi, days, steps, glucose, sleep, streak: streak + ' days' };
}

window.exportHealthCard = exportHealthCard;
