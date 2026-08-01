import { VAPID_PUBLIC_KEY } from './cloud-config.js';
import { savePushSubscription } from './cloud.js';

export function supported() {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function permission() {
  return supported() ? Notification.permission : 'unsupported';
}

export async function enable() {
  if (!supported()) throw Object.assign(new Error('PUSH_UNSUPPORTED'), { code: 'PUSH_UNSUPPORTED' });
  const result = await Notification.requestPermission();
  if (result !== 'granted') throw Object.assign(new Error('PUSH_DENIED'), { code: 'PUSH_DENIED' });
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  subscription ||= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeKey(VAPID_PUBLIC_KEY),
  });
  const json = subscription.toJSON();
  await savePushSubscription({ endpoint: json.endpoint, keys: json.keys });
  return true;
}

export async function disable() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  await subscription?.unsubscribe();
}

function decodeKey(value) {
  const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
