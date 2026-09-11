// Bootstrap + hash router.

import { $, clear, el, initSheet, openSheet, closeSheet, toast, enableCollapsibleSections } from './ui.js';
import { t, setLanguage } from './i18n.js';
import * as store from './store.js';
import * as db from './db.js';
import * as rest from './rest.js';
import * as sync from './sync.js';
import * as cloud from './cloud.js';
import { loadGymLocation, saveGymLocation, currentPosition, nearbyPlannedWorkout } from './gym-location.js';
import { dayKey } from './models.js';
import { DEMO } from './demo.js';

import renderHome from './screens/home.js';
import renderTrain from './screens/train.js';
import renderPlans from './screens/plans.js';
import renderLibrary from './screens/library.js';
import renderCalendar from './screens/calendar.js';
import renderProgress from './screens/progress.js';
import renderNutrition from './screens/nutrition.js';
import renderShare from './screens/share.js';
import renderUsers from './screens/users.js';
import { renderSettings } from './screens/settings.js';
import * as gate from './screens/gate.js';

const INSTALL_HINT_KEY = 'liftlog.installHint.dismissed.v2';
let deferredInstallPrompt = null;
const THEMES = new Set(['ocean', 'violet', 'emerald', 'sunset']);

function applyTheme(theme) {
  document.documentElement.dataset.theme = THEMES.has(theme) ? theme : 'ocean';
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

function isInstalledApp() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function isMobileDevice() {
  const uaMobile = navigator.userAgentData?.mobile;
  if (uaMobile === true) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && matchMedia('(max-width: 820px)').matches)
    || matchMedia('(max-width: 600px)').matches;
}

function installHintDismissed() {
  try { return localStorage.getItem(INSTALL_HINT_KEY) === '1'; } catch { return false; }
}

function dismissInstallHint() {
  try { localStorage.setItem(INSTALL_HINT_KEY, '1'); } catch { /* private mode */ }
}

function showInstallHint({ beforeLogin = false } = {}) {
  if (!isMobileDevice() || isInstalledApp() || installHintDismissed()) return Promise.resolve();
  return new Promise((resolve) => {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const canInstall = Boolean(deferredInstallPrompt);
  const instruction = ios ? t('install.ios')
    : canInstall ? t('install.androidReady') : t('install.androidMenu');
  const body = el('div.install-hint', {}, [
    el('div.install-hint-icon', { 'aria-hidden': 'true', text: ios ? '↥' : '+' }),
    el('p', { text: t('install.intro') }),
    el('div.install-steps', { text: instruction }),
    canInstall ? el('button.btn.primary.full', { onclick: async () => {
      const prompt = deferredInstallPrompt;
      deferredInstallPrompt = null;
      dismissInstallHint();
      closeSheet();
      await prompt.prompt();
      resolve();
    } }, [t('install.button')]) : null,
    el('button.btn.quiet.full', { onclick: () => {
      dismissInstallHint();
      closeSheet();
      resolve();
    } }, [t('install.later')]),
  ]);
  openSheet(t('install.title'), body, {
    onClose: () => { dismissInstallHint(); resolve(); },
    ...(beforeLogin ? { dismissible: false } : {}),
  });
  });
}

function scheduleInstallHint(attempt = 0) {
  setTimeout(() => {
    if (!$('#sheet-host').hidden && attempt < 6) scheduleInstallHint(attempt + 1);
    else if ($('#sheet-host').hidden) showInstallHint();
  }, attempt ? 1500 : 900);
}

/**
 * Five tabs, plus `calendar` and `progress`, which are reached from Home.
 *
 * Five is the ceiling: a sixth was tried, and the tab pushed to the far edge
 * became invisible in use — the calendar was reported missing within a day.
 * So the slots go to what gets opened during a session or a meal, and the two
 * weekly reads live on Home, as visible cards rather than links tucked into a
 * section head.
 */
