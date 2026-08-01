// Opt-in social hub. The encrypted workout backup is never read here; only the
// weekly totals the user chose to publish are sent to the social tables.

import { el, emptyState, toast, openSheet, closeSheet, confirmSheet, authField } from '../ui.js';
import { t, tn, locale } from '../i18n.js';
import * as cloud from '../cloud.js';
import * as store from '../store.js';
import { bestOneRepMaxByName, isCounted, startOfWeek } from '../models.js';
import { buildRating, hasProfile } from '../standards.js';
import { todaysDays } from '../schedule.js';
import * as push from '../push.js';

let hub = null;
let loading = false;
let problem = null;
let publishedSignature = null;
let leaderboardMode = 'workouts';

export default function renderUsers({ actions, fresh }) {
  actions.append(el('button.icon-btn', { id: 'settings-btn', 'aria-label': t('common.settings') }, ['⚙']));
  const root = el('div');
  if (!cloud.isSignedIn()) return emptyState(t('users.signInTitle'), t('users.signInBody'));
  if (fresh) { hub = null; problem = null; }
  if (!hub && !loading) loadHub();
  if (loading && !hub) return el('div.card', {}, [el('div.muted', { text: t('users.loading') })]);
  if (problem && !hub) return unavailable(problem);
  if (!hub?.me) return setupCard();

  root.append(profileCard(), invitesSection(), todayCard(), requestsSection(), friendsSection(), leaderboardSection(), notificationCard(), privacyCard());
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
        await cloud.publishSocialPresence(stats);
        publishedSignature = signature;
        hub = await cloud.socialHub();
      }
    }
  }
  catch (err) { problem = err; }
  finally { loading = false; import('../app.js').then(({ render }) => render()); }
}

// Called by the normal online maintenance as well as this screen. That makes a
// scheduled workout visible to friends without requiring the user to open the
// social tab first.
export async function syncPresence() {
  if (!cloud.isSignedIn()) return;
  const current = await cloud.socialHub();
  if (!current?.me) return;
  const stats = weeklyStats(current.me.training_today, current.me.status_text);
  const signature = JSON.stringify(stats);
  if (signature !== publishedSignature) {
    await cloud.publishSocialPresence(stats);
    publishedSignature = signature;
  }
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
      authField(t('users.handle'), handle, { icon: 'user', note: t('users.handleHint') }),
      authField(t('users.displayName'), name, { icon: 'user' }),
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
    authField(t('users.handle'), handle, { icon: 'user', note: t('users.handleHint') }),
    authField(t('users.displayName'), name, { icon: 'user' }),
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
  const planned = plannedToday();
  return { workouts: sessions.length, sets, strengthScore: rating?.overall ?? null,
    trainingToday: trainingToday || !!planned, message, planToday: planned };
}

function plannedToday() {
  const plan = store.activePlan();
  if (!plan) return null;
  const today = todaysDays(plan, store.state.sessions);
  if (!today.scheduled || !today.days.length) return null;
  return today.days.map((day) => {
    const exercises = (day.items || day.exercises || []).map((item) =>
      store.state.exerciseById.get(item.exerciseId || item.exercise_id || item.id)?.name || item.name).filter(Boolean);
    return exercises.length ? `${day.name}: ${exercises.slice(0, 3).join(', ')}` : day.name;
  }).join(' · ').slice(0, 160);
}

