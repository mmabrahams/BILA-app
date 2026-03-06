// ── Stage Configuration ──
const STAGE_START_ISO = 7; // Stage week 1 = ISO week 7 (9 feb 2026)
const STAGE_YEAR = 2026;
const STAGE_WEEKS_TOTAL = 20;
const PHASES = [
  {
    id: 1, name: 'Vraagstuk & Aanpak', weeks: [1, 4],
    portfolio: new Date(2026, 2, 12, 23, 59, 0), // 12 maart 2026
    portfolioLabel: '12 maart 2026',
    assessment: 'Week van 16 maart 2026'
  },
  {
    id: 2, name: 'Onderzoek & Analyse', weeks: [5, 12],
    portfolio: new Date(2026, 4, 14, 23, 59, 0), // 14 mei 2026
    portfolioLabel: '14 mei 2026',
    assessment: 'Week van 18 mei 2026'
  },
  {
    id: 3, name: 'Validatie & Waardecreatie', weeks: [13, 20],
    portfolio: new Date(2026, 5, 25, 23, 59, 0), // 25 juni 2026
    portfolioLabel: '25 juni 2026',
    assessment: 'Week van 29 juni 2026'
  }
];

// ── State ──
let currentWeekOffset = 0;
let currentTab = detectInitialTab();
let weekData = null;
let stageData = { completedWeeks: [] };
let clientId = null;
let saveTimeout = null;
let eventSource = null;
let countdownInterval = null;

// ── Week helpers ──
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function getISOWeekYear(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}

function getWeekId(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset * 7);
  const week = getISOWeek(d);
  const year = getISOWeekYear(d);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function getCurrentWeekId() {
  return getWeekId(currentWeekOffset);
}

function getWeekMonday(weekId) {
  const [yearStr, weekStr] = weekId.split('-W');
  const year = parseInt(yearStr);
  const weekNum = parseInt(weekStr);
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
  return monday;
}

function getWeekDateRange(weekId) {
  const monday = getWeekMonday(weekId);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const months = [
    'januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december'
  ];
  const monDay = monday.getDate();
  const friDay = friday.getDate();
  const monMonth = months[monday.getMonth()];
  const friMonth = months[friday.getMonth()];
  if (monday.getMonth() === friday.getMonth()) {
    return `${monDay}–${friDay} ${friMonth} ${friday.getFullYear()}`;
  }
  return `${monDay} ${monMonth} – ${friDay} ${friMonth} ${friday.getFullYear()}`;
}

function getWeekDateRangeShort(weekId) {
  const monday = getWeekMonday(weekId);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const monthsShort = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return `${monday.getDate()}–${friday.getDate()} ${monthsShort[monday.getMonth()]}`;
}

function detectInitialTab() {
  const day = new Date().getDay();
  return (day >= 4) ? 'einde' : 'begin';
}

// ── Stage helpers ──
function stageWeekToISOWeekId(stageWeek) {
  const isoWeek = stageWeek + STAGE_START_ISO - 1;
  return `${STAGE_YEAR}-W${String(isoWeek).padStart(2, '0')}`;
}

function isoWeekIdToStageWeek(weekId) {
  const [, weekStr] = weekId.split('-W');
  const isoWeek = parseInt(weekStr);
  return isoWeek - STAGE_START_ISO + 1;
}

function getCurrentStageWeek() {
  const now = new Date();
  const isoWeek = getISOWeek(now);
  const isoYear = getISOWeekYear(now);
  if (isoYear !== STAGE_YEAR) return -1;
  const stageWeek = isoWeek - STAGE_START_ISO + 1;
  if (stageWeek < 1 || stageWeek > STAGE_WEEKS_TOTAL) return -1;
  return stageWeek;
}

function getCurrentPhase() {
  const sw = getCurrentStageWeek();
  if (sw < 1) return PHASES[0]; // default to phase 1 before start
  for (const phase of PHASES) {
    if (sw >= phase.weeks[0] && sw <= phase.weeks[1]) return phase;
  }
  return PHASES[PHASES.length - 1]; // after end, show last phase
}

