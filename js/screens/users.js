// Opt-in social hub. The encrypted workout backup is never read here; only the
// weekly totals the user chose to publish are sent to the social tables.

import { el, emptyState, toast, openSheet, closeSheet, confirmSheet } from '../ui.js';
import { t, tn } from '../i18n.js';
import * as cloud from '../cloud.js';
import * as store from '../store.js';
import { bestOneRepMaxByName, isCounted, startOfWeek } from '../models.js';
import { buildRating, hasProfile } from '../standards.js';

let hub = null;
let loading = false;
let problem = null;
let publishedSignature = null;

export default function renderUsers({ actions, fresh }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': t('common.settings') }, ['⚙']));
  const root = el('div');
  if (!cloud.isSignedIn()) return emptyState(t('users.signInTitle'), t('users.signInBody'));
  if (fresh) { hub = null; problem = null; }
  if (!hub && !loading) loadHub();
  if (loading && !hub) return el('div.card', {}, [el('div.muted', { text: t('users.loading') })]);
  if (problem && !hub) return unavailable(problem);
  if (!hub?.me) return setupCard();

  root.append(profileCard(), todayCard(), requestsSection(), friendsSection(), leaderboardSection(), privacyCard());
  return root;
}

async function loadHub() {
  loading = true; problem = null;
  try {
    hub = await cloud.socialHub();
    if (hub?.me) {
      const stats = weeklyStats(hub.me.training_today, hub.me.status_text);
      const signature = JSON.stringify(stats);
      if (signature !== publishedSignature) {
        await cloud.publishSocialWeek(stats);
        publishedSignature = signature;
        hub = await cloud.socialHub();
      }
    }
  }
  catch (err) { problem = err; }
  finally { loading = false; import('../app.js').then(({ render }) => render()); }
}

function unavailable(err) {
  const missing = err?.code === 'SERVER';
  return el('div', {}, [
    el('div.card', {}, [
      el('div', { style: { fontWeight: '700' }, text: t(missing ? 'users.notInstalled' : 'users.unavailable') }),
      el('div.small.muted', { style: { marginTop: '4px' }, text: t(missing ? 'users.notInstalledBody' : 'users.unavailableBody') }),
      el('button.btn.ghost.full', { style: { marginTop: '12px' }, onclick: loadHub }, [t('app.reload')]),
    ]),
  ]);
}

function setupCard() {
  const handle = el('input', { placeholder: t('users.handlePlaceholder'), maxlength: 24, autocomplete: 'off' });
  const name = el('input', { placeholder: t('users.namePlaceholder'), maxlength: 40, autocomplete: 'name' });
  const discoverable = el('input', { type: 'checkbox', checked: false });
  const leaderboard = el('input', { type: 'checkbox', checked: false });
  return el('div', {}, [
    el('div.card.glow', {}, [
      el('div', { style: { fontWeight: '720', fontSize: '18px' }, text: t('users.setupTitle') }),
      el('div.small.muted', { style: { margin: '4px 0 14px' }, text: t('users.setupBody') }),
      el('label.field', {}, [el('span', { text: t('users.handle') }), handle]),
      el('label.field', {}, [el('span', { text: t('users.displayName') }), name]),
      check(discoverable, t('users.discoverable'), t('users.discoverableHint')),
      check(leaderboard, t('users.joinLeaderboard'), t('users.joinLeaderboardHint')),
      el('button.btn.primary.full', { onclick: async () => {
        try {
          await cloud.saveSocialProfile({ handle: handle.value, displayName: name.value,
            discoverable: discoverable.checked, leaderboard: leaderboard.checked });
          toast(t('users.saved')); hub = null; loadHub();
        } catch (err) { toast(socialError(err, 'users.saveFailed')); }
      } }, [t('users.create')]),
    ]),
    privacyCard(),
  ]);
}

