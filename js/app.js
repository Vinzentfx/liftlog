// Bootstrap + hash router.

import { $, clear, el, initSheet, closeSheet, toast } from './ui.js';
import * as store from './store.js';
import * as rest from './rest.js';

import renderHome from './screens/home.js';
import renderTrain from './screens/train.js';
import renderPlans from './screens/plans.js';
import renderLibrary from './screens/library.js';
import renderCalendar from './screens/calendar.js';
import renderProgress from './screens/progress.js';
import { renderSettings } from './screens/settings.js';

/**
 * Five tabs plus `progress`, which is reachable from Home, Library and a
 * session detail but does not occupy a tab slot.
 */
const ROUTES = {
  home:     { title: 'Home',     render: renderHome },
  train:    { title: 'Train',    render: renderTrain },
  plans:    { title: 'Plans',    render: renderPlans },
  library:  { title: 'Library',  render: renderLibrary },
  calendar: { title: 'Calendar', render: renderCalendar },
  progress: { title: 'Progress', render: renderProgress },
};

/** Parsed from location.hash: `#/route/param`. */
export function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, ...rest_] = raw.split('/');
  return { name: ROUTES[name] ? name : 'home', param: rest_.join('/') || null };
}

export function navigate(name, param = null) {
  const next = `#/${name}${param ? `/${param}` : ''}`;
  if (location.hash === next) render();
  else location.hash = next;
}

let rendering = false;
let lastRouteKey = null;

export function render() {
  if (!store.state.ready || rendering) return;
  rendering = true;
  try {
    const { name, param } = currentRoute();
    const route = ROUTES[name];
    const routeKey = `${name}/${param || ''}`;
    // Re-rendering in place (a logged set, a saved edit) must not yank the user
    // back to the top of a long workout.
    const samePlace = routeKey === lastRouteKey;
    const keepScroll = samePlace ? window.scrollY : 0;

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.route === name));
    });

    $('#screen-title').textContent = route.title;
    clear($('#topbar-actions'));

    const host = clear($('#screen'));
    const node = route.render({ param, actions: $('#topbar-actions') });
    if (node) host.append(node);

    lastRouteKey = routeKey;
    window.scrollTo(0, keepScroll);
  } catch (err) {
    console.error('[liftlog] render failed', err);
    clear($('#screen')).append(
      el('div.empty', {}, [
        el('strong', { text: 'Something broke' }),
        el('div', { text: String(err && err.message || err) }),
      ])
    );
  } finally {
    rendering = false;
  }
}

function wireChrome() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      closeSheet();
      navigate(tab.dataset.route);
    });
  });

  window.addEventListener('hashchange', () => { closeSheet(); render(); });

  // Settings lives behind a gear rather than eating a fifth tab slot.
  $('#topbar').addEventListener('click', (e) => {
    if (e.target.closest('#settings-btn')) renderSettings();
  });
}

async function boot() {
  initSheet();
  rest.init();
  wireChrome();

  try {
    await store.load();
  } catch (err) {
    console.error('[liftlog] load failed', err);
    clear($('#screen')).append(
      el('div.empty', {}, [
        el('strong', { text: 'Could not open the database' }),
        el('div', { text: 'Private browsing blocks local storage. Open LiftLog in a normal tab.' }),
      ])
    );
    return;
  }

  store.subscribe(() => render());
  if (!location.hash) location.replace('#/home');
  render();

  if ('serviceWorker' in navigator) {
    // Only meaningful over https/localhost; silently skipped elsewhere.
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

window.addEventListener('error', (e) => {
  console.error('[liftlog]', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[liftlog] unhandled rejection', e.reason);
  toast('Something went wrong');
});

boot();
