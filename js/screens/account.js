// The cloud backup, as the person using it sees it.
//
// Two jobs, and the second one is the hard one. Setting an account up is a
// form. Explaining honestly what happens to the data, and making the recovery
// key impossible to skip past, is the part that decides whether any of this is
// worth having.
//
// The recovery key screen in particular is deliberately awkward. It cannot be
// dismissed by tapping outside, the key is shown once and never again, and
// continuing requires ticking a box. Every one of those is friction on purpose:
// the alternative is someone tapping through it in four seconds and finding out
// what it was for on the day their phone goes in a river.

import {
  el, openSheet, closeSheet, confirmSheet, toast, fmtDate, listItem, authField,
} from '../ui.js';
import * as store from '../store.js';
import * as cloud from '../cloud.js';
import * as sync from '../sync.js';
import { t, tn, locale } from '../i18n.js';
import { CONSENT_VERSION } from '../cloud-config.js';

/* ============================== entry point ============================== */

/** The row in Settings, and everything reachable from it. */
export function cloudSection() {
  const wrap = el('div');
  wrap.append(el('div.section-head', {}, [el('h2', { text: t('cloud.title') })]));

  if (!cloud.isSignedIn()) {
    wrap.append(
      el('div.card', {}, [
        el('div.small.muted', { text: t('cloud.pitch') }),
        el('button.btn.primary.full', { style: { marginTop: '12px' }, onclick: () => startSheet() },
          [t('cloud.setUp')]),
        el('div.small.faint', { style: { marginTop: '10px' }, text: t('cloud.optional') }),
      ])
    );
    return wrap;
  }

  const s = sync.state;
  const card = el('div.card', {});

  card.append(
    el('div.row.between', { style: { alignItems: 'baseline', gap: '10px' } }, [
      el('div.grow', {}, [
        el('div', { style: { fontWeight: '650', fontSize: '14px' }, text: statusLine(s) }),
        el('div.small.faint', { style: { marginTop: '2px' }, text: cloud.currentUser()?.email || '' }),
      ]),
      el('button.btn.sm.ghost', {
        disabled: s.busy || !s.profile?.recovery_wrap || !s.isOwner || !s.ownerAuthorized,
        onclick: async () => {
          const res = await sync.backupNow({ force: true });
          toast(res.ok ? t('cloud.savedNow') : t(`cloud.err.${res.code}`, { code: res.code }));
        },
      }, [t('cloud.saveNow')]),
    ])
  );

  if (!s.profile) {
    // Signed in but never redeemed an invite. Nothing works until that happens.
    card.append(el('div.small', { style: { marginTop: '10px', color: 'var(--warn)' },
      text: t('cloud.needInvite') }));
    card.append(el('button.btn.ghost.full.sm', { style: { marginTop: '10px' },
      onclick: () => inviteSheet() }, [t('cloud.enterInvite')]));
    wrap.append(card);
    return wrap;
  }

  // The invite gate creates the account/profile without silently consenting to
  // cloud storage. That is a valid halfway state, not a secondary device. Offer
  // the separate consent/setup here before any backup action is possible.
  if (!s.profile.recovery_wrap) {
    card.append(
      el('div.small.muted', { style: { marginTop: '10px' }, text: t('cloud.finishSetupIntro') }),
      el('button.btn.primary.full.sm', {
        style: { marginTop: '10px' }, onclick: () => finishSetupSheet(),
      }, [t('cloud.finishSetup')]),
    );
    wrap.append(card);
    return wrap;
  }

  if (s.isOwner && !s.ownerAuthorized) {
    card.append(
      el('div.small', { style: { marginTop: '10px', color: 'var(--warn)' },
        text: t('cloud.capabilityUpgrade') }),
      el('button.btn.primary.full.sm', {
        style: { marginTop: '10px' }, onclick: () => recoverSheet(),
      }, [t('cloud.useRecovery')]),
    );
  }

  if (!s.isOwner) {
    card.append(el('div.small', { style: { marginTop: '10px', color: 'var(--text-dim)' },
      text: t('cloud.readOnly') }));
  }

  if (s.lastError) {
    card.append(el('div.small', { style: { marginTop: '10px', color: 'var(--warn)' },
      text: t(`cloud.err.${s.lastError}`, { code: s.lastError }) }));
  }

  if (s.pendingDevices.length) {
    card.append(
      el('div.card.tight.glow', { style: { marginTop: '12px' } }, [
        el('div.small', { style: { fontWeight: '650' },
          text: tn(s.pendingDevices.length, 'cloud.pendingCount') }),
        ...s.pendingDevices.map((d) => el('div.row.between', { style: { marginTop: '8px', gap: '8px' } }, [
          el('div.grow', {}, [
            el('div.small', { style: { fontWeight: '620' }, text: d.name }),
            el('div.small.faint', { text: fmtDate(new Date(d.created_at).getTime(), { hour: 'numeric', minute: '2-digit' }) }),
          ]),
          el('button.btn.sm.primary', { onclick: () => approveSheet(d) }, [t('cloud.approve')]),
        ])),
      ])
    );
  }

  card.append(
    el('div.stack', { style: { marginTop: '14px' } }, [
      el('button.btn.ghost.full.sm', { onclick: () => devicesSheet() }, [t('cloud.devices')]),
      el('button.btn.ghost.full.sm', { onclick: () => restoreSheet() }, [t('cloud.restore')]),
      el('button.btn.ghost.full.sm', { onclick: () => manageSheet() }, [t('cloud.manage')]),
    ])
  );

  wrap.append(card);
  return wrap;
}