const ROUTES = {
  home:      { title: 'route.home',      render: renderHome },
  train:     { title: 'route.train',     render: renderTrain },
  plans:     { title: 'route.plans',     render: renderPlans },
  library:   { title: 'route.library',   render: renderLibrary },
  calendar:  { title: 'route.calendar',  render: renderCalendar },
  progress:  { title: 'route.progress',  render: renderProgress },
  nutrition: { title: 'route.nutrition', render: renderNutrition },
  users:     { title: 'route.users',     render: renderUsers },
  // Arrives from a link someone sent; never navigated to from inside the app.
  share:     { title: 'route.share',     render: renderShare },
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

let locked = true;
let cloudMaintenanceStarted = false;
let cloudMaintenanceRunning = false;
let cloudMaintenanceImmediatePending = false;
// Whether going back lands anywhere useful. A screen reached by tapping through
// the app has somewhere to return to; the same screen opened from a bookmark or
// a shared link does not, and there "back" has to mean Home.
let hashSteps = 0;
/** The five routes with a tab. Everything else needs its own way back. */
const TAB_ROUTES = new Set(['home', 'train', 'nutrition', 'plans', 'users']);

let lastBackupWarningAt = 0;
let cloudSetupPrompted = false;
let gymLocationChecking = false;
const announcedPendingDevices = new Set();

export function render() {
  if (locked || !store.state.ready || rendering) return;
  rendering = true;
  try {
    const { name, param } = currentRoute();
    const route = ROUTES[name];
    const routeKey = `${name}/${param || ''}`;
    // Re-rendering in place (a logged set, a saved edit) must not yank the user
    // back to the top of a long workout.
    const samePlace = routeKey === lastRouteKey;
    const screen = $('#screen');
    const keepScroll = samePlace ? screen.scrollTop : 0;

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.route === name));
    });

    $('#screen-title').textContent = t(route.title);
    // Calendar, Progress, the exercise library and a shared plan have no tab to
    // return to, and in an installed PWA there is no browser chrome either, so
    // without this the only way out was a swipe nobody is told about.
    const back = $('#topbar-back');
    back.hidden = TAB_ROUTES.has(name);
    clear($('#topbar-actions'));

    const host = clear(screen);
    // Said on every screen, because a visitor can arrive at any of them from a
    // shared link and the numbers there are not anyone's real training.
    if (DEMO) host.append(el('div.card.tight', {
      style: { borderColor: 'var(--accent)', marginBottom: '12px' },
    }, [
      el('div', { style: { fontWeight: '680' }, text: t('demo.title') }),
      el('div.small.muted', { text: t('demo.body') }),
    ]));
    if (!navigator.onLine) host.append(el('div.card.tight', {
      style: { borderColor: 'var(--warn)', marginBottom: '12px' },
    }, [
      el('div', { style: { fontWeight: '680' }, text: t('offline.title') }),
      el('div.small.muted', { text: t('offline.body') }),
    ]));
    // `fresh` separates arriving at a screen from re-rendering the one you are
    // already on. A screen that remembers something across renders (which day
    // the food log is showing) needs to know the difference: keeping it while
    // you tap around that screen is right, keeping it after you have been to
    // another tab and come back is how you log today's lunch into last Tuesday.
    const node = route.render({ param, actions: $('#topbar-actions'), fresh: !samePlace });
    if (node) {
      enableCollapsibleSections(node, name);
      host.append(node);
    }

    lastRouteKey = routeKey;
    screen.scrollTop = keepScroll;
  } catch (err) {
    console.error('[liftlog] render failed', err);
    clear($('#screen')).append(
      el('div.empty', {}, [
        el('strong', { text: t('app.broke') }),
        el('div', { text: String(err && err.message || err) }),
      ])
    );
  } finally {
    rendering = false;
  }
}

window.addEventListener('online', () => render());
window.addEventListener('offline', () => render());

