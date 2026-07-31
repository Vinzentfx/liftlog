// Live check of the cloud layer against the real Supabase project.
//
//   node tools/live-check.mjs TEST-C
//
// Not part of `node --test`: it needs the network and it consumes one invite
// code, so it is a thing you run on purpose. Everything it touches, it deletes
// again, apart from the login itself, which needs the dashboard.
//
// It exists because the automated tests can only prove that the crypto is
// correct and the code compiles. Whether the access rules on the server
// actually bite is a question only the server can answer.
const cloud = await import('../js/cloud.js');
const crypto2 = await import('../js/crypto.js');

const step = (n, msg) => console.log(`${String(n).padStart(2)}. ${msg}`);
const ok = (cond, msg) => console.log(`    ${cond ? 'ok  ' : 'FAIL'} ${msg}`);

const code = process.argv[2] || 'TEST-B';
const mail = `dev-${Date.now().toString(36)}@liftlog.test`;
const pass = 'Pruefung-2026-xyz';
const ownerToken = crypto.randomUUID() + crypto.randomUUID();

const PAYLOAD = {
  format: 'liftlog-backup',
  settings: { language: 'de', bodyweight: 84.2 },
  sessions: Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, name: 'Push', startedAt: i })),
};

async function expectCode(want, fn, label) {
  try { await fn(); ok(false, `${label}: kam durch, erwartet war ${want}`); }
  catch (e) { ok(e.code === want, `${label}: ${e.code}${e.code === want ? '' : ` (erwartet ${want})`}`); }
}

step(1, `registrieren als ${mail}`);
await cloud.signUp(mail, pass);
ok(cloud.isSignedIn(), 'angemeldet');
const me = cloud.currentUser();

step(2, 'Profil vor dem Einladungscode');
ok((await cloud.getProfile()) === null, 'noch keins, richtig');

step(3, 'hochladen ohne Einladung');
const dataKey = await crypto2.generateDataKey();
const blob = await crypto2.seal(dataKey, PAYLOAD);
await expectCode('OWNER_TOKEN_WRONG', () => cloud.upload(blob, {
  version: 1, deviceId: crypto.randomUUID(), ownerToken,
}), 'abgewiesen');

step(4, `Einladungscode ${code} einloesen`);
await cloud.claimInvite(code);
const profile = await cloud.getProfile();
ok(!!profile, 'Profil existiert jetzt');

step(5, 'Geraet anmelden');
const keys = await crypto2.generateDeviceKeys();
const device = await cloud.registerDevice({ name: 'Testgeraet', publicKey: await crypto2.exportPublicKey(keys) });
ok(device?.status === 'pending', `Status ${device?.status}`);

step(6, 'Wiederherstellungs-Schluessel am Profil hinterlegen');
const recovery = crypto2.generateRecoveryKey();
const salt = crypto2.randomBytes(16);
const vsalt = crypto2.randomBytes(16);
const wrap = await crypto2.wrapDataKey(await crypto2.keyFromRecovery(recovery, salt), dataKey);
const selfShared = await crypto2.sharedKey(keys.privateKey, await crypto2.exportPublicKey(keys));
const selfWrap = await crypto2.wrapDataKey(selfShared, dataKey);
await cloud.configureBackup(device.id, {
  recovery_wrap: wrap.wrapped, recovery_iv: wrap.iv,
  recovery_salt: crypto2.toBase64(salt),
  recovery_verifier: await crypto2.recoveryVerifier(recovery, vsalt),
  recovery_verifier_salt: crypto2.toBase64(vsalt),
  consent_at: new Date().toISOString(), consent_version: '2026-07-31',
  wrapped_key: selfWrap.wrapped, wrap_iv: selfWrap.iv,
  wrapped_by: await crypto2.exportPublicKey(keys),
}, ownerToken);
ok(true, 'gespeichert');

step(7, 'Sicherung hochladen');
await cloud.upload(blob, { version: 1, deviceId: device.id, ownerToken });
const meta = await cloud.latestMeta();
ok(meta?.version === 1, `Version ${meta?.version}, ${Math.round(meta?.bytes / 1024)} KB verschluesselt`);

step(8, 'dieselbe Version noch einmal');
await expectCode('STALE', () => cloud.upload(blob, {
  version: 1, deviceId: device.id, ownerToken,
}), 'abgeprallt');

step(9, 'herunterladen und entschluesseln');
const got = await cloud.download();
const back = await crypto2.open(dataKey, got.blob);
ok(back.sessions.length === PAYLOAD.sessions.length, `${back.sessions.length} Sitzungen zurueck`);
ok(JSON.stringify(back) === JSON.stringify(PAYLOAD), 'Inhalt identisch');

step(10, 'nur ueber den Wiederherstellungs-Schluessel oeffnen');
const p2 = await cloud.getProfile();
const viaRecovery = await crypto2.unwrapDataKey(
  await crypto2.keyFromRecovery(recovery, crypto2.fromBase64(p2.recovery_salt)),
  { wrapped: p2.recovery_wrap, iv: p2.recovery_iv });
ok((await crypto2.open(viaRecovery, got.blob)).sessions.length === 200, 'geht auch ohne Geraet');

step(11, 'Verifier prueft die Uebernahme');
await expectCode('RECOVERY_WRONG',
  () => cloud.claimOwnership('falsch', device.id), 'falscher Verifier');
await cloud.claimOwnership(
  await crypto2.recoveryVerifier(recovery, crypto2.fromBase64(p2.recovery_verifier_salt)),
  device.id, ownerToken);
ok((await cloud.listDevices())[0].status === 'approved', 'richtiger Verifier uebernimmt');

step(12, 'abmelden und wieder anmelden');
await cloud.signOut();
ok(!cloud.isSignedIn(), 'abgemeldet');
await expectCode('AUTH', () => cloud.latestMeta(), 'ohne Sitzung');
await cloud.signIn(mail, pass);
ok((await cloud.download()).version === 1, 'Sicherung nach erneuter Anmeldung erreichbar');

step(13, 'alles loeschen, wie bei einer Loeschanfrage');
await cloud.deleteEverything(ownerToken);
ok((await cloud.latestMeta()) === null, 'keine Sicherungen mehr');
ok((await cloud.listDevices()).length === 0, 'keine Geraete mehr');
ok((await cloud.getProfile()) === null, 'kein Profil mehr');
console.log(`\nKonto ${mail} bleibt uebrig und muss von Hand geloescht werden.`);