function statusLine(s) {
  if (!s.profile) return t('cloud.notSetUp');
  const last = Number(store.state.settings.cloudLastSyncAt) || s.lastSyncAt;
  if (!last) return t('cloud.neverSaved');
  const mins = Math.round((Date.now() - last) / 60000);
  if (mins < 2) return t('cloud.savedJustNow');
  if (mins < 60) return t('cloud.savedMinutes', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('cloud.savedHours', { n: hours });
  return t('cloud.savedOn', {
    date: new Date(last).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }),
  });
}

/* ============================== setting up ============================== */

function startSheet() {
  const body = el('div', {}, [
    el('div.small.muted', { text: t('cloud.startIntro') }),
    el('div.stack', { style: { marginTop: '16px' } }, [
      el('button.btn.primary.full', { onclick: () => signUpSheet() }, [t('cloud.newAccount')]),
      el('button.btn.ghost.full', { onclick: () => signInSheet() }, [t('cloud.haveAccount')]),
    ]),
  ]);
  openSheet(t('cloud.setUp'), body);
}

function credentialFields() {
  const email = el('input', {
    type: 'email', inputmode: 'email', autocomplete: 'email',
    autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
    placeholder: 'name@example.com',
  });
  const password = el('input', { type: 'password', autocomplete: 'current-password' });
  return { email, password };
}

