// Die Einladungssperre: bevor die App aufgeht, braucht man ein Konto mit Code.
//
// Was die ehrlich wert ist, einmal gesagt, damit sich niemand auf mehr verlässt:
// die App ist eine statische Seite in einem öffentlichen Repo, und jeder Screen läuft
// auf dem Gerät. Wer an der Sperre vorbei will, öffnet die Entwicklertools und setzt
// eine Markierung. Anders geht es nicht, ohne dass die App den Server zum
// Funktionieren braucht, und dann ginge sie im Kellerstudio nicht mehr.
//
// Was sie wirklich bringt: niemand stolpert zufällig hinein und benutzt sie, und
// ohne Code erreicht nichts den Server. Eine Tür, kein Tresor.
//
// Die Regel, die wichtiger ist als die Sperre selbst: SIE FRAGT EINMAL. Ist ein
// Gerät einmal entsperrt, bleibt es das, offline und unbegrenzt. Die eine Stelle, an
// der die App nie versagen darf, ist mitten im Satz in einem Keller ohne Empfang,
// und eine Anmeldeprüfung bei jedem Start würde genau dort versagen.
//
// Die Markierung liegt im Store `keys`, dem einzigen, den eine Wiederherstellung in
// Ruhe lässt und der nie in einer exportierten Sicherung auftaucht. Sie übersteht
// also das Zurückspielen einer Sicherung und reist darin nicht auf ein fremdes Handy.

import { el, clear, $, toast, authField, confirmSheet } from '../ui.js';
import * as db from '../db.js';
import * as cloud from '../cloud.js';
import * as sync from '../sync.js';
import * as store from '../store.js';
import { doExport } from './settings.js';
import { t } from '../i18n.js';

const ROW = 'gate';
let waitingTimer = null;

function stopWaiting() {
  clearTimeout(waitingTimer);
  waitingTimer = null;
}

export async function isUnlocked() {
  const row = await db.get(db.STORES.keys, ROW);
  return !!row?.unlocked;
}

async function unlock() {
  await db.put(db.STORES.keys, { id: ROW, unlocked: true, at: Date.now() });
}

export async function lock() {
  await db.remove(db.STORES.keys, ROW);
}

/**
 * Bei Verbindung prüfen, ob es das Konto noch gibt.
 *
 * Das ist das ganze Konzept zum Entziehen des Zugangs: die Profilzeile von jemandem
 * löschen, und seine App sperrt sich beim nächsten Empfang. Offline passiert mit
 * Absicht gar nichts, und jeder Fehler außer "das Profil ist weg" gilt als schlechte
 * Verbindung und nicht als Grund, jemanden aus seinem eigenen Log auszusperren.
 */
export async function recheck() {
  if (!cloud.isSignedIn()) return true;

  const revokeLocalAccess = async () => {
    await lock();
    await cloud.signOut();
    location.reload();
    return false;
  };

  try {
    if (!(await cloud.hasActiveAccess())) {
      return revokeLocalAccess();
    }
    const deviceStatus = await sync.currentDeviceStatus();
    if (deviceStatus === 'revoked') return revokeLocalAccess();
    return true;
  } catch (err) {
    // Manche Supabase-Installationen brauchen kurz, bis der Schema-Cache eine neu
    // bereitgestellte RPC kennt. RLS versteckt ein entzogenes Profil trotzdem, ein
    // erfolgreiches Lesen als Rückfall ist also ein zweites verlässliches Signal. Ein
    // echter Netzwerkfehler sperrt ein Offline-Trainingslog weiterhin nie.
    if (err?.code === 'OFFLINE') return null;
    try {
      if ((await cloud.getProfile()) === null) return revokeLocalAccess();
    } catch { /* Server nicht erreichbar: Offline-Zugang bleibt */ }
    return null;
  }
}

/* ================================ der Screen ================================ */