function getPhaseForStageWeek(stageWeek) {
  for (const phase of PHASES) {
    if (stageWeek >= phase.weeks[0] && stageWeek <= phase.weeks[1]) return phase;
  }
  return null;
}

function formatCountdown(targetDate) {
  const now = new Date();
  const diff = targetDate - now;
  if (diff <= 0) return { text: 'Deadline verstreken', urgent: 'expired' };

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  let urgency = 'normal';
  if (days < 2) urgency = 'critical';
  else if (days < 7) urgency = 'warning';

  let text = '';
  if (days > 0) text += `${days}d `;
  text += `${hours}u ${minutes}m`;

  return { text: text.trim(), urgent: urgency };
}

// ── API base URL ──
// Use local server if running locally, otherwise Render
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? ''
  : 'https://bila-app.onrender.com';

// ── localStorage helpers ──
let serverAvailable = false;

function lsKey(type, id) {
  return `bila_${type}${id ? '_' + id : ''}`;
}

function lsLoad(type, id) {
  try {
    const raw = localStorage.getItem(lsKey(type, id));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function lsSave(type, id, data) {
  try {
    localStorage.setItem(lsKey(type, id), JSON.stringify(data));
  } catch { /* quota exceeded, ignore */ }
}

function createEmptyWeek(weekId) {
  return {
    id: weekId,
    weekplan: [],
    beginMeeting: {
      watGedaan: '', stageVoortgang: '',
      vragenMiquel: '', vragenDimitri: '', notities: ''
    },
    eindeMeeting: {
      watGedaan: '', stageVoortgang: '',
      terugblikGelukt: '', terugblikTegenaan: '',
      vragenMiquel: '', vragenDimitri: '', notities: ''
    }
  };
}

// ── API (with localStorage fallback) ──
async function loadWeek() {
  const weekId = getCurrentWeekId();
  try {
    const response = await fetch(`${API_BASE}/api/weeks/${weekId}`);
    if (!response.ok) throw new Error(response.status);
    weekData = await response.json();
    serverAvailable = true;
    lsSave('week', weekId, weekData);
  } catch {
    // Server unavailable → load from localStorage
    weekData = lsLoad('week', weekId) || createEmptyWeek(weekId);
    serverAvailable = false;
  }
  render();
  renderOverview();
  updateConnectionUI();
}

async function saveWeek() {
  const weekId = getCurrentWeekId();
  // Always save locally
  lsSave('week', weekId, weekData);

  if (!serverAvailable) {
    showSaveStatus('Lokaal opgeslagen');
    setTimeout(() => showSaveStatus(''), 2000);
    return;
  }

  showSaveStatus('Opslaan...');
  try {
    const resp = await fetch(`${API_BASE}/api/weeks/${weekId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': clientId || ''
      },
      body: JSON.stringify(weekData)
    });
    if (!resp.ok) throw new Error(resp.status);
    showSaveStatus('Opgeslagen');
    setTimeout(() => showSaveStatus(''), 2000);
  } catch {
    showSaveStatus('Lokaal opgeslagen');
    setTimeout(() => showSaveStatus(''), 2000);
  }
}

function debouncedSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveWeek, 500);
}

async function loadStageData() {
  try {
    const response = await fetch(`${API_BASE}/api/stage`);
    if (!response.ok) throw new Error(response.status);
    stageData = await response.json();
    lsSave('stage', null, stageData);
  } catch {
    stageData = lsLoad('stage', null) || { completedWeeks: [] };
  }
  renderOverview();
}

async function saveStageData() {
  lsSave('stage', null, stageData);
  if (!serverAvailable) return;
  try {
    await fetch(`${API_BASE}/api/stage`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': clientId || ''
      },
      body: JSON.stringify(stageData)
    });
  } catch {
    // silent fail, already saved locally
  }
}

function toggleWeekCompleted(weekId) {
  const idx = stageData.completedWeeks.indexOf(weekId);
  if (idx === -1) {
    stageData.completedWeeks.push(weekId);
  } else {
    stageData.completedWeeks.splice(idx, 1);
  }
  saveStageData();
  renderOverview();
}

// ── SSE (optional, only when server available) ──
function connectSSE() {
  try {
    eventSource = new EventSource(`${API_BASE}/api/events`);
  } catch {
    setConnectionStatus(false);
    return;
  }

  eventSource.addEventListener('connected', (e) => {
    const data = JSON.parse(e.data);
    clientId = data.clientId;
    serverAvailable = true;
    updateConnectionUI();
  });

  eventSource.addEventListener('update', (e) => {
    const data = JSON.parse(e.data);
    if (data.weekId === getCurrentWeekId()) {
      applyRemoteUpdate(data.week);
    }
  });

  eventSource.addEventListener('stage-update', (e) => {
    stageData = JSON.parse(e.data);
    lsSave('stage', null, stageData);
    renderOverview();
  });

  eventSource.onerror = () => {
    serverAvailable = false;
    updateConnectionUI();
    setTimeout(() => {
      if (eventSource && eventSource.readyState === EventSource.CLOSED) {
        connectSSE();
      }
    }, 5000);
  };
}

function updateConnectionUI() {
  const dot = document.getElementById('connection-status');
  if (serverAvailable) {
    dot.className = 'connection-dot connected';
    dot.title = 'Verbonden met server';
  } else {
    dot.className = 'connection-dot disconnected';
    dot.title = 'Offline – data lokaal opgeslagen';
  }
}

function applyRemoteUpdate(newWeekData) {
  const focused = document.activeElement;
  const focusedField = focused?.dataset?.field;
  const focusedTab = focused?.dataset?.tab;
  const focusedValue = focused?.value;
  const focusedStart = focused?.selectionStart;
  const focusedEnd = focused?.selectionEnd;

  weekData = newWeekData;
  render();

  if (focusedField) {
    const selector = focusedTab
      ? `[data-field="${focusedField}"][data-tab="${focusedTab}"]`
      : `[data-field="${focusedField}"]`;
    const el = document.querySelector(selector);
    if (el) {
      el.value = focusedValue;
      el.focus();
      if (focusedStart !== undefined) {
        el.selectionStart = focusedStart;
        el.selectionEnd = focusedEnd;
      }
    }
  }
}

// ── UI helpers ──
function showSaveStatus(text) {
  document.getElementById('save-status').textContent = text;
}

function setConnectionStatus(connected) {
  serverAvailable = connected;
  updateConnectionUI();
}

function updateWeekLabel() {
  const weekId = getCurrentWeekId();
  const stageWeek = isoWeekIdToStageWeek(weekId);
  const [, weekStr] = weekId.split('-W');

  // Show stage week if within stage range
  if (stageWeek >= 1 && stageWeek <= STAGE_WEEKS_TOTAL) {
    document.getElementById('week-label').textContent = `Stage week ${stageWeek}`;
  } else {
    document.getElementById('week-label').textContent = `Week ${parseInt(weekStr)}`;
  }
  document.getElementById('week-dates').textContent = getWeekDateRange(weekId);

  const todayBtn = document.getElementById('today-btn');
  todayBtn.classList.toggle('hidden', currentWeekOffset === 0);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.max(60, textarea.scrollHeight) + 'px';
}

// ── Stage Overview Render ──
function renderOverview() {
  const container = document.getElementById('stage-overview');
  if (!container) return;

  const currentStageWeek = getCurrentStageWeek();
  const currentPhase = getCurrentPhase();
  const viewedWeekId = getCurrentWeekId();
  const viewedStageWeek = isoWeekIdToStageWeek(viewedWeekId);
  const totalCompleted = stageData.completedWeeks.length;
  const progressPct = Math.round((totalCompleted / STAGE_WEEKS_TOTAL) * 100);

  let html = '<div class="stage-card">';

  // ── Top bar: title + progress
  html += `
    <div class="stage-topbar">
      <div class="stage-title-row">
        <span class="stage-title">Stage Overzicht</span>
        <span class="stage-progress-label">${totalCompleted}/${STAGE_WEEKS_TOTAL} weken</span>
      </div>
      <div class="stage-progress-track">
        <div class="stage-progress-fill" style="width: ${progressPct}%"></div>
      </div>
    </div>
  `;

  // ── Countdown timer (prominent)
  const countdown = formatCountdown(currentPhase.portfolio);
  html += `
    <div class="stage-countdown-bar ${countdown.urgent}">
      <div class="countdown-left">
        <span class="countdown-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V8l2.5 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </span>
        <span class="countdown-meta">
          <span class="countdown-what">Portfolio Fase ${currentPhase.id}</span>
          <span class="countdown-when">${currentPhase.portfolioLabel}</span>
        </span>
      </div>
      <div class="countdown-value" id="countdown-display">${countdown.text}</div>
    </div>
  `;

  // ── Phases
  PHASES.forEach(phase => {
    const isActive = phase.id === currentPhase.id;
    const isPast = phase.id < currentPhase.id;
    // Count completed in this phase
    let phaseCompleted = 0;
    const phaseTotal = phase.weeks[1] - phase.weeks[0] + 1;
    for (let sw = phase.weeks[0]; sw <= phase.weeks[1]; sw++) {
      if (stageData.completedWeeks.includes(stageWeekToISOWeekId(sw))) phaseCompleted++;
    }

    html += `<div class="phase-section ${isActive ? 'phase-active' : ''} ${isPast ? 'phase-past' : ''}">`;

    // Phase header
    html += `
      <div class="phase-header">
        <div class="phase-title">
          <span class="phase-badge">${phase.id}</span>
          <span class="phase-name">${phase.name}</span>
        </div>
        <span class="phase-count">${phaseCompleted}/${phaseTotal}</span>
      </div>
    `;

    // Week timeline
    html += '<div class="week-timeline">';
    for (let sw = phase.weeks[0]; sw <= phase.weeks[1]; sw++) {
      const weekId = stageWeekToISOWeekId(sw);
      const isCompleted = stageData.completedWeeks.includes(weekId);
      const isCurrent = sw === currentStageWeek;
      const isViewed = sw === viewedStageWeek;
      const isFuture = sw > currentStageWeek;
      const dateRange = getWeekDateRangeShort(weekId);

      let cls = 'week-node';
      if (isCompleted) cls += ' completed';
      if (isCurrent) cls += ' current';
      if (isViewed) cls += ' viewed';
      if (isFuture && !isCompleted) cls += ' future';

      html += `
        <button class="${cls}" data-stage-week="${sw}" data-week-id="${weekId}" title="Week ${sw}: ${dateRange}">
          <span class="node-circle">
            ${isCompleted
              ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5 4.5-5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
              : `<span class="node-num">${sw}</span>`
            }
          </span>
          ${isCurrent && !isCompleted ? '<span class="node-pulse"></span>' : ''}
        </button>
      `;
    }
    html += '</div>';

    // Milestones
    html += `
      <div class="phase-milestones">
        <span class="ms-chip ms-portfolio">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 10V3.5L6 1.5l4 2V10L6 8 2 10z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
          ${phase.portfolioLabel}
        </span>
        <span class="ms-chip ms-assessment">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1v4l3 2-3 2V5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          ${phase.assessment}
        </span>
      </div>
    `;

    html += '</div>';
  });

  html += '</div>';
  container.innerHTML = html;

  // ── Attach click handlers
  container.querySelectorAll('.week-node').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const weekId = btn.dataset.weekId;
      const sw = parseInt(btn.dataset.stageWeek);

      if (sw === viewedStageWeek) {
        toggleWeekCompleted(weekId);
        return;
      }

      const todayIso = getISOWeek(new Date());
      const targetIso = sw + STAGE_START_ISO - 1;
      currentWeekOffset = targetIso - todayIso;
      updateWeekLabel();
      loadWeek();
    });

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      toggleWeekCompleted(btn.dataset.weekId);
    });
  });
}

function startCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    const timerEl = document.getElementById('countdown-display');
    const wrapperEl = document.querySelector('.stage-countdown-bar');
    if (!timerEl || !wrapperEl) return;

    const currentPhase = getCurrentPhase();
    const countdown = formatCountdown(currentPhase.portfolio);
    timerEl.textContent = countdown.text;

    // Update urgency class
    wrapperEl.className = 'stage-countdown-bar ' + countdown.urgent;
  }, 1000);
}

// ── Meeting Render ──
function render() {
  const content = document.getElementById('content');
  const meeting = currentTab === 'begin' ? weekData.beginMeeting : weekData.eindeMeeting;

  let html = '';

  html += `
    <section class="card">
      <h2>Wat heb ik de afgelopen dagen gedaan?</h2>
      <textarea data-field="watGedaan" data-tab="${currentTab}"
        placeholder="Beschrijf wat je de afgelopen dagen hebt gedaan...">${escapeHtml(meeting.watGedaan)}</textarea>
    </section>
  `;

  html += `
    <section class="card">
      <h2>Waar zijn we nu in mijn stage?</h2>
      <textarea data-field="stageVoortgang" data-tab="${currentTab}"
        placeholder="Beschrijf de huidige voortgang van de stage...">${escapeHtml(meeting.stageVoortgang)}</textarea>
    </section>
  `;

  if (currentTab === 'begin') {
    html += renderWeekplan();
  } else {
    html += renderTermblik();
  }

  html += `
    <section class="card">
      <h2>Vragen</h2>
      <div class="questions">
        <div class="question-block">
          <label>Miquel &#8594; Dimitri</label>
          <textarea data-field="vragenMiquel" data-tab="${currentTab}"
            placeholder="Vragen van Miquel aan Dimitri...">${escapeHtml(meeting.vragenMiquel)}</textarea>
        </div>
        <div class="question-block">
          <label>Dimitri &#8594; Miquel</label>
          <textarea data-field="vragenDimitri" data-tab="${currentTab}"
            placeholder="Vragen van Dimitri aan Miquel...">${escapeHtml(meeting.vragenDimitri)}</textarea>
        </div>
      </div>
    </section>
  `;

  html += `
    <section class="card notities-section">
      <h2>Notities</h2>
      <textarea data-field="notities" data-tab="${currentTab}"
        placeholder="Vrije notities tijdens de meeting...">${escapeHtml(meeting.notities)}</textarea>
    </section>
  `;

  content.innerHTML = html;
  content.querySelectorAll('textarea').forEach(autoResize);
  attachEventListeners();
}

function renderWeekplan() {
  const items = weekData.weekplan || [];
  let html = `
    <section class="card">
      <h2>Weekplanning</h2>
      <p class="subtitle">Wat wil ik deze week af hebben?</p>
      <div class="weekplan-list">
  `;

  items.forEach((item, i) => {
    html += `
      <div class="weekplan-item">
        <input type="checkbox" ${item.done ? 'checked' : ''} data-plan-index="${i}" data-plan-action="toggle">
        <input type="text" value="${escapeHtml(item.text)}" data-plan-index="${i}" data-plan-action="edit"
          class="${item.done ? 'done-text' : ''}" placeholder="Doel beschrijven...">
        <button class="remove-btn" data-plan-index="${i}" data-plan-action="remove" title="Verwijderen">&times;</button>
      </div>
    `;
  });

  html += `
      </div>
      <button class="add-btn" id="add-plan">+ Doel toevoegen</button>
    </section>
  `;
  return html;
}

function renderTermblik() {
  const items = weekData.weekplan || [];
  const meeting = weekData.eindeMeeting;

  let html = `
    <section class="card">
      <h2>Terugblik weekplanning</h2>
      <p class="subtitle">Beoordeel de doelen van deze week</p>
      <div class="weekplan-review">
  `;

  if (items.length === 0) {
    html += `<p class="empty-message">Geen doelen gepland. Vul eerst de weekplanning in bij 'Begin van de week'.</p>`;
  } else {
    items.forEach((item, i) => {
      html += `
        <div class="weekplan-review-item ${item.done ? 'done' : ''}">
          <input type="checkbox" ${item.done ? 'checked' : ''} data-review-index="${i}">
          <span>${escapeHtml(item.text) || '(leeg doel)'}</span>
        </div>
      `;
    });
  }

  html += `
      </div>
      <h3>Wat is gelukt?</h3>
      <textarea data-field="terugblikGelukt" data-tab="einde"
        placeholder="Welke doelen zijn behaald? Wat ging goed?">${escapeHtml(meeting.terugblikGelukt)}</textarea>
      <h3>Waar liep ik tegenaan?</h3>
      <textarea data-field="terugblikTegenaan" data-tab="einde"
        placeholder="Welke obstakels ben je tegengekomen? Wat was lastig?">${escapeHtml(meeting.terugblikTegenaan)}</textarea>
    </section>
  `;
  return html;
}

// ── Event listeners ──
function attachEventListeners() {
  const content = document.getElementById('content');

  content.querySelectorAll('textarea[data-field]').forEach(el => {
    el.addEventListener('input', () => {
      autoResize(el);
      const field = el.dataset.field;
      const tab = el.dataset.tab;
      const meeting = tab === 'begin' ? weekData.beginMeeting : weekData.eindeMeeting;
      meeting[field] = el.value;
      debouncedSave();
    });
  });

  const addBtn = document.getElementById('add-plan');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (!weekData.weekplan) weekData.weekplan = [];
      weekData.weekplan.push({ text: '', done: false });
      render();
      const inputs = document.querySelectorAll('.weekplan-item input[type="text"]');
      if (inputs.length > 0) inputs[inputs.length - 1].focus();
      debouncedSave();
    });
  }

  content.querySelectorAll('[data-plan-action]').forEach(el => {
    const index = parseInt(el.dataset.planIndex);
    const action = el.dataset.planAction;

    if (action === 'toggle') {
      el.addEventListener('change', () => {
        weekData.weekplan[index].done = el.checked;
        render();
        debouncedSave();
      });
    } else if (action === 'edit') {
      el.addEventListener('input', () => {
        weekData.weekplan[index].text = el.value;
        debouncedSave();
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.getElementById('add-plan')?.click();
        }
      });
    } else if (action === 'remove') {
      el.addEventListener('click', () => {
        weekData.weekplan.splice(index, 1);
        render();
        debouncedSave();
      });
    }
  });

  content.querySelectorAll('[data-review-index]').forEach(el => {
    el.addEventListener('change', () => {
      const index = parseInt(el.dataset.reviewIndex);
      weekData.weekplan[index].done = el.checked;
      render();
      debouncedSave();
    });
  });
}

// ── Navigation ──
function setupNavigation() {
  document.getElementById('prev-week').addEventListener('click', () => {
    currentWeekOffset--;
    updateWeekLabel();
    loadWeek();
  });

  document.getElementById('next-week').addEventListener('click', () => {
    currentWeekOffset++;
    updateWeekLabel();
    loadWeek();
  });

  document.getElementById('today-btn').addEventListener('click', () => {
    currentWeekOffset = 0;
    updateWeekLabel();
    loadWeek();
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      render();
    });
  });

  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === currentTab);
  });
}

// ── Init ──
function init() {
  setupNavigation();
  updateWeekLabel();
  connectSSE();
  loadStageData();
  loadWeek();
  startCountdown();
}

document.addEventListener('DOMContentLoaded', init);