function wireChrome() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      closeSheet();
      navigate(tab.dataset.route);
    });
  });

  window.addEventListener('hashchange', () => { hashSteps += 1; closeSheet(); render(); });

  $('#topbar-back').addEventListener('click', () => {
    closeSheet();
    if (hashSteps > 0) history.back();
    else navigate('home');
  });

  // Settings lives behind a gear rather than eating a fifth tab slot.
  $('#topbar').addEventListener('click', (e) => {
    if (e.target.closest('#settings-btn')) renderSettings();
  });
}

async function boot() {
  // Before anything can be said out loud, including the two failures below,
  // which happen before there are any settings to read a preference from.
  setLanguage(null);
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
        el('strong', { text: t(blocked ? 'app.blocked.title' : 'app.nodb.title') }),
        el('div', { text: t(blocked ? 'app.blocked.body' : 'app.nodb.body') }),
        blocked
          ? el('button.btn.primary', { style: { marginTop: '14px' }, onclick: () => location.reload() }, [t('app.reload')])
          : null,
      ])
    );
    return;
  }

  // The public preview opens on half a year of sample data rather than an empty
  // log. Only on a device with no training yet, so whatever a visitor logs
  // survives a reload instead of being overwritten by the sample again.
  if (DEMO && !store.state.sessions.length) {
    try {
      const response = await fetch('./showcase-backup.json', { cache: 'no-store' });
      await store.importData(await response.json());
    } catch (err) {
      console.error('[liftlog] preview data failed', err);
    }
  }

  applyTheme(store.state.settings.theme);

  // Installed iOS PWAs sometimes restore a small stale document offset before
  // the dynamic viewport and safe areas have settled. Normalize it once during
  // a real launch; route renders still preserve intentional in-app scrolling.
  $('#screen').scrollTop = 0;
  requestAnimationFrame(() => { $('#screen').scrollTop = 0; });

  // A failed write has to be said out loud where it happens, which is usually
  // the Train screen mid-set, not Home. The store cannot raise UI itself
  // without the data layer importing the view layer, so the notification is
  // wired here instead — one place, every screen.
  let announced = 0;
  store.subscribe(() => {
    // One place syncs the language, so a switch in Settings reaches the tab bar
    // and the rest bar as well as whatever screen is currently mounted.
    setLanguage(store.state.settings.language);
    applyTheme(store.state.settings.theme);
    const problem = store.state.storageError;
    if (problem && problem.at !== announced) {
      announced = problem.at;
      toast(t(problem.quota ? 'app.write.quota' : 'app.write.failed'), 4000);
    }
    render();
  });
  setLanguage(store.state.settings.language);

  // The gate asks once per device. After that it never runs again, so a phone
  // with no reception behaves exactly as it did before any of this existed.
  const browserTest = ['localhost', '127.0.0.1'].includes(location.hostname)
    && new URL(location.href).searchParams.get('e2e') === '1';
  let deviceUnlocked = browserTest || DEMO || await gate.isUnlocked();
  // Repair the state left by older builds after a successful Auth-account
  // deletion: the session was gone but the IndexedDB gate survived, making the
  // deleted account appear to remain inside the app forever. A real offline
  // launch still has its persisted session, so it is unaffected.
  if (deviceUnlocked && !browserTest && !DEMO && !cloud.isSignedIn()) {
    await gate.lock();
    deviceUnlocked = false;
  }
  if (deviceUnlocked) openApp({ skipInstallHint: browserTest || DEMO });
  else {
    // A browser tab must explain installation before it can become the main
    // device. Otherwise the first login silently binds ownership to Safari or
    // Chrome instead of the home-screen app the person meant to use.
    await showInstallHint({ beforeLogin: true });
    await gate.show(openApp);
  }

  // Not under ?e2e=1. The worker caches the app shell, which is exactly what it
  // is for in a gym and exactly wrong on a dev server: an edited file keeps
  // being served from the last install, so a change looks like it did nothing
  // and the obvious conclusion is that the code is broken rather than stale.
  if ('serviceWorker' in navigator && !browserTest && !DEMO) {
    // Only meaningful over https/localhost; silently skipped elsewhere.
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  } else if (browserTest && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((all) => all.forEach((one) => one.unregister())).catch(() => {});
    if (typeof caches !== 'undefined') {
      caches.keys().then((keys) => keys.forEach((key) => caches.delete(key))).catch(() => {});
    }
  }
}