/** Legt sich über alles und ruft `onOpen` auf, sobald das Gerät entsperrt ist. */
export async function show(onOpen) {
  document.getElementById('tabbar').hidden = true;
  $('#screen-title').textContent = 'LiftLog';
  clear($('#topbar-actions'));

  const host = clear($('#screen'));
  const pane = el('div', { style: { maxWidth: '460px', margin: '0 auto' } });
  host.append(pane);

  const done = async () => {
    stopWaiting();
    await unlock();
    document.getElementById('tabbar').hidden = false;
    onOpen();
  };

  if (cloud.isSignedIn()) {
    try {
      await sync.load();
      const profile = sync.state.profile;
      const deviceStatus = await sync.currentDeviceStatus();
      if (profile?.owner_device) {
        if (deviceStatus === 'approved') return done();
        if (deviceStatus === 'pending') return paintWaiting(pane, done);
        if (deviceStatus === 'unregistered' || deviceStatus === 'missing') {
          await sync.requestAccess();
          return paintWaiting(pane, done);
        }
        if (deviceStatus === 'revoked') await cloud.signOut();
      }
    } catch (err) {
      if (err?.code === 'DEVICE_REVOKED') await cloud.signOut();
      // Die normale Anmeldeauswahl zeigen, wenn die Sitzung sich nicht fortsetzen lässt.
    }
  }
  paintChoice(pane, done);
}

/**
 * `el()` lässt ein null-Kind weg, `replaceChildren()` macht daraus den Text "null".
 *
 * Genau das stand bei einem Gerät ohne Trainings unter den Knöpfen der Sperre, weil
 * das Angebot zum Exportieren unten dann null zurückgibt. Alles, was die Sperre
 * zeichnet, geht hier durch, damit man die Falle an einer Stelle umgeht und nicht an vieren.
 */
function paint(pane, ...children) {
  pane.replaceChildren(...children.filter(Boolean));
}

function paintChoice(pane, done) {
  stopWaiting();
  paint(pane,
    el('div.gate-hero', {}, [
      el('div.gate-mark', { 'aria-hidden': 'true' }, ['L']),
      el('div.gate-eyebrow', { text: t('gate.access') }),
      el('h2', { text: t('gate.title') }),
      el('div.gate-lead', { text: t('gate.intro') }),
    ]),
    el('div.gate-choices', {}, [
      el('button.gate-choice.primary', { onclick: () => paintSignUp(pane, done) }, [
        el('span.gate-choice-copy', {}, [
          el('strong', { text: t('gate.newAccount') }),
          el('small', { text: t('gate.newAccountSub') }),
        ]),
        el('span.gate-arrow', { text: '›', 'aria-hidden': 'true' }),
      ]),
      el('button.gate-choice', { onclick: () => paintSignIn(pane, done) }, [
        el('span.gate-choice-copy', {}, [
          el('strong', { text: t('gate.haveAccount') }),
          el('small', { text: t('gate.haveAccountSub') }),
        ]),
        el('span.gate-arrow', { text: '›', 'aria-hidden': 'true' }),
      ]),
    ]),
    el('div.gate-trust', {}, [
      el('span', { text: '✓', 'aria-hidden': 'true' }),
      el('div', { text: t('gate.whyNote') }),
    ]),
    lockedOutExport(),
  );
}

function paintWaiting(pane, done) {
  stopWaiting();
  let checking = false;
  const status = el('div.small.faint', { text: t('gate.waitingAutomatic') });

  const check = async () => {
    if (checking || !navigator.onLine) return;
    checking = true;
    try {
      const deviceStatus = await sync.currentDeviceStatus();
      if (deviceStatus === 'approved') {
        await sync.load();
        return done();
      }
      if (deviceStatus === 'revoked') {
        stopWaiting();
        await cloud.signOut();
        paintChoice(pane, done);
        toast(t('cloud.err.DEVICE_REVOKED'), 4200);
        return;
      }
      status.textContent = t('gate.waitingStill');
    } catch { status.textContent = t('gate.waitingOffline'); }
    finally { checking = false; }
  };

  paint(pane,
    el('div.gate-hero', {}, [
      el('div.gate-mark.waiting', { 'aria-hidden': 'true' }, ['…']),
      el('div.gate-eyebrow', { text: t('gate.waitingEyebrow') }),
      el('h2', { text: t('gate.waitingTitle') }),
      el('div.gate-lead', { text: t('gate.waitingIntro') }),
    ]),
    el('div.gate-trust', {}, [
      el('span', { text: '1', 'aria-hidden': 'true' }),
      el('div', { text: t('gate.waitingStepOne') }),
    ]),
    el('div.gate-trust', {}, [
      el('span', { text: '2', 'aria-hidden': 'true' }),
      el('div', { text: t('gate.waitingStepTwo') }),
    ]),
    el('button.btn.primary.full', { style: { marginTop: '16px' }, onclick: check }, [t('gate.checkAgain')]),
    status,
    el('button.btn.quiet.full', { onclick: async () => {
      stopWaiting();
      await cloud.signOut();
      paintChoice(pane, done);
    } }, [t('cloud.signOut')]),
  );

  const poll = async () => {
    await check();
    if (waitingTimer !== null) waitingTimer = setTimeout(poll, 10 * 1000);
  };
  waitingTimer = setTimeout(poll, 10 * 1000);
}