function signUpSheet() {
  const { email, password } = credentialFields();
  password.autocomplete = 'new-password';
  const invite = el('input', {
    type: 'text', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
    placeholder: 'ABCD-2026',
  });
  const agreed = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
  const status = el('div.small', { style: { marginTop: '10px' } });

  async function go() {
    const mail = email.value.trim();
    if (!mail || !mail.includes('@')) { toast(t('cloud.needEmail')); email.focus(); return; }
    if ((password.value || '').length < 8) { toast(t('cloud.needPassword')); password.focus(); return; }
    if (!invite.value.trim()) { toast(t('cloud.needInviteCode')); invite.focus(); return; }
    if (!agreed.checked) { toast(t('cloud.needConsent')); return; }

    status.style.color = 'var(--text-faint)';
    status.textContent = t('cloud.working');
    try {
      await cloud.signUp(mail, password.value);
      await cloud.claimInvite(invite.value);
      const recovery = await sync.createAccount({ consent: true });
      recoveryKeySheet(recovery);
    } catch (err) {
      status.style.color = 'var(--warn)';
      status.textContent = t(`cloud.err.${err.code}`, { code: err.code || 'SERVER' });
    }
  }

  openSheet(t('cloud.newAccount'), el('div', {}, [
    authField(t('cloud.email'), email, { icon: 'email' }),
    authField(t('cloud.password'), password, { icon: 'lock' }),
    el('div.small.faint', { style: { marginTop: '-8px', marginBottom: '12px' }, text: t('cloud.passwordNote') }),
    authField(t('cloud.inviteCode'), invite, { icon: 'key' }),

    el('div.section-head', {}, [el('h2', { text: t('cloud.consentTitle') })]),
    el('div.small.muted', { text: t('cloud.consentBody') }),
    el('div.small.faint', { style: { marginTop: '8px' }, text: t('cloud.consentNotStored') }),
    el('label.field', { style: { marginTop: '12px' } }, [
      el('div.row', { style: { gap: '10px' } }, [
        agreed,
        el('span.grow', {
          text: t('cloud.consentCheck'),
          style: { textTransform: 'none', letterSpacing: '0', fontSize: '14px', fontWeight: '500', color: 'var(--text)', marginBottom: '0' },
        }),
      ]),
    ]),

    el('button.btn.primary.full', { onclick: go }, [t('cloud.createAccount')]),
    status,
  ]));
}

function signInSheet() {
  const { email, password } = credentialFields();
  const status = el('div.small', { style: { marginTop: '10px' } });

  async function go() {
    status.style.color = 'var(--text-faint)';
    status.textContent = t('cloud.working');
    try {
      await cloud.signIn(email.value.trim(), password.value);
      if (!(await cloud.hasActiveAccess())) {
        throw Object.assign(new Error('ACCESS_REVOKED'), { code: 'ACCESS_REVOKED' });
      }
      await sync.load();
      closeSheet();
      // A phone signing in to an existing account is a second device until the
      // main one says otherwise, so it asks rather than assuming.
      afterSignIn();
    } catch (err) {
      status.style.color = 'var(--warn)';
      status.textContent = t(`cloud.err.${err.code}`, { code: err.code || 'SERVER' });
    }
  }

  openSheet(t('cloud.haveAccount'), el('div', {}, [
    authField(t('cloud.email'), email, { icon: 'email' }),
    authField(t('cloud.password'), password, { icon: 'lock' }),
    el('button.btn.primary.full', { onclick: go }, [t('cloud.signIn')]),
    status,
    el('div.small.faint', { style: { marginTop: '14px' }, text: t('cloud.signInNote') }),
  ]));
}

/** Add encrypted cloud backup to an account created by the invite gate. */
function finishSetupSheet() {
  const agreed = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
  const status = el('div.small', { style: { marginTop: '10px' } });

  openSheet(t('cloud.finishSetup'), el('div', {}, [
    el('div.small.muted', { text: t('cloud.consentBody') }),
    el('div.small.faint', { style: { marginTop: '8px' }, text: t('cloud.consentNotStored') }),
    el('label.field', { style: { marginTop: '12px' } }, [
      el('div.row', { style: { gap: '10px' } }, [
        agreed,
        el('span.grow', {
          text: t('cloud.consentCheck'),
          style: { textTransform: 'none', letterSpacing: '0', fontSize: '14px', fontWeight: '500', color: 'var(--text)', marginBottom: '0' },
        }),
      ]),
    ]),
    el('button.btn.primary.full', {
      onclick: async () => {
        if (!agreed.checked) { toast(t('cloud.needConsent')); return; }
        status.style.color = 'var(--text-faint)';
        status.textContent = t('cloud.working');
        try {
          const recovery = await sync.createAccount({ consent: true });
          recoveryKeySheet(recovery);
        } catch (err) {
          status.style.color = 'var(--warn)';
          status.textContent = t(`cloud.err.${err.code}`, { code: err.code || 'SERVER' });
        }
      },
    }, [t('cloud.finishSetup')]),
    status,
  ]));
}