function todayCard() {
  const status = el('input', { maxlength: 100, value: hub.me.status_text || '', placeholder: t('users.statusPlaceholder') });
  const active = !!hub.me.training_today;
  const automatic = plannedToday();
  return el('div.card' + (active ? '.glow' : ''), {}, [
    el('div', { style: { fontWeight: '700' }, text: t('users.todayTitle') }),
    el('div.small.muted', { style: { margin: '3px 0 10px' }, text: t('users.todayBody') }),
    automatic ? el('div.social-plan', {}, [
      el('span.social-plan-icon', { text: '✓' }),
      el('div', {}, [el('strong', { text: t('users.planToday') }), el('div.small.muted', { text: automatic })]),
    ]) : null,
    authField(t('users.statusLabel'), status, { icon: 'note' }),
    el('button.btn.full' + (active && !automatic ? '.ghost' : '.primary'), { style: { marginTop: '10px' }, onclick: async () => {
      try {
        await cloud.publishSocialPresence(weeklyStats(automatic ? true : !active, status.value));
        toast(t(automatic ? 'users.statusSaved' : active ? 'users.todayOff' : 'users.todayOn')); hub = await cloud.socialHub();
        (await import('../app.js')).render();
      } catch { toast(t('users.saveFailed')); }
    } }, [t(automatic ? 'users.saveStatus' : active ? 'users.notTrainingToday' : 'users.trainingToday')]),
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
    authField(t('users.friendHandle'), handle, { icon: 'search', note: t('users.friendSearchHint') }),
    el('button.btn.primary.full', { onclick: async () => {
      try { await cloud.requestFriend(handle.value); toast(t('users.requestSent')); handle.value = ''; }
      catch (err) { toast(socialError(err, 'users.requestFailed')); }
    } }, [t('users.add')]),
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
    ]),
    friend.planned_workout ? el('div.social-plan.compact', {}, [
      el('span.social-plan-icon', { text: '✓' }), el('div.small', { text: friend.planned_workout }),
    ]) : null,
    el('div.row.social-actions', {}, [
      el('button.btn.primary.grow', { onclick: () => inviteFriend(friend) }, [t('users.invite')]),
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

function inviteFriend(friend) {
  const time = el('input', { type: 'time', value: nextHour() });
  const note = el('input', { maxlength: 140, placeholder: t('users.inviteNotePlaceholder') });
  openSheet(t('users.inviteTitle', { name: friend.display_name }), el('div.stack', {}, [
    el('div.invite-person', {}, [
      el('div.avatar', { text: friend.display_name.slice(0, 1).toUpperCase() }),
      el('div', {}, [el('strong', { text: friend.display_name }), el('div.small.faint', { text: `@${friend.handle}` })]),
    ]),
    authField(t('users.inviteTime'), time, { icon: 'clock' }),
    authField(t('users.inviteNote'), note, { icon: 'note' }),
    el('button.btn.primary.full', { onclick: async () => {
      try {
        const at = localTimeToday(time.value);
        const inviteId = await cloud.sendTrainingInvite(friend.user_id, at.toISOString(), note.value);
        cloud.sendInvitePush(inviteId).catch(() => {});
        closeSheet(); toast(t('users.inviteSent', { name: friend.display_name, time: time.value }));
        hub = await cloud.socialHub(); (await import('../app.js')).render();
      } catch (err) { toast(socialError(err, 'users.inviteFailed')); }
    } }, [t('users.sendInvite')]),
  ]));
}

const nextHour = () => `${String((new Date().getHours() + 1) % 24).padStart(2, '0')}:00`;
function localTimeToday(value) {
  const [hours, minutes] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() < Date.now() - 5 * 60000) date.setDate(date.getDate() + 1);
  return date;
}

function invitesSection() {
  const wrap = el('div');
  if (!hub.invites?.length && !hub.sent_invites?.length) return wrap;
  wrap.append(el('div.section-head', {}, [el('h2', { text: t('users.trainingInvites') })]));
  for (const invite of hub.invites || []) wrap.append(inviteCard(invite, true));
  for (const invite of hub.sent_invites || []) wrap.append(inviteCard(invite, false));
  return wrap;
}

function inviteCard(invite, incoming) {
  const when = new Date(invite.training_at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return el('div.card.glow', {}, [
    el('div.row.between', {}, [
      el('div.avatar', { text: invite.display_name.slice(0, 1).toUpperCase() }),
      el('div.grow', {}, [
        el('strong', { text: incoming
          ? t('users.inviteMessage', { name: invite.display_name, time: when })
          : t('users.inviteOutgoing', { name: invite.display_name, time: when }) }),
        invite.note ? el('div.small.muted', { style: { marginTop: '3px' }, text: `“${invite.note}”` }) : null,
      ]),
    ]),
    incoming ? el('div.row', { style: { marginTop: '12px' } }, [
      el('button.btn.primary.grow', { onclick: () => answerInvite(invite.id, true) }, [t('users.accept')]),
      el('button.btn.ghost.grow', { onclick: () => answerInvite(invite.id, false) }, [t('users.decline')]),
    ]) : el('div.small.faint', { style: { marginTop: '8px' }, text: inviteStatus(invite.status) }),
  ]);
}

function inviteStatus(status) {
  if (status === 'accepted') return t('users.inviteStatus.accepted');
  if (status === 'declined') return t('users.inviteStatus.declined');
  return t('users.inviteStatus.pending');
}

async function answerInvite(id, accept) {
  try { await cloud.answerTrainingInvite(id, accept); hub = await cloud.socialHub(); toast(t(accept ? 'users.inviteAccepted' : 'users.inviteDeclined')); (await import('../app.js')).render(); }
  catch { toast(t('users.saveFailed')); }
}

function leaderboardSection() {
  const wrap = el('div');
  wrap.append(el('div.section-head', {}, [el('h2', { text: t('users.leaderboard') })]));
  if (!hub.leaderboard?.length) return el('div.card', {}, [el('div.small.muted', { text: t('users.leaderboardEmpty') })]);
  const modes = [['workouts', 'users.board.workouts'], ['sets', 'users.board.sets'], ['strength', 'users.board.strength']];
  const host = el('div');
  const controls = el('div.social-segments', {}, modes.map(([key, label]) => el('button', {
    'aria-pressed': String(leaderboardMode === key), onclick: () => { leaderboardMode = key; paint(); },
  }, [t(label)])));
  function paint() {
    [...controls.children].forEach((button, i) => button.setAttribute('aria-pressed', String(modes[i][0] === leaderboardMode)));
    const key = leaderboardMode === 'sets' ? 'working_sets' : leaderboardMode === 'strength' ? 'strength_score' : 'workouts';
    const people = [...hub.leaderboard].filter((person) => leaderboardMode !== 'strength' || person.strength_score != null)
      .sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0));
    host.replaceChildren(...people.map((person, i) => el('div.card.tight.leader-row', {}, [
    el('div.row.between', {}, [
      el('span.leader-rank', { text: String(i + 1) }),
      el('div.avatar.small', { text: person.display_name.slice(0, 1).toUpperCase() }),
      el('div.grow', {}, [el('strong', { text: person.display_name }), el('div.small.faint', { text: `@${person.handle}` })]),
      el('div.leader-value', {}, [
        el('strong.num', { text: leaderboardMode === 'strength' ? String(Math.round(person.strength_score))
          : leaderboardMode === 'sets' ? tn(person.working_sets, 'unit.set') : tn(person.workouts, 'unit.session') }),
      ]),
    ]),
    ])));
  }
  wrap.append(controls, host); paint();
  return wrap;
}

function notificationCard() {
  if (!push.supported()) return el('div');
  const enabled = push.permission() === 'granted' && !!store.state.settings.notificationsEnabled;
  return el('div.card', {}, [
    el('div.row.between', {}, [
      el('div.grow', {}, [el('strong', { text: t('users.notifications') }),
        el('div.small.muted', { style: { marginTop: '4px' }, text: t('users.notificationsBody') })]),
      el('span.pill', { text: t(enabled ? 'users.notificationsOn' : 'users.notificationsOff') }),
    ]),
    enabled ? null : el('button.btn.primary.full', { style: { marginTop: '12px' }, onclick: async () => {
      try {
        await push.enable();
        await cloud.saveNotificationPreferences({ allEnabled: true,
          creatineEnabled: !!store.state.settings.creatineReminderEnabled,
          creatineTime: store.state.settings.creatineReminderTime || '19:00',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin' });
        await store.setSetting('notificationsEnabled', true);
        toast(t('users.notificationsEnabled')); (await import('../app.js')).render();
      }
      catch (err) { toast(t(err?.code === 'PUSH_DENIED' ? 'users.notificationsDenied' : 'users.notificationsFailed')); }
    } }, [t('users.enableNotifications')]),
  ]);
}

function privacyCard() {
  return el('div.card', {}, [
    el('div', { style: { fontWeight: '680' }, text: t('users.privacyTitle') }),
    el('div.small.muted', { style: { marginTop: '4px' }, text: t('users.privacyBody') }),
  ]);
}

function check(input, title, hint) {
  return el('label.social-choice', {}, [input, el('span.choice-mark', { text: '✓' }),
    el('div.grow', {}, [el('strong', { text: title }), el('div.small.faint', { text: hint })])]);
}

function socialError(err, fallback) {
  const messages = {
    HANDLE_INVALID: t('users.error.HANDLE_INVALID'),
    HANDLE_TAKEN: t('users.error.HANDLE_TAKEN'),
    NAME_INVALID: t('users.error.NAME_INVALID'),
    USER_NOT_FOUND: t('users.error.USER_NOT_FOUND'),
    CANNOT_ADD_SELF: t('users.error.CANNOT_ADD_SELF'),
    REQUEST_EXISTS: t('users.error.REQUEST_EXISTS'),
    INVITE_TIME_INVALID: t('users.error.INVITE_TIME_INVALID'),
    NOT_FRIENDS: t('users.error.NOT_FRIENDS'),
    RATE_LIMITED: t('users.error.RATE_LIMITED'),
  };
  return messages[err?.code] || t(fallback);
}