/**
 * Ein Ausweg für jemanden, der ausgesperrt ist, aber ein Log auf diesem Gerät hat.
 *
 * Den Zugang zu entziehen soll jemanden von der App fernhalten, nicht sein eigenes
 * Training als Geisel nehmen: die Einheiten liegen in IndexedDB auf seinem Handy und
 * gehören ihm. Wer will, liest sie ohnehin mit den Entwicklertools aus, eine
 * Weigerung würde also nur die treffen, die nicht darauf kämen. Wird nur gezeigt,
 * wenn es wirklich etwas zu exportieren gibt.
 */
function lockedOutExport() {
  if (!store.state.sessions.length) return null;
  return el('div', { style: { marginTop: '22px' } }, [
    el('div.small.faint', { text: t('gate.lockedOut') }),
    el('button.btn.ghost.full.sm', {
      style: { marginTop: '8px' },
      onclick: () => doExport(),
    }, [t('settings.exportBackup')]),
  ]);
}

function backLink(pane, done) {
  return el('button.gate-back', {
    onclick: () => paintChoice(pane, done),
  }, [`‹ ${t('common.back')}`]);
}

function fields() {
  const email = el('input', {
    type: 'email', inputmode: 'email', autocomplete: 'email',
    autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
    placeholder: 'name@example.com',
  });
  const password = el('input', { type: 'password', autocomplete: 'current-password' });
  const status = el('div.small', { style: { marginTop: '10px' } });
  return { email, password, status };
}

const problem = (status, err) => {
  status.style.color = 'var(--warn)';
  status.textContent = t(`cloud.err.${err.code}`, { code: err.code || 'SERVER' });
};

function paintSignUp(pane, done) {
  const { email, password, status } = fields();
  password.autocomplete = 'new-password';
  const code = el('input', {
    type: 'text', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
    placeholder: 'ABCD-2026',
  });
  const legal = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });

  async function go() {
    if (!email.value.trim().includes('@')) { toast(t('cloud.needEmail')); email.focus(); return; }
    if ((password.value || '').length < 8) { toast(t('cloud.needPassword')); password.focus(); return; }
    if (!code.value.trim()) { toast(t('cloud.needInviteCode')); code.focus(); return; }
    if (!legal.checked) { toast(t('legal.mustAccept')); legal.focus(); return; }

    status.style.color = 'var(--text-faint)';
    status.textContent = t('cloud.working');
    try {
      await cloud.signUp(email.value.trim(), password.value, { persist: false });
      // Die Einladung ist das, was die Tür wirklich öffnet. Ein Konto ohne kann sich
      // anmelden und nichts tun, weder hier noch auf dem Server.
      await cloud.claimInvite(code.value);
      if (!(await cloud.hasActiveAccess())) {
        throw Object.assign(new Error('ACCESS_SETUP_FAILED'), { code: 'ACCESS_SETUP_FAILED' });
      }
      cloud.persistSession();
      await sync.load();
      const profile = await cloud.getProfile();
      if (!profile) {
        throw Object.assign(new Error('ACCESS_SETUP_FAILED'), { code: 'ACCESS_SETUP_FAILED' });
      }
      await done();
      toast(t('gate.welcome'), 3000);
    } catch (err) {
      if (err?.code === 'DEVICE_REVOKED') await cloud.signOut();
      problem(status, err);
    }
  }

  paint(pane,
    backLink(pane, done),
    el('div.gate-form-intro', { text: t('gate.signUpIntro') }),
    el('div', { style: { marginTop: '16px' } }, [
      authField(t('cloud.email'), email, { icon: 'email' }),
      authField(t('cloud.password'), password, { icon: 'lock' }),
      authField(t('cloud.inviteCode'), code, { icon: 'key' }),
    ]),
    el('label.field', { style: { marginTop: '14px' } }, [
      el('div.row', { style: { gap: '10px', alignItems: 'flex-start' } }, [
        legal,
        el('span.grow.small', {}, [
          t('legal.acceptPrefix') + ' ',
          el('a', { href: './privacy.html', target: '_blank', rel: 'noopener' }, [t('legal.privacy')]),
          ' ' + t('legal.and') + ' ',
          el('a', { href: './legal.html', target: '_blank', rel: 'noopener' }, [t('legal.terms')]),
          '. ', t('legal.age'),
        ]),
      ]),
    ]),
    el('button.btn.primary.full', { onclick: go }, [t('gate.start')]),
    status,
    el('div.small.faint', { style: { marginTop: '16px' }, text: t('gate.backupSeparate') }),
  );
}

