// Wires the park model, the three.js view and the toolbar together.

import { Park, MOW_HEIGHT, NEEDS_MOWING_ABOVE, SQFT_PER_USER } from './model.js';
import { ParkView, ACTIVITY_COLORS, GRASS_SHORT, GRASS_TALL } from './view.js';

const park = new Park();
const view = new ParkView(document.getElementById('viewport'), park);
const $ = (id) => document.getElementById(id);

let selection = null;
let autoTimer = null;

function select(sel) {
  selection = sel;
  view.selection = sel;
  refresh();
}

function run(result) {
  if (result && !result.ok && result.reason && !park.log.at(-1)?.message.includes(result.reason)) {
    park.note(result.reason, 'warn');
  }
  if (selection?.type === 'user' && !park.user(selection.id)) select(null);
  refresh();
}

const actions = {
  add() {
    const r = park.addUser();
    run(r);
    if (r.ok) select({ type: 'user', id: r.user.id });
  },
  remove() { run(park.removeUser(selection?.id)); },
  activity() { run(park.changeActivity(selection?.id)); },
  advance() {
    const trails = park.advanceTime();
    view.animateTrails(trails, autoTimer ? 850 : 700);
    run({ ok: true });
  },
  mow() { run(park.mowLawn(selection?.id)); },
  toggle() { run(park.toggleLawn(selection?.id)); },
  auto() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    } else {
      actions.advance();
      autoTimer = setInterval(actions.advance, 900);
    }
    refresh();
  },
  reset() {
    if (autoTimer) actions.auto();
    park.reset();
    select(null);
  },
};

for (const btn of document.querySelectorAll('[data-action]')) {
  btn.addEventListener('click', () => actions[btn.dataset.action]());
}

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  const map = { a: 'add', Delete: 'remove', Backspace: 'remove', c: 'activity', t: 'advance', ' ': 'advance', m: 'mow', o: 'toggle', p: 'auto', Escape: null };
  if (!(e.key in map)) return;
  e.preventDefault();
  if (map[e.key] === null) return select(null);
  const btn = document.querySelector(`[data-action="${map[e.key]}"]`);
  if (!btn.disabled) actions[map[e.key]]();
});

// Click (not drag) to select.
const canvas = view.renderer.domElement;
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  select(view.pick(e.clientX, e.clientY));
});

// ---- panels ---------------------------------------------------------------

function refresh() {
  view.sync();
  updateToolbar();
  renderInspector();
  renderRules();
  renderLog();
  $('day').textContent = `Day ${park.day}`;
  $('census').textContent = `${park.users.length} visitors`;
}

function updateToolbar() {
  const user = selection?.type === 'user' ? park.user(selection.id) : null;
  const lawn = selection?.type === 'lawn' ? park.lawn(selection.id) : null;
  const set = (action, enabled, title) => {
    const b = document.querySelector(`[data-action="${action}"]`);
    b.disabled = !enabled;
    if (title) b.title = title;
  };
  set('remove', !!user, user ? `Remove ${user.name}` : 'Select a user to remove');
  const next = { walking: 'standing', standing: 'sitting', sitting: 'walking' };
  set('activity', !!user, user ? `${user.activity} → ${next[user.activity]}` : 'Select a user to change activity');
  const mowCheck = lawn && park.canMow(lawn);
  set('mow', !!lawn, lawn ? (mowCheck.ok ? `Mow ${lawn.name} to ${MOW_HEIGHT}″` : `Blocked: ${mowCheck.reason}`) : 'Select a lawn to mow');
  set('toggle', !!lawn, lawn ? `${lawn.status === 'open' ? 'Close' : 'Open'} ${lawn.name}` : 'Select a lawn to open or close');
  document.querySelector('[data-action="toggle"] .label').textContent =
    lawn ? (lawn.status === 'open' ? 'Close lawn' : 'Open lawn') : 'Open/close lawn';
  const auto = document.querySelector('[data-action="auto"]');
  auto.classList.toggle('active', !!autoTimer);
  auto.querySelector('.label').textContent = autoTimer ? 'Pause' : 'Play';
  auto.querySelector('.icon').textContent = autoTimer ? '❚❚' : '▶';
}

