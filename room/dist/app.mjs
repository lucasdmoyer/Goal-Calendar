import defaults from './profile.mjs';
import { createPlan, buildCoachingBrief } from './coach.mjs';

const STORAGE_KEY = 'room-personal-coach-v1';
const $ = (id) => document.getElementById(id);
const statusNames = { inbox: 'Inbox', active: 'Active', parked: 'Parked', finished: 'Finished' };
const effortNames = { light: 'light effort', moderate: 'moderate effort', demanding: 'demanding effort' };
let storageAvailable = true;
let storageBlocked = false;
let storageConflict = false;
let lastStoredRaw = null;
let storageMessage = '';
let toastTimer;
let filter = 'all';
let currentView = 'today';
let date = localDate();
let planOptions = { smaller: false, alternative: 0 };
let activePlan;
let confirmResolver;
let editingDirty = false;
let valuesInvalid = false;
let reviewDateInvalid = false;

function localDate(value = new Date()) {
  return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
function freshState() {
  return { version: 1, profile: structuredClone(defaults.profile), goals: structuredClone(defaults.goals), days: {}, review: { feltGood: '', crowded: '', remove: '', partner: '', reviewDate: '' } };
}
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function checkedText(value, key, max = 4000) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${key} must be text of at most ${max} characters.`);
  return value;
}
function checkedDate(value, key, empty = true) {
  if (empty && value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1 || localDate(new Date(`${value}T12:00:00`)) !== value) throw new Error(`${key} has an invalid date.`);
  return value;
}
function validateState(value) {
  if (!record(value) || value.version !== 1 || !record(value.profile) || !Array.isArray(value.goals) || !record(value.days) || !record(value.review)) throw new Error('This is not a supported Room backup (version 1).');
  const p = value.profile;
  if (!Array.isArray(p.values) || p.values.length > 50) throw new Error('Profile values must be a list of at most 50 items.');
  const profile = { name: checkedText(p.name, 'Name', 80), partner: checkedText(p.partner, 'Partner', 80), season: checkedText(p.season, 'Season', 1000), healthDefault: checkedText(p.healthDefault, 'Health default', 1000), connectionDefault: checkedText(p.connectionDefault, 'Connection default', 1000), values: p.values.map((v) => checkedText(v, 'Value', 2000)) };
  if (value.goals.length > 500) throw new Error('A backup may contain at most 500 goals.');
  const ids = new Set();
  const goals = value.goals.map((g) => {
    if (!record(g)) throw new Error('Every goal must be an object.');
    const id = checkedText(g.id, 'Goal ID', 100);
    if (!id || ids.has(id)) throw new Error('Goal IDs must be present and unique.');
    ids.add(id);
    if (!Object.hasOwn(statusNames, g.status) || !Object.hasOwn(effortNames, g.effort) || !['suggested', 'user'].includes(g.source)) throw new Error('A goal has an unsupported status, effort, or source.');
    if (!Number.isFinite(g.minutes) || !Number.isInteger(g.minutes) || g.minutes < 1 || g.minutes > 480) throw new Error('Goal minutes must be a whole number between 1 and 480.');
    const title = checkedText(g.title, 'Goal title', 160);
    if (!title.trim()) throw new Error('A goal title cannot be empty.');
    return { id, title, why: checkedText(g.why, 'Goal reason', 2000), nextAction: checkedText(g.nextAction, 'Next step', 1000), minutes: g.minutes, effort: g.effort, status: g.status, deadline: checkedDate(g.deadline, 'Goal deadline'), source: g.source };
  });
  if (goals.filter((g) => g.status === 'active').length > 2) throw new Error('Room supports at most two active goals. Park the others before importing.');
  const entries = Object.entries(value.days);
  const days = {};
  for (const [key, day] of entries) {
    checkedDate(key, 'Check-in date', false);
    if (!record(day) || !['little', 'some', 'plenty'].includes(day.capacity) || ![0, 10, 20, 45, 60].includes(day.minutes) || typeof day.closed !== 'boolean') throw new Error('A daily check-in is malformed.');
    if (day.completedGoalId !== null && (typeof day.completedGoalId !== 'string' || day.completedGoalId.length > 100)) throw new Error('A completed step has an invalid goal ID.');
    days[key] = { capacity: day.capacity, minutes: day.minutes, commitments: checkedText(day.commitments, 'Commitments'), closed: day.closed, completedGoalId: day.completedGoalId };
  }
  const r = value.review;
  return { version: 1, profile, goals, days, review: { feltGood: checkedText(r.feltGood, 'Weekly reflection'), crowded: checkedText(r.crowded, 'Weekly reflection'), remove: checkedText(r.remove, 'Weekly reflection'), partner: checkedText(r.partner, 'Partner invitation'), reviewDate: checkedDate(r.reviewDate, 'Review date') } };
}
function loadState() {
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); lastStoredRaw = raw; }
  catch { storageAvailable = false; storageMessage = 'Browser storage is unavailable. Your changes are held in this tab only. Export a backup before closing it.'; return freshState(); }
  if (!raw) return freshState();
  try { return validateState(JSON.parse(raw)); }
  catch { storageBlocked = true; storageMessage = 'Saved data could not be loaded. This is a fresh session; your original stored data has not been overwritten. Export your work here before leaving. Importing a valid backup can restore normal saving.'; return freshState(); }
}
let state = loadState();

function day() {
  if (!state.days[date]) state.days[date] = { capacity: 'some', minutes: 20, commitments: '', closed: false, completedGoalId: null };
  return state.days[date];
}
function renderStorage() {
  $('storage-warning').hidden = !storageMessage;
  $('storage-warning').textContent = storageMessage;
  $('persistence-label').textContent = storageAvailable && !storageBlocked ? 'Rules-based coaching · saved on this browser' : 'Rules-based coaching · held in this tab only';
  const text = storageAvailable && !storageBlocked ? 'Changes save as you write.' : 'Held in this tab only. Export a backup.';
  $('profile-saved').textContent = text;
  $('review-saved').textContent = text;
}
function persist() {
  if (!storageBlocked) {
    try {
      if (checkForStorageConflict()) { renderStorage(); return; }
      const raw = JSON.stringify(state);
      localStorage.setItem(STORAGE_KEY, raw); lastStoredRaw = raw;
      storageAvailable = true; storageMessage = '';
    }
    catch { storageAvailable = false; storageMessage = 'Room couldn’t save to browser storage. Your changes are held in this tab only. Export a backup before closing it.'; }
  }
  renderStorage();
}
function checkForStorageConflict() {
  if (storageConflict) return true;
  const current = localStorage.getItem(STORAGE_KEY);
  if (current === lastStoredRaw) return false;
  storageConflict = true; storageBlocked = true;
  storageMessage = 'Room changed in another tab. Saving here is paused to protect the newer data. Export your current edits, close other Room tabs, then reload to load the newer saved version. Room does not merge changes between tabs.';
  return true;
}
function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}
function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.type) node.type = options.type;
  if (options.click) node.addEventListener('click', options.click);
  if (options.label) node.setAttribute('aria-label', options.label);
  for (const child of children) node.append(child);
  return node;
}
function putValue(id, value, force = false) {
  if (force || document.activeElement !== $(id)) $(id).value = value;
}
function renderContext() {
  $('greeting').textContent = state.profile.name.trim() ? `${state.profile.name.trim().toUpperCase()}, MAKE SOME ROOM` : 'YOUR DAY, WITH SPACE IN IT';
  $('sidebar-season').textContent = state.profile.season;
  $('connection-title').textContent = state.profile.partner.trim() ? `Be here with ${state.profile.partner.trim()}` : 'Be here together';
  $('review-partner-label').textContent = state.profile.partner.trim() ? `An invitation for ${state.profile.partner.trim()}` : 'An invitation for your partner';
}
function renderToday() {
  const d = day();
  $('current-date').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`));
  document.querySelectorAll('[data-capacity]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.capacity === d.capacity)));
  document.querySelectorAll('[data-minutes]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.minutes) === d.minutes)));
  putValue('commitments', d.commitments);
  activePlan = createPlan(state, date, planOptions);
  const plan = activePlan;
  $('plan-headline').textContent = plan.headline;
  $('plan-message').textContent = plan.message;
  $('plan-why').textContent = plan.why;
  $('plan-permission').textContent = plan.permission;
  $('health-default').textContent = plan.health;
  $('connection-default').textContent = plan.connection;
  const action = plan.action;
  const canFindSmaller = !action && !d.closed && !d.completedGoalId && d.capacity !== 'little' && d.minutes > 0 && state.goals.some((g) => g.status === 'active');
  $('daily-action').hidden = (!action && !canFindSmaller) || d.closed || Boolean(d.completedGoalId);
  $('action-done').hidden = !action;
  $('action-different').hidden = !action;
  $('action-smaller').textContent = action ? 'Smaller' : 'Find a smaller step';
  $('plan-badge').textContent = d.closed ? 'Day closed' : d.completedGoalId ? 'Enough for today' : 'Room for life';
  if (action) {
    $('action-title').textContent = action.title;
    $('action-minutes').textContent = `${action.minutes} min`;
  } else if (canFindSmaller) {
    $('action-title').textContent = 'You can use a few minutes to find a smaller next step.';
    $('action-minutes').textContent = 'Up to 5 min';
  }
  $('action-smaller').disabled = Boolean(planOptions.smaller);
  $('day-completion').hidden = !d.completedGoalId;
  $('day-completion').textContent = 'You did today’s step. The larger goal stays active; choose its next step when you review it.';
  $('close-day').textContent = d.closed ? 'Reopen today' : 'Close today';
  $('close-day').setAttribute('aria-pressed', String(d.closed));
  const notes = Array.isArray(plan.deadlineNotes) ? plan.deadlineNotes : [];
  $('deadline-notes').replaceChildren(...notes.map((note) => element('p', { text: note })));
  $('deadline-notes').hidden = notes.length === 0;
}
function renderGoals() {
  const query = $('goal-search').value.trim().toLocaleLowerCase();
  const list = state.goals.filter((g) => (filter === 'all' || g.status === filter) && `${g.title} ${g.why} ${g.nextAction}`.toLocaleLowerCase().includes(query));
  const order = { active: 0, inbox: 1, parked: 2, finished: 3 };
  list.sort((a, b) => order[a.status] - order[b.status]);
  $('active-count').textContent = `${state.goals.filter((g) => g.status === 'active').length} of 2 active`;
  document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
  if (!list.length) {
    $('goal-list').replaceChildren(element('div', { className: 'empty-state' }, [element('h2', { text: query ? 'Nothing by that name.' : filter === 'active' ? 'Space is available.' : 'A little breathing room.' }), element('p', { text: query ? 'Try another word, or capture a new thought.' : filter === 'active' ? 'Choose one goal when you’re ready. There is no need to fill both slots.' : 'New thoughts can wait safely in your inbox.' })]));
    return;
  }
  $('goal-list').replaceChildren(...list.map(goalCard));
}
function goalCard(goal) {
  const badges = element('div', { className: 'goal-badges' }, [element('span', { className: `badge badge-${goal.status}`, text: statusNames[goal.status] }), element('span', { className: `badge${goal.source === 'suggested' ? ' badge-candidate' : ''}`, text: goal.source === 'suggested' ? 'Suggested · confirm when ready' : 'Your goal' })]);
  const card = element('article', { className: 'goal-card' }, [badges, element('h2', { text: goal.title })]);
  if (goal.why) card.append(element('p', { className: 'goal-why', text: goal.why }));
  if (goal.nextAction) card.append(element('p', { className: 'goal-next' }, [element('span', { text: 'NEXT SMALL STEP' }), document.createTextNode(goal.nextAction)]));
  const deadline = goal.deadline ? ` · due ${goal.deadline}` : '';
  card.append(element('p', { className: 'goal-detail', text: `${goal.minutes} min · ${effortNames[goal.effort]}${deadline}` }));
  const actions = element('div', { className: 'goal-actions' }, [element('button', { className: 'button secondary', text: 'Edit', label: `Edit ${goal.title}`, click: () => editGoal(goal.id) })]);
  if (goal.status !== 'active' && goal.status !== 'finished') actions.append(element('button', { className: 'button text-button', text: 'Make active', click: () => changeStatus(goal.id, 'active') }));
  if (goal.status === 'active') actions.append(element('button', { className: 'button text-button', text: 'Let it wait', click: () => changeStatus(goal.id, 'parked') }));
  const menu = element('details', { className: 'goal-menu' });
  menu.append(element('summary', { text: '···', label: `More options for ${goal.title}` }));
  const more = element('div');
  if (goal.status !== 'parked') more.append(element('button', { text: 'Park for later', click: () => changeStatus(goal.id, 'parked') }));
  if (goal.status !== 'finished') more.append(element('button', { text: 'Finish this goal', click: () => changeStatus(goal.id, 'finished') }));
  if (goal.status === 'finished') more.append(element('button', { text: 'Return to inbox', click: () => changeStatus(goal.id, 'inbox') }));
  more.append(element('button', { className: 'danger', text: 'Delete goal', click: () => deleteGoal(goal.id) }));
  menu.append(more); actions.append(menu); card.append(actions);
  return card;
}
function renderForms(force = false) {
  for (const [key, id] of Object.entries({ name: 'profile-name', partner: 'profile-partner', season: 'profile-season', healthDefault: 'profile-health', connectionDefault: 'profile-connection' })) putValue(id, state.profile[key], force);
  putValue('profile-values', state.profile.values.join('\n'), force);
  for (const [key, id] of Object.entries({ feltGood: 'review-good', crowded: 'review-crowded', remove: 'review-remove', partner: 'review-partner', reviewDate: 'review-date' })) putValue(id, state.review[key], force);
}
function showView(view, focus = false) {
  if (!['today', 'goals', 'review', 'settings'].includes(view)) view = 'today';
  currentView = view;
  document.querySelectorAll('.view').forEach((section) => { section.hidden = section.id !== `view-${view}`; });
  document.querySelectorAll('[data-view]').forEach((button) => {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (view === 'goals') renderGoals();
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  if (focus) { window.scrollTo({ top: 0, behavior: 'instant' }); $('main').focus({ preventScroll: true }); }
}
function confirmAction(title, message, label = 'Confirm', danger = false) {
  $('confirm-heading').textContent = title; $('confirm-message').textContent = message;
  $('confirm-yes').textContent = label; $('confirm-yes').classList.toggle('danger-button', danger);
  $('confirm-dialog').showModal();
  return new Promise((resolve) => { confirmResolver = resolve; $('confirm-cancel').focus(); });
}
function resolveConfirmation(answer) {
  $('confirm-dialog').close();
  const resolve = confirmResolver; confirmResolver = null;
  if (resolve) resolve(answer);
}
function activeLimit(excludingId) { return state.goals.filter((g) => g.id !== excludingId && g.status === 'active').length >= 2; }
async function changeStatus(id, status) {
  const goal = state.goals.find((g) => g.id === id); if (!goal) return;
  if (status === 'active' && activeLimit(id)) { notify('Two goals are already active. Let one wait before choosing another.'); return; }
  if (status === 'finished' && !await confirmAction('Finish this whole goal?', `This marks “${goal.title}” as finished. For only today’s step, use Done for today on the Today screen.`, 'Finish goal')) return;
  goal.status = status; goal.source = 'user';
  planOptions = { smaller: false, alternative: 0 }; persist(); renderGoals(); renderToday();
  notify(status === 'parked' ? 'It can wait here.' : status === 'active' ? 'One chosen priority. You can change your mind.' : 'Goal updated.');
}
async function deleteGoal(id) {
  const goal = state.goals.find((g) => g.id === id); if (!goal) return;
  if (!await confirmAction('Delete this goal?', `“${goal.title}” will be removed from this browser. Export a backup first if you want to keep a copy.`, 'Delete goal', true)) return;
  state.goals = state.goals.filter((g) => g.id !== id); persist(); renderGoals(); renderToday(); notify('Goal removed.');
}
function editGoal(id = '') {
  const goal = state.goals.find((g) => g.id === id) || { id: '', title: '', why: '', nextAction: '', minutes: 10, effort: 'light', status: 'inbox', deadline: '' };
  for (const [key, field] of Object.entries({ id: 'goal-id', title: 'goal-title', why: 'goal-why', nextAction: 'goal-next', minutes: 'goal-minutes', effort: 'goal-effort', status: 'goal-status', deadline: 'goal-deadline' })) $(field).value = goal[key];
  $('goal-dialog-heading').textContent = id ? 'Make this goal yours.' : 'Make room for a goal.';
  $('goal-form-error').hidden = true; editingDirty = false;
  $('goal-dialog').showModal(); $('goal-title').focus();
}
async function closeGoalEditor() {
  if (editingDirty && !await confirmAction('Leave your edits?', 'Your changes to this goal have not been saved. Keep editing or discard these changes.', 'Discard changes')) return;
  $('goal-dialog').close(); editingDirty = false;
}
function newId() { return globalThis.crypto?.randomUUID?.() || `goal-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function openBrief() {
  $('brief-text').value = buildCoachingBrief(state, date);
  $('brief-status').textContent = 'Review the text before sharing it. You can select and copy it yourself.';
  $('brief-dialog').showModal();
  copyBrief();
}
async function copyBrief() {
  try { await navigator.clipboard.writeText($('brief-text').value); $('brief-status').textContent = 'Copied. Paste this into ChatGPT when you’re ready.'; }
  catch { $('brief-status').textContent = 'Automatic copying is unavailable. The brief is selected below; use your device’s Copy command.'; $('brief-text').focus(); $('brief-text').select(); }
}
function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `room-backup-${date}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Backup download started. Keep it somewhere private.');
}
async function importBackup(file) {
  if (!file) return;
  let next;
  try { if (file.size > 50 * 1024 * 1024) throw new Error('Choose a JSON backup smaller than 50 MiB.'); next = validateState(JSON.parse(await file.text())); }
  catch (error) { notify(`Backup not imported. ${error instanceof SyntaxError ? 'The file is not valid JSON.' : error.message}`); return; }
  if (!await confirmAction('Replace your current Room data?', `This backup contains ${next.goals.length} goals and ${Object.keys(next.days).length} daily check-ins. Importing replaces the data in this browser. Export your current data first if you want to keep it.`, 'Replace with backup')) return;
  try {
    if (checkForStorageConflict()) { renderStorage(); notify('Import paused. Export your current edits and reload the newer saved data first.'); return; }
  } catch { /* An unavailable store still permits importing into the current tab. */ }
  state = next; storageBlocked = false; valuesInvalid = false; reviewDateInvalid = false; $('values-error').hidden = true; $('review-date-error').hidden = true; $('profile-values').removeAttribute('aria-invalid'); $('review-date').removeAttribute('aria-invalid'); planOptions = { smaller: false, alternative: 0 };
  day(); persist(); renderContext(); renderForms(true); renderToday(); renderGoals();
  notify(storageAvailable && !storageBlocked ? 'Backup imported and saved in this browser.' : 'Backup imported into this tab. Browser saving is unavailable or paused.');
}
function checkDay() {
  const next = localDate(); if (next === date) return;
  date = next; planOptions = { smaller: false, alternative: 0 }; day(); persist(); renderToday();
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view, true)));
window.addEventListener('hashchange', () => showView(location.hash.slice(1), true));
document.querySelectorAll('[data-capacity]').forEach((button) => button.addEventListener('click', () => { day().capacity = button.dataset.capacity; planOptions = { smaller: false, alternative: 0 }; persist(); renderToday(); }));
document.querySelectorAll('[data-minutes]').forEach((button) => button.addEventListener('click', () => { day().minutes = Number(button.dataset.minutes); planOptions = { smaller: false, alternative: 0 }; persist(); renderToday(); }));
$('commitments').addEventListener('input', () => { day().commitments = $('commitments').value; persist(); renderToday(); });
$('action-smaller').addEventListener('click', () => { planOptions.smaller = true; renderToday(); });
$('action-different').addEventListener('click', () => { planOptions.alternative += 1; planOptions.smaller = false; renderToday(); });
$('action-done').addEventListener('click', () => {
  if (!activePlan?.action) return;
  day().completedGoalId = activePlan.action.goalId; persist(); renderToday();
  notify('Today’s step is enough. Your goal stays active for later.');
});
$('close-day').addEventListener('click', () => { day().closed = !day().closed; persist(); renderToday(); notify(day().closed ? 'The optional plan is closed. There is room to be here.' : 'Today is open again. Keep it small.'); });
$('open-capture').addEventListener('click', () => { $('capture-dialog').showModal(); $('capture-text').focus(); });
$('capture-form').addEventListener('submit', (event) => {
  event.preventDefault(); const title = $('capture-text').value.trim(); if (!title) return;
  if (state.goals.length >= 500) { notify('Your inbox is full. Export a backup and remove thoughts you no longer need.'); return; }
  state.goals.push({ id: newId(), title, why: '', nextAction: '', minutes: 10, effort: 'light', status: 'inbox', deadline: '', source: 'user' });
  persist(); $('capture-text').value = ''; $('capture-dialog').close(); renderGoals(); renderToday(); notify('Captured. You don’t have to act on it today.');
});
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => { if (button.dataset.close === 'goal-dialog') closeGoalEditor(); else $(button.dataset.close).close(); }));
$('goal-dialog').addEventListener('cancel', (event) => { event.preventDefault(); closeGoalEditor(); });
$('confirm-cancel').addEventListener('click', () => resolveConfirmation(false));
$('confirm-yes').addEventListener('click', () => resolveConfirmation(true));
$('confirm-dialog').addEventListener('cancel', (event) => { event.preventDefault(); resolveConfirmation(false); });
$('add-goal').addEventListener('click', () => editGoal());
$('goal-form').addEventListener('input', () => { editingDirty = true; });
$('goal-form').addEventListener('change', () => { editingDirty = true; });
$('goal-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const id = $('goal-id').value; const status = $('goal-status').value;
  const title = $('goal-title').value.trim();
  if (!title) { $('goal-form-error').textContent = 'Give this goal a name.'; $('goal-form-error').hidden = false; return; }
  if (status === 'active' && activeLimit(id)) { $('goal-form-error').textContent = 'Two goals are already active. Let one wait before activating this one.'; $('goal-form-error').hidden = false; return; }
  const existing = state.goals.find((g) => g.id === id);
  if (!existing && state.goals.length >= 500) { $('goal-form-error').textContent = 'Export a backup and remove some goals before adding another.'; $('goal-form-error').hidden = false; return; }
  const goal = { id: id || newId(), title, why: $('goal-why').value, nextAction: $('goal-next').value, minutes: Number($('goal-minutes').value), effort: $('goal-effort').value, status, deadline: $('goal-deadline').value, source: 'user' };
  try { validateState({ ...state, goals: existing ? state.goals.map((g) => g.id === id ? goal : g) : [...state.goals, goal] }); }
  catch (error) { $('goal-form-error').textContent = error.message; $('goal-form-error').hidden = false; return; }
  if (existing) state.goals = state.goals.map((g) => g.id === id ? goal : g); else state.goals.push(goal);
  editingDirty = false; $('goal-dialog').close(); planOptions = { smaller: false, alternative: 0 }; persist(); renderGoals(); renderToday(); notify('Goal saved. You decide when it matters.');
});
$('goal-search').addEventListener('input', renderGoals);
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { filter = button.dataset.filter; renderGoals(); }));
for (const [key, id] of Object.entries({ name: 'profile-name', partner: 'profile-partner', season: 'profile-season', healthDefault: 'profile-health', connectionDefault: 'profile-connection' })) $(id).addEventListener('input', () => { state.profile[key] = $(id).value; persist(); renderContext(); renderToday(); });
$('profile-values').addEventListener('input', () => {
  const values = $('profile-values').value.split('\n').map((s) => s.trim()).filter(Boolean);
  valuesInvalid = values.length > 50;
  $('values-error').hidden = !valuesInvalid;
  if (valuesInvalid) {
    $('values-error').textContent = 'Use at most 50 values. These edits have not been saved; your previous values are safe.';
    $('profile-values').setAttribute('aria-invalid', 'true');
    return;
  }
  $('profile-values').removeAttribute('aria-invalid');
  state.profile.values = values; persist();
});
for (const [key, id] of Object.entries({ feltGood: 'review-good', crowded: 'review-crowded', remove: 'review-remove', partner: 'review-partner' })) $(id).addEventListener('input', () => { state.review[key] = $(id).value; persist(); });
$('review-date').addEventListener('input', () => {
  try {
    if (!$('review-date').validity.valid) throw new Error('Invalid date');
    const value = checkedDate($('review-date').value, 'Review date');
    reviewDateInvalid = false; $('review-date-error').hidden = true; $('review-date').removeAttribute('aria-invalid');
    state.review.reviewDate = value; persist();
  } catch {
    reviewDateInvalid = true; $('review-date').setAttribute('aria-invalid', 'true');
    $('review-date-error').textContent = 'Choose a complete date with a year from 0001 to 9999, or clear the field. Your previous saved review date is unchanged.';
    $('review-date-error').hidden = false;
  }
});
$('review-save').addEventListener('click', () => { if (reviewDateInvalid) { notify('The review date has not been saved. Complete it or clear the field first.'); return; } persist(); notify(storageAvailable && !storageBlocked ? 'Your reset is saved. Let the rest wait.' : 'Your reset is held in this tab. Export a backup before closing.'); });
$('export-data').addEventListener('click', exportBackup);
$('import-data').addEventListener('click', () => { $('import-file').value = ''; $('import-file').click(); });
$('import-file').addEventListener('change', () => importBackup($('import-file').files[0]));
$('open-brief').addEventListener('click', openBrief);
$('footer-brief').addEventListener('click', openBrief);
$('copy-brief').addEventListener('click', copyBrief);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });
window.addEventListener('focus', checkDay);
window.addEventListener('storage', (event) => {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  try { if (event.storageArea === localStorage && checkForStorageConflict()) renderStorage(); }
  catch { /* Normal saving reports any later storage access failure. */ }
});
setInterval(checkDay, 60000);
window.addEventListener('beforeunload', (event) => { if (editingDirty || valuesInvalid || reviewDateInvalid || storageConflict || $('capture-text').value.trim()) { event.preventDefault(); event.returnValue = ''; } });

day(); renderContext(); renderForms(true); renderToday(); renderGoals(); renderStorage(); showView(location.hash.slice(1));
if (!storageBlocked) persist();