function paintSignIn(pane, done) {
  const { email, password, status } = fields();

  async function go() {
    status.style.color = 'var(--text-faint)';
    status.textContent = t('cloud.working');
    try {
      await cloud.signIn(email.value.trim(), password.value, { persist: false });
      if (!(await cloud.hasActiveAccess())) {
        if (await sync.canDeleteCloudData()) paintRevoked(pane, done);
        else {
          await cloud.signOut();
          problem(status, { code: 'ACCESS_REVOKED' });
        }
        return;
      }
      cloud.persistSession();
      const profile = await cloud.getProfile();
      if (!profile) {
        // Angemeldet, aber dieses Konto hat nie einen Code eingelöst. Sagen, welches
        // der beiden Dinge fehlt, statt "falsches Passwort".
        problem(status, { code: 'DENIED' });
        return;
      }
      await sync.load();
      let requestedDevice = false;
      if (profile.owner_device) {
        const deviceStatus = await sync.currentDeviceStatus();
        if (deviceStatus === 'revoked') {
          throw Object.assign(new Error('DEVICE_REVOKED'), { code: 'DEVICE_REVOKED' });
        }
        if (deviceStatus === 'unregistered' || deviceStatus === 'missing') {
          await sync.requestAccess();
          requestedDevice = true;
        }
        if (requestedDevice || deviceStatus === 'pending') {
          paintWaiting(pane, done);
          if (requestedDevice) toast(t('cloud.requestSent'), 3200);
          return;
        }
      }
      await done();
      toast(t('gate.welcomeBack'), 2600);
    } catch (err) {
      if (err?.code === 'DEVICE_REVOKED') await cloud.signOut();
      problem(status, err);
    }
  }

  paint(pane,
    backLink(pane, done),
    el('div.gate-form-intro', { text: t('gate.signInIntro') }),
    el('div', { style: { marginTop: '16px' } }, [
      authField(t('cloud.email'), email, { icon: 'email' }),
      authField(t('cloud.password'), password, { icon: 'lock' }),
    ]),
    el('button.btn.primary.full', { onclick: go }, [t('cloud.signIn')]),
    status,
    el('div.small.faint', { style: { marginTop: '16px' }, text: t('gate.signInNote') }),
  );
}

function paintRevoked(pane, done) {
  const status = el('div.small', { style: { marginTop: '10px' } });
  const leave = async () => {
    await cloud.signOut();
    paintChoice(pane, done);
  };

  paint(pane,
    el('div.gate-form-intro', { text: t('gate.revokedTitle') }),
    el('div.small.muted', { style: { marginTop: '10px' }, text: t('gate.revokedDeleteIntro') }),
    el('button.btn.danger.full', {
      style: { marginTop: '18px' },
      onclick: async () => {
        const confirmed = await confirmSheet(
          t('gate.deleteRevokedTitle'), t('gate.deleteRevokedConfirm'),
          { confirmLabel: t('gate.deleteRevokedCloud'), danger: true });
        if (!confirmed) return;
        status.style.color = 'var(--text-faint)';
        status.textContent = t('cloud.working');
        try {
          await sync.deleteCloudData();
          await cloud.signOut();
          await lock();
          toast(t('cloud.deleted'), 3600);
          paintChoice(pane, done);
        } catch (err) { problem(status, err); }
      },
    }, [t('gate.deleteRevokedCloud')]),
    el('button.btn.ghost.full', { style: { marginTop: '8px' }, onclick: leave }, [t('cloud.signOut')]),
    status,
    lockedOutExport(),
  );
}
