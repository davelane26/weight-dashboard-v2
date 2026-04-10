// ── activity.js ─────────────────────────────────────────────────
// Loads Garmin activity data from Firebase (synced via bookmarklet)
// ────────────────────────────────────────────────────────────────

const FIREBASE_GARMIN_URL = 'https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com';

async function loadActivityData() {
  try {
    const res = await fetch(`${FIREBASE_GARMIN_URL}/garmin/latest.json`);
    const data = await res.json();
    if (!data) return;

    // ── Update hero section ──
    const stepsEl = document.getElementById('act-steps');
    if (stepsEl) stepsEl.textContent = (data.steps || 0).toLocaleString();

    const calEl = document.getElementById('act-cal');
    if (calEl) calEl.textContent = (data.activeCalories || 0).toLocaleString();

    // ── Update KPI cards ──
    const sleepEl = document.getElementById('act-sleep');
    if (sleepEl) sleepEl.textContent = data.sleepDuration || data.sleepHours || '—';

    const sleepScoreEl = document.getElementById('act-sleep-score');
    if (sleepScoreEl && data.sleepScore) sleepScoreEl.textContent = 'Score: ' + data.sleepScore;

    const hrEl = document.getElementById('act-hr');
    if (hrEl) hrEl.textContent = data.restingHR || '—';

    const floorsEl = document.getElementById('act-floors');
    if (floorsEl) floorsEl.textContent = data.floorsClimbed || '—';

    const stressEl = document.getElementById('act-stress');
    if (stressEl) stressEl.textContent = data.stressLevel || '—';

    const intensityEl = document.getElementById('act-intensity');
    if (intensityEl) intensityEl.textContent = data.intensityMinutes || '—';

    // ── Hide "Waiting for Tasker" message ──
    const setupEl = document.getElementById('act-setup');
    if (setupEl) setupEl.style.display = 'none';

    // ── Show last updated time ──
    const updatedEl = document.getElementById('act-updated');
    if (updatedEl && data.lastUpdated) {
      const d = new Date(data.lastUpdated);
      updatedEl.textContent = 'Garmin data synced ' + d.toLocaleString();
    }

    // ── Load 7-day history for charts ──
    loadActivityCharts();

  } catch (err) {
    console.error('Error loading activity data:', err);
  }
}

async function loadActivityCharts() {
  try {
    const days = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      days.push(dateStr);
    }

    const history = [];
    for (const day of days) {
      try {
        const res = await fetch(`${FIREBASE_GARMIN_URL}/garmin/${day}.json`);
        const data = await res.json();
        history.push({ date: day, ...(data || {}) });
      } catch (e) {
        history.push({ date: day });
      }
    }

    const labels = history.map(h => {
      const d = new Date(h.date + 'T12:00:00');
      return d.toLocaleDateString('en-US', { weekday: 'short' });
    });

    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }
      }
    };

    // Steps chart
    const stepsCanvas = document.getElementById('actStepsChart');
    if (stepsCanvas) {
      const ctx = stepsCanvas.getContext('2d');
      if (window._actStepsChart) window._actStepsChart.destroy();
      window._actStepsChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            data: history.map(h => h.steps || 0),
            backgroundColor: 'rgba(42, 135, 3, 0.6)',
            borderColor: '#2a8703',
            borderWidth: 1,
            borderRadius: 4
          }]
        },
        options: chartOptions
      });
    }

    // Sleep chart
    const sleepCanvas = document.getElementById('actSleepChart');
    if (sleepCanvas) {
      const ctx = sleepCanvas.getContext('2d');
      if (window._actSleepChart) window._actSleepChart.destroy();
      window._actSleepChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            data: history.map(h => {
              if (h.sleepHours) return h.sleepHours;
              if (h.sleepDuration) {
                const m = h.sleepDuration.match(/(\d+)h\s*(\d+)m/);
                if (m) return parseInt(m[1]) + parseInt(m[2]) / 60;
                const hOnly = h.sleepDuration.match(/(\d+)h/);
                if (hOnly) return parseInt(hOnly[1]);
              }
              return 0;
            }),
            backgroundColor: 'rgba(8, 145, 178, 0.6)',
            borderColor: '#0891b2',
            borderWidth: 1,
            borderRadius: 4
          }]
        },
        options: chartOptions
      });
    }

    // Heart rate chart
    const hrCanvas = document.getElementById('actHRChart');
    if (hrCanvas) {
      const ctx = hrCanvas.getContext('2d');
      if (window._actHRChart) window._actHRChart.destroy();
      window._actHRChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            data: history.map(h => h.restingHR || null),
            borderColor: '#ea1100',
            backgroundColor: 'rgba(234, 17, 0, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: '#ea1100',
            spanGaps: true
          }]
        },
        options: {
          ...chartOptions,
          scales: {
            ...chartOptions.scales,
            y: { ...chartOptions.scales.y, beginAtZero: false }
          }
        }
      });
    }

  } catch (err) {
    console.error('Error loading activity charts:', err);
  }
}

// Load on page start
loadActivityData();

// Refresh every 30 seconds
setInterval(loadActivityData, 30000);