function profileCard() {
  return el('div.card', {}, [
    el('div.row.between', {}, [
      el('div', {}, [
        el('div', { style: { fontWeight: '720', fontSize: '18px' }, text: hub.me.display_name }),
        el('div.small.faint', { text: `@${hub.me.handle}` }),
      ]),
      el('span.pill', { text: hub.me.discoverable ? t('users.visible') : t('users.private') }),
      el('button.btn.ghost.sm', { onclick: editProfile }, [t('common.edit')]),
    ]),
  ]);
}

function editProfile() {
  const handle = el('input', { value: hub.me.handle, maxlength: 24, autocomplete: 'off' });
  const name = el('input', { value: hub.me.display_name, maxlength: 40, autocomplete: 'name' });
  const discoverable = el('input', { type: 'checkbox', checked: hub.me.discoverable });
  const leaderboard = el('input', { type: 'checkbox', checked: hub.me.leaderboard_opt_in });
  openSheet(t('users.editProfile'), el('div.stack', {}, [
    el('label.field', {}, [el('span', { text: t('users.handle') }), handle]),
    el('label.field', {}, [el('span', { text: t('users.displayName') }), name]),
    check(discoverable, t('users.discoverable'), t('users.discoverableHint')),
    check(leaderboard, t('users.joinLeaderboard'), t('users.joinLeaderboardHint')),
    el('button.btn.primary.full', { onclick: async () => {
      try {
        await cloud.saveSocialProfile({ handle: handle.value, displayName: name.value,
          discoverable: discoverable.checked, leaderboard: leaderboard.checked });
        closeSheet(); hub = await cloud.socialHub(); toast(t('users.saved'));
        (await import('../app.js')).render();
      } catch (err) { toast(socialError(err, 'users.saveFailed')); }
    } }, [t('common.save')]),
  ]));
}

function weeklyStats(trainingToday, message) {
  const since = startOfWeek(Date.now());
  const sessions = store.state.sessions.filter((s) => s.finishedAt && s.startedAt >= since);
  const sets = sessions.reduce((n, s) => n + (s.entries || []).reduce(
    (sum, entry) => sum + (entry.sets || []).filter(isCounted).length, 0), 0);
  const best = bestOneRepMaxByName(store.state.sessions, store.state.exerciseById);
  const rating = hasProfile(store.state.settings) ? buildRating(best, store.state.settings) : null;
  return { workouts: sessions.length, sets, strengthScore: rating?.overall ?? null, trainingToday, message };
}

function todayCard() {
  const status = el('input', { maxlength: 100, value: hub.me.status_text || '', placeholder: t('users.statusPlaceholder') });
  const active = !!hub.me.training_today;
  return el('div.card' + (active ? '.glow' : ''), {}, [
    el('div', { style: { fontWeight: '700' }, text: t('users.todayTitle') }),
    el('div.small.muted', { style: { margin: '3px 0 10px' }, text: t('users.todayBody') }),
    status,
    el('button.btn.full' + (active ? '.ghost' : '.primary'), { style: { marginTop: '10px' }, onclick: async () => {
      try {
        await cloud.publishSocialWeek(weeklyStats(!active, status.value));
        toast(t(active ? 'users.todayOff' : 'users.todayOn')); hub = await cloud.socialHub();
        (await import('../app.js')).render();
      } catch { toast(t('users.saveFailed')); }
    } }, [t(active ? 'users.notTrainingToday' : 'users.trainingToday')]),
  ]);
}

function requestsSection() {
  const wrap = el('div');
  if (!hub.requests?.length) return wrap;
  wrap.append(el('div.section-head', {}, [el('h2', { text: t('users.requests') })]));
  for (const request of hub.requests) wrap.append(el('div.card.tight', {}, [
    el('div.row.between', {}, [
      el('div', {}, [el('strong', { text: request.display_name }), el('div.small.faint', { text: `@${request.handle}` })]),
      el('div.row', {}, [
        el('button.btn.primary.sm', { onclick: () => answer(request.id, true) }, [t('users.accept')]),
        el('button.btn.ghost.sm', { onclick: () => answer(request.id, false) }, [t('users.decline')]),
      ]),
    ]),
  ]));
  return wrap;
}

