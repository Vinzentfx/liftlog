// Start und Hash-Router.

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
  try { localStorage.setItem(INSTALL_HINT_KEY, '1'); } catch { /* privater Modus */ }
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
 * Fünf Tabs, dazu `calendar` und `progress`, die man über Home erreicht.
 *
 * Fünf sind die Obergrenze. Ein sechster wurde ausprobiert, und der Tab ganz am Rand
 * war beim Benutzen unsichtbar, schon nach einem Tag wurde der Kalender als fehlend
 * gemeldet. Die Plätze gehen also an das, was man während eines Trainings oder einer
 * Mahlzeit öffnet, und die beiden wöchentlichen Ansichten stehen auf Home, als
 * sichtbare Karten und nicht als Links in einer Abschnittsüberschrift.
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
  // Kommt über einen Link, den jemand geschickt hat, innerhalb der App kommt man nie dorthin.
  share:     { title: 'route.share',     render: renderShare },
};

/** Aus location.hash gelesen: `#/route/param`. */
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
// Ob Zurück irgendwo Sinnvolles landet. Ein Screen, zu dem man sich in der App
// durchgetippt hat, hat einen Weg zurück. Derselbe Screen aus einem Lesezeichen oder
// einem geteilten Link hat keinen, dort muss "zurück" Home heißen.
let hashSteps = 0;
/** Die fünf Routen mit Tab. Alles andere braucht einen eigenen Weg zurück. */
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
    // Neuzeichnen an Ort und Stelle (ein eingetragener Satz, eine gespeicherte Änderung)
    // darf einen nicht an den Anfang eines langen Trainings zurückreißen.
    const samePlace = routeKey === lastRouteKey;
    const screen = $('#screen');
    const keepScroll = samePlace ? screen.scrollTop : 0;

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.route === name));
    });

    $('#screen-title').textContent = t(route.title);
    // Kalender, Fortschritt, die Übungsbibliothek und ein geteilter Plan haben keinen
    // Tab zum Zurückkehren, und in einer installierten PWA gibt es auch keine
    // Browserleiste. Ohne das hier war der einzige Weg raus ein Wischen, von dem niemand weiß.
    const back = $('#topbar-back');
    back.hidden = TAB_ROUTES.has(name);
    clear($('#topbar-actions'));

    const host = clear(screen);
    // Steht auf jedem Screen, weil ein Besucher über einen geteilten Link auf jedem
    // landen kann und die Zahlen dort nicht das echte Training von jemandem sind.
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
    // `fresh` unterscheidet das Ankommen auf einem Screen vom Neuzeichnen des aktuellen.
    // Ein Screen, der sich etwas über das Neuzeichnen hinaus merkt (welchen Tag das
    // Essenslog zeigt), muss den Unterschied kennen. Es beim Herumtippen auf diesem
    // Screen zu behalten ist richtig. Es zu behalten, nachdem man auf einem anderen Tab
    // war und zurückkommt, trägt das heutige Mittagessen beim letzten Dienstag ein.
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

  // Die Einstellungen liegen hinter einem Zahnrad, statt einen fünften Tab zu belegen.
  $('#topbar').addEventListener('click', (e) => {
    if (e.target.closest('#settings-btn')) renderSettings();
  });
}