/** Signed in on a device the account has not seen before. */
function afterSignIn() {
  if (!sync.state.profile) { inviteSheet(); return; }

  openSheet(t('cloud.newDevice'), el('div', {}, [
    el('div.small.muted', { text: t('cloud.newDeviceIntro') }),
    el('div.stack', { style: { marginTop: '16px' } }, [
      el('button.btn.primary.full', {
        onclick: async () => {
          await sync.requestAccess();
          closeSheet();
          toast(t('cloud.requestSent'), 3200);
        },
      }, [t('cloud.askMainDevice')]),
      el('button.btn.ghost.full', { onclick: () => recoverSheet() }, [t('cloud.useRecovery')]),
    ]),
    el('div.small.faint', { style: { marginTop: '14px' }, text: t('cloud.newDeviceNote') }),
  ]));
}

function inviteSheet() {
  const code = el('input', {
    type: 'text', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
    placeholder: 'ABCD-2026',
  });
  const status = el('div.small', { style: { marginTop: '10px' } });

  openSheet(t('cloud.enterInvite'), el('div', {}, [
    el('div.small.muted', { text: t('cloud.inviteIntro') }),
    el('div', { style: { marginTop: '14px' } }, [authField(t('cloud.inviteCode'), code, { icon: 'key' })]),
    el('button.btn.primary.full', {
      onclick: async () => {
        status.style.color = 'var(--text-faint)';
        status.textContent = t('cloud.working');
        try {
          await cloud.claimInvite(code.value);
          const recovery = await sync.createAccount({ consent: true });
          recoveryKeySheet(recovery);
        } catch (err) {
          status.style.color = 'var(--warn)';
          status.textContent = t(`cloud.err.${err.code}`, { code: err.code || 'SERVER' });
        }
      },
    }, [t('cloud.redeem')]),
    status,
  ]));
}

/* ============================ the recovery key ============================ */

/**
 * Shown exactly once, and built so it cannot be skimmed past.
 *
 * No dismiss on the scrim, no close button that works, and the continue button
 * stays disabled until the box is ticked. That is unusual in this app, which
 * otherwise never traps anyone in a sheet. It is justified here because this is
 * the only screen whose consequence is unrecoverable: everything else can be
 * undone by trying again, and this one cannot be revisited at all.
 */
function recoveryKeySheet(recovery) {
  const confirmed = el('input', { type: 'checkbox', style: { width: 'auto', minHeight: 'auto' } });
  const done = el('button.btn.primary.full', { disabled: true }, [t('cloud.recoverySaved')]);
  confirmed.addEventListener('change', () => { done.disabled = !confirmed.checked; });

  done.addEventListener('click', () => {
    closeSheet();
    toast(t('cloud.ready'), 3000);
  });

  const copy = el('button.btn.ghost.full.sm', {
    onclick: async () => {
      try { await navigator.clipboard.writeText(recovery); toast(t('cloud.recoveryCopied')); }
      catch { toast(t('cloud.recoveryCopyFailed')); }
    },
  }, [t('cloud.recoveryCopy')]);

  openSheet(t('cloud.recoveryTitle'), el('div', {}, [
    el('div.small.muted', { text: t('cloud.recoveryWhy') }),
    el('div.card.tight.glow', { style: { marginTop: '14px' } }, [
      el('div', {
        style: {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '16px', fontWeight: '650', letterSpacing: '.04em',
          lineHeight: '1.7', textAlign: 'center', wordBreak: 'break-all',
        },
        text: recovery,
      }),
    ]),
    copy,
    el('div.small', { style: { marginTop: '14px', color: 'var(--warn)' }, text: t('cloud.recoveryOnce') }),
    el('label.field', { style: { marginTop: '14px' } }, [
      el('div.row', { style: { gap: '10px' } }, [
        confirmed,
        el('span.grow', {
          text: t('cloud.recoveryConfirm'),
          style: { textTransform: 'none', letterSpacing: '0', fontSize: '14px', fontWeight: '500', color: 'var(--text)', marginBottom: '0' },
        }),
      ]),
    ]),
    done,
  ]), { onClose: () => { /* the sheet can close; the key is gone either way */ } });
}