async function answer(id, accept) {
  try { await cloud.answerFriend(id, accept); hub = await cloud.socialHub(); (await import('../app.js')).render(); }
  catch { toast(t('users.saveFailed')); }
}

function friendsSection() {
  const wrap = el('div');
  const handle = el('input', { placeholder: t('users.friendHandle'), maxlength: 24, autocomplete: 'off' });
  wrap.append(el('div.section-head', {}, [el('h2', { text: t('users.friends') })]));
  wrap.append(el('div.card', {}, [
    el('div.row', {}, [handle, el('button.btn.primary.sm', { onclick: async () => {
      try { await cloud.requestFriend(handle.value); toast(t('users.requestSent')); handle.value = ''; }
      catch (err) { toast(socialError(err, 'users.requestFailed')); }
    } }, [t('users.add')])]),
  ]));
  for (const friend of hub.friends || []) wrap.append(el('div.card.tight', {}, [
    el('div.row.between', {}, [
      el('div', {}, [
        el('div', { style: { fontWeight: '680' }, text: friend.display_name }),
        el('div.small.faint', { text: friend.training_today
          ? t('users.friendTraining', { name: friend.display_name, message: friend.status_text || t('users.noStatus') })
          : t('users.friendQuiet', { name: friend.display_name }) }),
      ]),
      friend.training_today ? el('span.pill.pr', { text: t('users.today') }) : null,
      el('button.btn.quiet.sm', { onclick: async () => {
        const ok = await confirmSheet(t('users.blockTitle'), t('users.blockBody', { name: friend.display_name }),
          { confirmLabel: t('users.block') });
        if (!ok) return;
        try { await cloud.blockSocialUser(friend.user_id); hub = await cloud.socialHub(); (await import('../app.js')).render(); }
        catch { toast(t('users.saveFailed')); }
      } }, [t('users.block')]),
    ]),
  ]));
  return wrap;
}

function leaderboardSection() {
  const wrap = el('div');
  wrap.append(el('div.section-head', {}, [el('h2', { text: t('users.leaderboard') })]));
  if (!hub.leaderboard?.length) return el('div.card', {}, [el('div.small.muted', { text: t('users.leaderboardEmpty') })]);
  hub.leaderboard.forEach((person, i) => wrap.append(el('div.card.tight', {}, [
    el('div.row.between', {}, [
      el('div', {}, [el('strong', { text: `${i + 1}. ${person.display_name}` }), el('div.small.faint', { text: `@${person.handle}` })]),
      el('div', { style: { textAlign: 'right' } }, [
        el('strong.num', { text: tn(person.workouts, 'unit.session') }),
        el('div.small.faint', { text: tn(person.working_sets, 'unit.set') }),
      ]),
    ]),
  ])));
  return wrap;
}

function privacyCard() {
  return el('div.card', {}, [
    el('div', { style: { fontWeight: '680' }, text: t('users.privacyTitle') }),
    el('div.small.muted', { style: { marginTop: '4px' }, text: t('users.privacyBody') }),
  ]);
}

function check(input, title, hint) {
  return el('label.field', {}, [el('div.row', {}, [input, el('div', {}, [el('div', { text: title }), el('div.small.faint', { text: hint })])])]);
}

function socialError(err, fallback) {
  const messages = {
    HANDLE_INVALID: t('users.error.HANDLE_INVALID'),
    HANDLE_TAKEN: t('users.error.HANDLE_TAKEN'),
    NAME_INVALID: t('users.error.NAME_INVALID'),
    USER_NOT_FOUND: t('users.error.USER_NOT_FOUND'),
    CANNOT_ADD_SELF: t('users.error.CANNOT_ADD_SELF'),
    REQUEST_EXISTS: t('users.error.REQUEST_EXISTS'),
  };
  return messages[err?.code] || t(fallback);
}
