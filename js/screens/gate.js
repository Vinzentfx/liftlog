// The invite gate: an account with a code is needed before the app opens.
//
// What this is honestly worth, said once so nobody relies on more than it gives:
// the app is a static page in a public repository and every screen runs on the
// device. Someone who wants past this can open the developer tools and set a
// flag. It cannot be otherwise without making the app need the server to
// function, which would cost it the ability to work in a gym basement.
//
// What it does buy, and this is real: nobody stumbles in and starts using it,
// and nothing reaches the server without a code. It is a door, not a vault.
//
// The rule that matters more than the gate itself: **it asks once.** Once a
// device is unlocked it stays unlocked, offline, indefinitely. The one place
// this app must never fail is halfway through a set in a basement with no
// reception, and a login check on every launch would fail exactly there.
//
// The flag lives in the `keys` store, which is the only store a restore leaves
// alone and which never appears in an exported backup. So it survives restoring
// a backup, and it does not travel to someone else's phone inside one.

import { el, clear, $, toast, authField, confirmSheet } from '../ui.js';
import * as db from '../db.js';
import * as cloud from '../cloud.js';
import * as sync from '../sync.js';
import * as store from '../store.js';
import { doExport } from './settings.js';
import { t } from '../i18n.js';

const ROW = 'gate';

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
 * Check, when there is a connection, that the account still exists.
 *
 * This is the whole revocation story: delete someone's profile row and their
 * app locks the next time it has reception. Offline it does nothing at all, on
 * purpose, and any error other than "the profile is gone" is treated as a bad
 * connection rather than as grounds for locking someone out of their own log.
 */
export async function recheck() {
  if (!cloud.isSignedIn()) return true;
  try {
    if (!(await cloud.hasActiveAccess())) {
      await lock();
      await cloud.signOut();
      location.reload();
      return false;
    }
    return true;
  } catch { /* offline, or a server hiccup. Never a reason to lock. */
    return null;
  }
}

/* ================================ the screen ================================ */

/** Renders over everything and calls `onOpen` once the device is unlocked. */
export function show(onOpen) {
  document.getElementById('tabbar').hidden = true;
  $('#screen-title').textContent = 'LiftLog';
  clear($('#topbar-actions'));

  const host = clear($('#screen'));
  const pane = el('div', { style: { maxWidth: '460px', margin: '0 auto' } });
  host.append(pane);

  const done = async () => {
    await unlock();
    document.getElementById('tabbar').hidden = false;
    onOpen();
  };

  paintChoice(pane, done);
}

/**
 * `el()` drops a null child; `replaceChildren()` turns it into the text "null".
 *
 * Which is exactly what the gate showed under its buttons on a device with no
 * training on it, because the export offer below returns null in that case.
 * Everything the gate paints goes through here so the trap has one place to be
 * avoided rather than four.
 */
function paint(pane, ...children) {
  pane.replaceChildren(...children.filter(Boolean));
}

function paintChoice(pane, done) {
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

/**
 * A way out for someone who is locked out but has a log on this device.
 *
 * Revoking access is meant to stop someone using the app, not to hold their own
 * training hostage: the sessions are sitting in IndexedDB on their phone and
 * they are theirs. Anyone determined could read them out with the developer
 * tools anyway, so refusing here would only inconvenience the people who would
 * not think to. Only shown when there is actually something to export.
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

  async function go() {
    if (!email.value.trim().includes('@')) { toast(t('cloud.needEmail')); email.focus(); return; }
    if ((password.value || '').length < 8) { toast(t('cloud.needPassword')); password.focus(); return; }
    if (!code.value.trim()) { toast(t('cloud.needInviteCode')); code.focus(); return; }

    status.style.color = 'var(--text-faint)';
    status.textContent = t('cloud.working');
    try {
      await cloud.signUp(email.value.trim(), password.value, { persist: false });
      // The invite is what actually opens the door. An account without one can
      // sign in and do nothing, here or on the server.
      await cloud.claimInvite(code.value);
      cloud.persistSession();
      await sync.load();
      await done();
      toast(t('gate.welcome'), 3000);
    } catch (err) {
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
        // Signed in, but this account never redeemed a code. Say which of the
        // two things is missing rather than "wrong password".
        problem(status, { code: 'DENIED' });
        return;
      }
      await sync.load();
      await done();
      toast(t('gate.welcomeBack'), 2600);
    } catch (err) {
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