function recoverSheet() {
  const key = el('input', {
    type: 'text', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
    placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX',
  });
  const status = el('div.small', { style: { marginTop: '10px' } });

  openSheet(t('cloud.recoverTitle'), el('div', {}, [
    el('div.small.muted', { text: t('cloud.recoverIntro') }),
    el('div', { style: { marginTop: '14px' } }, [authField(t('cloud.recoveryKey'), key, { icon: 'key' })]),
    el('button.btn.primary.full', {
      onclick: async () => {
        status.style.color = 'var(--text-faint)';
        status.textContent = t('cloud.working');
        try {
          await sync.recoverWith(key.value);
          closeSheet();
          toast(t('cloud.recovered'), 3200);
        } catch (err) {
          status.style.color = 'var(--warn)';
          status.textContent = t(`cloud.err.${err.code}`, { code: err.code || 'SERVER' });
        }
      },
    }, [t('cloud.recoverGo')]),
    status,
    el('div.small.faint', { style: { marginTop: '14px' }, text: t('cloud.recoverWarns') }),
  ]));
}

/* ================================ devices ================================ */

function approveSheet(device) {
  openSheet(t('cloud.approveTitle'), el('div', {}, [
    el('div.small.muted', { text: t('cloud.approveIntro', { name: device.name }) }),
    el('div.card.tight', { style: { marginTop: '12px' } }, [
      el('div', { style: { fontWeight: '650' }, text: device.name }),
      el('div.small.faint', { text: new Date(device.created_at).toLocaleString(locale()) }),
    ]),
    el('div.small', { style: { marginTop: '12px', color: 'var(--warn)' }, text: t('cloud.approveWarn') }),
    el('div.stack', { style: { marginTop: '14px' } }, [
      el('button.btn.primary.full', {
        onclick: async () => {
          try {
            await sync.approve(device.id);
            closeSheet();
            toast(t('cloud.approved'));
          } catch (err) { toast(t(`cloud.err.${err.code}`, { code: err.code || 'SERVER' })); }
        },
      }, [t('cloud.approveYes')]),
      el('button.btn.full.danger', {
        onclick: async () => {
          await sync.revoke(device.id);
          closeSheet();
          toast(t('cloud.rejected'));
        },
      }, [t('cloud.approveNo')]),
    ]),
  ]));
}

async function devicesSheet() {
  const body = el('div', {}, [el('div.small.faint', { text: t('cloud.working') })]);
  openSheet(t('cloud.devices'), body);

  let devices;
  try { devices = await cloud.listDevices(); }
  catch (err) {
    body.replaceChildren(el('div.small', { style: { color: 'var(--warn)' },
      text: t(`cloud.err.${err.code}`, { code: err.code || 'SERVER' }) }));
    return;
  }

  const mine = sync.state.deviceId;
  body.replaceChildren(
    el('div.small.muted', { text: t('cloud.devicesIntro') }),
    ...devices.map((d) => el('div.row.between', {
      style: { padding: '10px 0', borderBottom: '1px solid var(--line-soft)', gap: '10px' },
    }, [
      el('div.grow', {}, [
        el('div', { style: { fontWeight: '620' },
          text: d.name + (d.id === mine ? `  ·  ${t('cloud.thisDevice')}` : '') }),
        el('div.small.faint', {
          text: [
            t(`cloud.status.${d.status}`),
            sync.state.profile?.owner_device === d.id ? t('cloud.mainDevice') : null,
            d.last_seen_at ? t('cloud.lastSeen', {
              when: new Date(d.last_seen_at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }),
            }) : null,
          ].filter(Boolean).join(' · '),
        }),
      ]),
      d.id === mine ? null : el('button.btn.quiet.sm', {
        'aria-label': t('cloud.revoke'),
        onclick: async () => {
          const ok = await confirmSheet(t('cloud.revokeTitle'),
            t('cloud.revokeBody', { name: d.name }), { confirmLabel: t('cloud.revoke') });
          if (!ok) return;
          await sync.revoke(d.id);
          devicesSheet();
        },
      }, ['×']),
    ])),
    el('div.small.faint', { style: { marginTop: '12px' }, text: t('cloud.devicesNote') }),
  );
}