const row = (k, v) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;

function renderInspector() {
  const el = $('inspector');
  if (!selection) {
    el.innerHTML = `<h2>Nothing selected</h2>
      <p class="hint">Click a person, lawn or path in the park. Drag to orbit, scroll to zoom.</p>`;
    return;
  }
  if (selection.type === 'user') {
    const u = park.user(selection.id);
    const loc = u.locationType === 'lawn' ? park.lawn(u.locationId) : park.path(u.locationId);
    el.innerHTML = `<div class="kind">User</div><h2>${u.name}</h2>
      ${row('Activity', `<span class="chip" style="--c:${ACTIVITY_COLORS[u.activity]}">${u.activity}</span>`)}
      ${row('Position', `(${u.position.x.toFixed(1)}, ${u.position.y.toFixed(1)}) ft`)}
      ${row('Location', `${loc.name} <small>(${u.locationType})</small>`)}
      <p class="hint">Change activity cycles walking → standing → sitting → walking.</p>`;
    return;
  }
  if (selection.type === 'lawn') {
    const l = park.lawn(selection.id);
    const n = park.usersOnLawn(l.id).length;
    const mow = park.canMow(l);
    el.innerHTML = `<div class="kind">Lawn</div><h2>${l.name}</h2>
      ${row('Grass height', `${l.grassHeight.toFixed(1)}″${park.needsMowing(l) ? ' <span class="badge mow">needs mowing</span>' : ''}`)}
      ${row('Area', `${l.area.toFixed(0)} ft²`)}
      ${row('Status', `<span class="badge ${l.status}">${l.status}</span>`)}
      ${row('People', `${n} / ${l.capacity} <small>(area ÷ ${SQFT_PER_USER})</small>`)}
      ${row('Bordered by', l.borderedBy.map((id) => park.path(id).name).join(', '))}
      ${row('Boundary', `${l.boundary.length}-sided polygon`)}
      <p class="hint">${mow.ok ? 'Can be mowed now.' : `Can't mow: ${mow.reason}.`}</p>`;
    return;
  }
  const p = park.path(selection.id);
  el.innerHTML = `<div class="kind">Path</div><h2>${p.name}</h2>
    ${row('Width', `${p.width} ft`)}
    ${row('Length', `${p.len.toFixed(0)} ft`)}
    ${row('Walkers', park.usersOnPath(p.id).length)}
    ${row('Borders lawns', p.bordersLawns.map((id) => park.lawn(id).name).join(', ') || '—')}
    ${row('Connects to', p.connectsTo.map((id) => park.path(id).name).join(', '))}`;
}

function renderRules() {
  const results = park.validate();
  const bad = results.filter((r) => !r.ok).length;
  $('rules-summary').textContent = bad ? `${bad} violated` : 'all satisfied';
  $('rules-summary').className = bad ? 'bad' : 'good';
  $('rules').innerHTML = results.map((r) => `
    <li class="${r.ok ? 'ok' : 'fail'}">${r.ok ? '✓' : '✗'} ${r.rule}
      ${r.violations.map((v) => `<div class="violation">${v}</div>`).join('')}</li>`).join('');
}

function renderLog() {
  $('log').innerHTML = park.log.slice(-5).reverse()
    .map((e, i) => `<div class="entry ${e.level} ${i === 0 ? 'latest' : ''}"><span>Day ${e.day}</span>${e.message}</div>`)
    .join('');
}

function renderLegend() {
  $('legend-activity').innerHTML = Object.entries(ACTIVITY_COLORS)
    .map(([k, c]) => `<span class="chip" style="--c:${c}">${k}</span>`).join('');
  $('legend-grass').style.background = `linear-gradient(90deg, ${GRASS_SHORT}, ${GRASS_TALL})`;
  $('mow-threshold').textContent = `> ${NEEDS_MOWING_ABOVE}″`;
}

renderLegend();
if (window.innerWidth < 760) document.querySelector('#side details[open]')?.removeAttribute('open');
refresh();