function openApp({ skipInstallHint = false } = {}) {
  locked = false;
  if (!location.hash) location.replace('#/home');
  render();
  if (!skipInstallHint) scheduleInstallHint();
  if (!skipInstallHint) scheduleGymArrivalCheck();

  // The cloud copy is a copy. It must never delay the app opening, never block
  // on a phone with no signal, and never be the reason a screen does not draw,
  // so it runs after the first render and nothing waits on it.
  // The preview has no account to back up to and no community to show.
  if (DEMO) return;
  sync.subscribe(render);
  runCloudMaintenance();
  startCloudMaintenance();
}

/**
 * When connectivity is available, verify access first and then consider an
 * encrypted backup. `onAppOpen` skips byte-identical snapshots, while this
 * coordinator prevents overlapping checks after several browser events.
 */
async function runCloudMaintenance({ immediate = false } = {}) {
  // A routine check may already be downloading when the user finishes a
  // workout. Dropping that second call would turn "save now" into "perhaps in
  // five minutes". Remember only the stronger, immediate request and run it as
  // soon as the current pass releases the single-flight lock.
  if (cloudMaintenanceRunning) {
    if (immediate) cloudMaintenanceImmediatePending = true;
    return;
  }
  if (!navigator.onLine) return;
  cloudMaintenanceRunning = true;
  try {
    if (await gate.recheck() === false) return;
    await handleNotificationAction();
    const result = await sync.onAppOpen({ immediate });
    // Social presence is deliberately best-effort. A missing community patch
    // must never interfere with backups or opening the local training log.
    import('./screens/users.js').then(({ syncPresence }) => syncPresence()).catch(() => {});
    if (sync.state.isOwner) {
      const freshRequests = sync.state.pendingDevices.filter(
        (device) => !announcedPendingDevices.has(device.id));
      sync.state.pendingDevices.forEach((device) => announcedPendingDevices.add(device.id));
      if (freshRequests.length) toast(t('cloud.pendingAlert'), 5000);
    }
    if (!cloudSetupPrompted && sync.state.signedIn && sync.state.profile
        && !sync.state.profile.recovery_wrap) {
      cloudSetupPrompted = true;
      const account = await import('./screens/account.js');
      account.promptCloudSetup();
    }
    const quiet = ['AUTH', 'DISABLED', 'READ_ONLY', 'BUSY', 'OFFLINE'];
    if (result && !result.ok && !quiet.includes(result.code)
        && Date.now() - lastBackupWarningAt > 6 * 60 * 60 * 1000) {
      lastBackupWarningAt = Date.now();
      toast(t('cloud.autoBackupFailed'), 4200);
    }
  } catch (err) {
    console.warn('[liftlog] cloud maintenance', err);
  } finally {
    cloudMaintenanceRunning = false;
    if (cloudMaintenanceImmediatePending) {
      cloudMaintenanceImmediatePending = false;
      // Leave the current promise and its finally block before starting the
      // queued pass. This also prevents a synchronous failure from recursing.
      queueMicrotask(() => runCloudMaintenance({ immediate: true }));
    }
  }
}

async function handleNotificationAction() {
  const url = new URL(location.href);
  const action = url.searchParams.get('creatine');
  if (action !== 'taken' && action !== 'snooze') return;
  url.searchParams.delete('creatine');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  try {
    await cloud.answerCreatineReminder(action);
    if (action === 'taken') await store.setSetting('creatineLastTakenDay', dayKey());
    toast(t(action === 'taken' ? 'settings.creatineTaken' : 'settings.creatineSnoozed'));
  } catch { toast(t('settings.notificationsFailed')); }
}