/* ============================ restore and manage ============================ */

async function restoreSheet() {
  const body = el('div', {}, [el('div.small.faint', { text: t('cloud.working') })]);
  openSheet(t('cloud.restore'), body);

  let versions;
  try { versions = await cloud.listVersions(); }
  catch (err) {
    body.replaceChildren(el('div.small', { style: { color: 'var(--warn)' },
      text: t(`cloud.err.${err.code}`, { code: err.code || 'SERVER' }) }));
    return;
  }

  if (!versions.length) {
    body.replaceChildren(el('div.small.muted', { text: t('cloud.noBackups') }));
    return;
  }

  body.replaceChildren(
    el('div.small.muted', { text: t('cloud.restoreIntro') }),
    el('div', { style: { marginTop: '10px' } }, versions.map((v) => listItem({
      title: new Date(v.created_at).toLocaleString(locale()),
      sub: t('cloud.versionSub', { version: v.version, kb: Math.round(v.bytes / 1024) }),
      onclick: async () => {
        const ok = await confirmSheet(t('cloud.restoreConfirmTitle'),
          t('cloud.restoreConfirmBody'), { confirmLabel: t('cloud.restoreGo') });
        if (!ok) return;
        const res = await sync.restore(v.version);
        closeSheet();
        toast(res.ok ? t('cloud.restored', { version: res.version })
                     : t(`cloud.err.${res.code}`, { code: res.code }), 3200);
      },
    }))),
    el('div.small.faint', { style: { marginTop: '12px' }, text: t('cloud.restoreNote') }),
  );
}

function manageSheet() {
  openSheet(t('cloud.manage'), el('div', {}, [
    el('div.small.muted', { text: t('cloud.manageIntro') }),

    el('div.section-head', {}, [el('h2', { text: t('cloud.consentTitle') })]),
    el('div.small.faint', {
      text: sync.state.profile?.consent_at
        ? t('cloud.consentGiven', {
            date: new Date(sync.state.profile.consent_at).toLocaleDateString(locale()),
            version: sync.state.profile.consent_version || CONSENT_VERSION,
          })
        : t('cloud.consentMissing'),
    }),

    el('div.stack', { style: { marginTop: '16px' } }, [
      el('button.btn.ghost.full', {
        onclick: async () => {
          const ok = await confirmSheet(t('cloud.signOutTitle'), t('cloud.signOutBody'),
            { danger: false, confirmLabel: t('cloud.signOut') });
          if (!ok) return;
          await sync.signOutEverywhere();
          closeSheet();
          toast(t('cloud.signedOut'));
        },
      }, [t('cloud.signOut')]),

      el('button.btn.full.danger', {
        onclick: async () => {
          const ok = await confirmSheet(t('cloud.deleteTitle'), t('cloud.deleteBody'),
            { confirmLabel: t('cloud.deleteGo') });
          if (!ok) return;
          try {
            await sync.deleteCloudData();
            closeSheet();
            toast(t('cloud.deleted'), 3600);
          } catch (err) { toast(t(`cloud.err.${err.code}`, { code: err.code || 'SERVER' })); }
        },
      }, [t('cloud.deleteGo')]),
    ]),

    el('div.small.faint', { style: { marginTop: '14px' }, text: t('cloud.deleteNote') }),
  ]));
}