async function boot() {
  // Bevor irgendetwas laut gesagt werden kann, auch die zwei Fehler unten. Die passieren,
  // bevor es Einstellungen gibt, aus denen man eine Vorliebe lesen könnte.
  setLanguage(null);
  initSheet();
  rest.init();
  wireChrome();

  // Abschicken und vergessen: die App wartet mit dem Zeichnen nicht auf eine
  // Speicherberechtigung, und wenn sie abgelehnt wird, lässt sich ohnehin nichts tun.
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

  // Die öffentliche Vorschau öffnet mit einem halben Jahr Beispieldaten statt einem
  // leeren Log. Geladen wird auf einem Gerät ohne Trainings und wieder, sobald eine neuere
  // Fassung veröffentlicht ist, solange das Gerät nichts als Beispieldaten hat. Vorher kam die
  // Datei nur auf ein leeres Gerät, und wer die Vorschau einmal geöffnet hatte, sah für immer
  // den alten Stand, auch nachdem die Beispieldaten repariert waren.
  //
  // Was ein Besucher selbst einträgt, bekommt eine ID aus db.uid, also Zeitstempel und Zufall.
  // Die Einträge aus tools/build_showcase.mjs heißen "s_sc0a1b" und so weiter, und so eine ID
  // vergibt die App nie. Ist etwas Eigenes dabei, bleibt alles, wie es ist, und übersteht ein
  // Neuladen, statt vom Beispiel überschrieben zu werden.
  if (DEMO) {
    const SHOWCASE_KEY = 'liftlog.showcaseExportedAt';
    const { sessions, bodyweight, meals, plans, foods, templates } = store.state;
    const leer = !sessions.length;
    const nurBeispiel = [...sessions, ...bodyweight, ...meals, ...plans, ...foods, ...templates]
      .every((row) => /^[a-z]+_sc[0-9a-z]{4,}$/.test(String(row?.id)));
    if (leer || nurBeispiel) {
      try {
        // no-cache fragt nur nach, ob sich die Datei geändert hat, statt sie jedes Mal ganz zu laden.
        const response = await fetch('./showcase-backup.json', { cache: 'no-cache' });
        const payload = await response.json();
        let geladen = null;
        try { geladen = localStorage.getItem(SHOWCASE_KEY); } catch { /* privater Modus */ }
        if (leer || geladen !== payload.exportedAt) {
          await store.importData(payload);
          try { localStorage.setItem(SHOWCASE_KEY, payload.exportedAt); } catch { /* privater Modus */ }
        }
      } catch (err) {
        console.error('[liftlog] preview data failed', err);
      }
    }
  }

  applyTheme(store.state.settings.theme);

  // Installierte iOS-PWAs stellen manchmal einen kleinen, veralteten Versatz des
  // Dokuments wieder her, bevor sich das dynamische Fenster und die sicheren Ränder
  // gesetzt haben. Einmal beim echten Start zurücksetzen, gewolltes Scrollen in der App
  // bleibt beim Neuzeichnen erhalten.
  $('#screen').scrollTop = 0;
  requestAnimationFrame(() => { $('#screen').scrollTop = 0; });

  // Ein fehlgeschlagenes Speichern muss dort laut gesagt werden, wo es passiert, und
  // das ist meistens der Trainieren-Screen mitten im Satz, nicht Home. Der Store kann
  // selbst keine Oberfläche anzeigen, ohne dass die Datenschicht die Ansicht importiert.
  // Die Meldung ist deshalb hier verdrahtet, an einer Stelle für jeden Screen.
  let announced = 0;
  store.subscribe(() => {
    // Die Sprache wird an einer Stelle abgeglichen, ein Wechsel in den Einstellungen
    // erreicht also Tab-Leiste und Pausenleiste genauso wie den gerade offenen Screen.
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

  // Die Sperre fragt einmal pro Gerät. Danach läuft sie nie wieder, ein Handy ohne
  // Empfang verhält sich also genau wie früher, bevor es das alles gab.
  const browserTest = ['localhost', '127.0.0.1'].includes(location.hostname)
    && new URL(location.href).searchParams.get('e2e') === '1';
  let deviceUnlocked = browserTest || DEMO || await gate.isUnlocked();
  // Den Zustand reparieren, den ältere Versionen nach dem erfolgreichen Löschen eines
  // Auth-Kontos hinterlassen haben: die Sitzung war weg, aber die Sperre in IndexedDB
  // blieb, und das gelöschte Konto schien für immer in der App zu stecken. Ein echter
  // Start ohne Netz hat seine gespeicherte Sitzung noch und ist nicht betroffen.
  if (deviceUnlocked && !browserTest && !DEMO && !cloud.isSignedIn()) {
    await gate.lock();
    deviceUnlocked = false;
  }
  if (deviceUnlocked) openApp({ skipInstallHint: browserTest || DEMO });
  else {
    // Ein Browser-Tab muss erst die Installation erklären, bevor er Hauptgerät werden
    // kann. Sonst bindet der erste Login den Besitz still an Safari oder Chrome statt an
    // die App auf dem Homescreen, die gemeint war.
    await showInstallHint({ beforeLogin: true });
    await gate.show(openApp);
  }

  // Nicht unter ?e2e=1. Der Worker cacht die App-Hülle, genau richtig im Studio und
  // genau falsch auf einem Entwicklungsserver: eine geänderte Datei kommt weiter aus der
  // letzten Installation, eine Änderung scheint nichts zu bewirken, und man hält den
  // Code für kaputt, obwohl er nur alt ist.
  if ('serviceWorker' in navigator && !browserTest && !DEMO) {
    // Ergibt nur über https oder localhost Sinn, woanders wird es still übersprungen.
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

  // Die Cloud-Kopie ist eine Kopie. Sie darf das Öffnen der App nie verzögern, auf einem
  // Handy ohne Empfang nie blockieren und nie der Grund sein, dass ein Screen nicht
  // zeichnet. Sie läuft also nach dem ersten Zeichnen, und nichts wartet auf sie.
  // Die Vorschau hat kein Konto zum Sichern und keine Gemeinschaft zum Zeigen.
  if (DEMO) return;
  sync.subscribe(render);
  runCloudMaintenance();
  startCloudMaintenance();
}

/**
 * Bei Verbindung erst den Zugang prüfen, dann über eine verschlüsselte Sicherung
 * nachdenken. `onAppOpen` überspringt byte-gleiche Stände, und diese Koordination
 * verhindert, dass sich nach mehreren Browser-Ereignissen Prüfungen überlappen.
 */
async function runCloudMaintenance({ immediate = false } = {}) {
  // Eine normale Prüfung lädt vielleicht gerade herunter, wenn ein Training fertig ist.
  // Den zweiten Aufruf fallen zu lassen würde aus "jetzt sichern" ein "vielleicht in fünf
  // Minuten" machen. Nur die stärkere, sofortige Anfrage merken und ausführen, sobald der
  // laufende Durchgang die Sperre freigibt.
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
    // Anwesenheit im sozialen Bereich ist bewusst nur ein Versuch. Ein fehlender Patch
    // für die Gemeinschaft darf nie Sicherungen oder das Öffnen des lokalen Logs stören.
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
      // Erst das aktuelle Promise samt finally verlassen, dann den wartenden Durchgang
      // starten. Das verhindert auch, dass ein synchroner Fehler in eine Rekursion läuft.
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
 * Jetzt sichern statt beim nächsten normalen Durchgang.
 *
 * Für die zwei Momente, in denen Warten die falsche Antwort ist: ein Training wurde
 * gerade gespeichert, und die App wird weggelegt. In beiden Momenten wird ein Handy am
 * ehesten zugemacht und tagelang nicht mehr geöffnet.
 */
export function flushBackup() {
  runCloudMaintenance({ immediate: true });
}

/** Ein laufendes Training von einem anderen Gerät holen, bevor ein zweites entsteht. */
export async function startWorkout(options = {}) {
  if (navigator.onLine && cloud.isSignedIn()) await sync.onAppOpen({ immediate: true });
  // Das Holen hat vielleicht ein Training gezeigt, das auf einem anderen Gerät gestartet
  // wurde, während dieser Startbildschirm schon zu sehen war. Danach nie eine zweite Einheit anlegen.
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

  // `online` ist das Signal, das Browser überall geben, wenn WLAN oder eine andere
  // Verbindung zurückkommt. Mobile Browser sagen nicht verlässlich, ob es genau WLAN ist.
  window.addEventListener('online', () => runCloudMaintenance());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') runCloudMaintenance();
    if (document.visibilityState === 'visible') scheduleGymArrivalCheck();
    // Weggehen ist die letzte Gelegenheit, zu sichern, was diese Sitzung erzeugt hat, und
    // auf dem Handy heißt "weg" meistens Stunden. iOS gibt einer Seite beim Wechsel in
    // den Hintergrund einen kurzen Moment und keine Garantie, das hier ist also ein
    // zusätzlicher Versuch und nie der einzige. Der nächste Start wiederholt, was abgeschnitten wurde.
    else flushBackup();
  });
  // Safari kann direkt zu `pagehide` springen, ohne vorher unsichtbar zu werden, wenn
  // die App weggewischt wird.
  window.addEventListener('pagehide', flushBackup);

  // Timer können pausieren, solange eine PWA im Hintergrund ist. Die Handler für online
  // und Sichtbarkeit oben holen das nach, sobald sie wieder aktiv ist.
  // Ein Gerät zu entfernen ist eine Zugangsfrage, eine sichtbare App mit Netz prüft das
  // also gleich und wartet nicht auf die nächste Sicherung.
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
  } catch { /* Kein Standort oder schwacher Empfang dürfen die App nie blockieren. */ }
  finally { gymLocationChecking = false; }
}

window.addEventListener('error', (e) => {
  console.error('[liftlog]', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[liftlog] unhandled rejection', e.reason);
  // Die meisten Handler lösen eine Store-Aktion aus, ohne zu warten, und zwar mit
  // Absicht, damit ein Tipp nie auf die Festplatte wartet. Ein fehlgeschlagenes
  // Schreiben landet deshalb auch hier und nicht nur in store.state.storageError, und
  // der Abonnent oben hat schon etwas Genaues dazu gesagt. Zwei Toasts für ein Problem,
  // der ungenauere als zweiter, sind schlechter als einer.
  const problem = store.state.storageError;
  if (problem && Date.now() - problem.at < 2000) return;
  toast(t('app.error.generic'));
});

boot();