/**
 * Back up now rather than at the next routine interval.
 *
 * For the two moments where waiting is the wrong answer: a workout that has
 * just been saved, and the app being put away. Both are exactly when a phone
 * is most likely to be closed and not opened again for days.
 */
export function flushBackup() {
  runCloudMaintenance({ immediate: true });
}

/** Pull an active workout from another device before creating a second one. */
export async function startWorkout(options = {}) {
  if (navigator.onLine && cloud.isSignedIn()) await sync.onAppOpen({ immediate: true });
  // The pull may have revealed a workout started on another device while this
  // launcher was already visible. Never create a second session after that.
  const existing = store.activeSession();
  if (existing) return existing;
  const session = await store.startSession(options);
  flushBackup();
  return session;
}

export async function duplicateWorkout(source) {
  if (navigator.onLine && cloud.isSignedIn()) await sync.onAppOpen({ immediate: true });
  const existing = store.activeSession();
  if (existing) return null;
  const session = await store.duplicateSession(source);
  flushBackup();
  return session;
}

function startCloudMaintenance() {
  if (cloudMaintenanceStarted) return;
  cloudMaintenanceStarted = true;

  // `online` is the portable signal browsers expose when Wi-Fi or another
  // connection returns. Mobile browsers do not reliably reveal whether that
  // connection is specifically Wi-Fi.
  window.addEventListener('online', () => runCloudMaintenance());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') runCloudMaintenance();
    if (document.visibilityState === 'visible') scheduleGymArrivalCheck();
    // Going away is the last chance to save what this session produced, and on
    // a phone "away" usually means hours. iOS gives a backgrounding page a
    // short moment rather than a guarantee, so this is an extra attempt and
    // never the only one: the launch after it retries anything that was cut off.
    else flushBackup();
  });
  // Safari can go straight to `pagehide` without a hidden visibility change
  // when the app is swiped away.
  window.addEventListener('pagehide', flushBackup);

  // Timers may be paused while a PWA is in the background; the online and
  // visibility handlers above catch up when it becomes active again.
  // Device removal is an access decision, so a visible online app checks it
  // promptly instead of waiting for the next backup interval.
  setInterval(() => {
    if (document.visibilityState === 'visible') runCloudMaintenance();
  }, 60 * 1000);
}

function scheduleGymArrivalCheck(attempt = 0) {
  setTimeout(() => {
    if (!$('#sheet-host').hidden && attempt < 4) scheduleGymArrivalCheck(attempt + 1);
    else if ($('#sheet-host').hidden) checkGymArrival();
  }, attempt ? 1400 : 1800);
}

async function checkGymArrival() {
  const config = loadGymLocation();
  const plan = store.activePlan();
  if (gymLocationChecking || !config?.enabled || !plan || store.activeSession()) return;
  gymLocationChecking = true;
  try {
    const position = await currentPosition();
    const match = nearbyPlannedWorkout(config, position, plan, store.state.sessions);
    if (!match || !$('#sheet-host').hidden) return;
    saveGymLocation({ lastPromptDay: match.dayKey });
    openSheet(t('gym.arrivedTitle'), el('div', {}, [
      el('div.gym-arrival-mark', { 'aria-hidden': 'true' }, ['⌖']),
      el('h3', { style: { textAlign: 'center', margin: '5px 0 6px' }, text: match.day.name }),
      el('div.muted', { style: { textAlign: 'center', marginBottom: '16px' },
        text: t('gym.arrivedBody', { n: Math.round(match.distance) }) }),
      el('button.btn.primary.full', { onclick: async () => {
        closeSheet();
        const session = await startWorkout({ planId: match.plan.id, dayId: match.day.id });
        if (session) navigate('train');
      } }, [t('gym.startToday')]),
      el('button.btn.ghost.full', { style: { marginTop: '8px' }, onclick: closeSheet }, [t('gym.notNow')]),
    ]));
  } catch { /* Location refusal or a weak signal should never block the app. */ }
  finally { gymLocationChecking = false; }
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
  toast(t('app.error.generic'));
});

boot();
