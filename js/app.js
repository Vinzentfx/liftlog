// Bootstrap + hash router.

import { $, clear, el, initSheet, closeSheet, toast } from './ui.js';
import * as store from './store.js';
import * as db from './db.js';
import * as rest from './rest.js';

import renderHome from './screens/home.js';
import renderTrain from './screens/train.js';
import renderPlans from './screens/plans.js';
import renderLibrary from './screens/library.js';
import renderCalendar from './screens/calendar.js';
import renderProgress from './screens/progress.js';
import renderNutrition from './screens/nutrition.js';
import renderShare from './screens/share.js';
import { renderSettings } from './screens/settings.js';

/**
 * Five tabs plus `progress` and `nutrition`, both reachable from Home but
 * without a tab slot — five is already the most a thumb wants to aim at.
 */
const ROUTES = {
  home:      { title: 'Home',      render: renderHome },
  train:     { title: 'Train',     render: renderTrain },
  plans:     { title: 'Plans',     render: renderPlans },
  library:   { title: 'Library',   render: renderLibrary },
  calendar:  { title: 'Calendar',  render: renderCalendar },
  progress:  { title: 'Progress',  render: renderProgress },
  nutrition: { title: 'Nutrition', render: renderNutrition },
  // Arrives from a link someone sent; never navigated to from inside the app.
  share:     { title: 'Shared plan', render: renderShare },
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

  // Fire and forget — the app must not wait on a storage permission to render,
  // and there is nothing useful to do if it is refused.
  db.requestPersistence().then((state) => {
    if (state !== 'granted') console.info(`[liftlog] persistent storage: ${state}`);
  });

  try {
    await store.load();
  } catch (err) {
    console.error('[liftlog] load failed', err);
    const blocked = err && err.message === 'BLOCKED';
    clear($('#screen')).append(
      el('div.empty', {}, [
        el('strong', { text: blocked ? 'LiftLog is open somewhere else' : 'Could not open the database' }),
        el('div', {
          text: blocked
            ? 'This version needs to update the database, and another tab or window still has the old one open. Close the others and reload.'
            : 'Private browsing blocks local storage. Open LiftLog in a normal tab.',
        }),
        blocked
          ? el('button.btn.primary', { style: { marginTop: '14px' }, onclick: () => location.reload() }, ['Reload'])
          : null,
      ])
    );
    return;
  }

  // A failed write has to be said out loud where it happens, which is usually
  // the Train screen mid-set, not Home. The store cannot raise UI itself
  // without the data layer importing the view layer, so the notification is
  // wired here instead — one place, every screen.
  let announced = 0;
  store.subscribe(() => {
    const problem = store.state.storageError;
    if (problem && problem.at !== announced) {
      announced = problem.at;
      toast(problem.quota
        ? 'Not saved — the phone is out of storage'
        : 'Not saved — that entry did not reach the disk', 4000);
    }
    render();
  });
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
  // Most UI handlers fire a store action without awaiting it — deliberately, so
  // a tap never waits on a disk write. A failed write therefore lands here as
  // well as in store.state.storageError, and the subscriber above has already
  // said something specific about it. Two toasts for one problem, the vaguer
  // one second, is worse than one.
  const problem = store.state.storageError;
  if (problem && Date.now() - problem.at < 2000) return;
  toast('Something went wrong');
});

boot();
