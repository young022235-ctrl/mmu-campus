// 푸시 발송 공용 도구: VAPID 키 관리, 구독 저장소, 발송
import { getStore } from '@netlify/blobs';
import webpush from 'web-push';
import { createHash } from 'node:crypto';

export const subsStore = () => getStore('push-subscriptions');
const configStore = () => getStore('push-config');

export const subKey = (endpoint) => createHash('sha256').update(String(endpoint)).digest('hex');

// VAPID 키는 처음 한 번 자동으로 만들어 저장소에 보관한다 (환경변수 설정 불필요).
export async function getVapidKeys() {
  const store = configStore();
  let keys = await store.get('vapid', { type: 'json', consistency: 'strong' });
  if (!keys || !keys.publicKey || !keys.privateKey) {
    keys = webpush.generateVAPIDKeys();
    await store.setJSON('vapid', keys);
  }
  return keys;
}

// 하나의 구독으로 알림을 보낸다. 만료된 구독이면 'gone'을 돌려준다.
export async function sendPush(subscription, payload, keys) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails: {
        subject: 'mailto:campus-helper@example.com',
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
      },
      TTL: 60 * 30,
      urgency: 'high',
    });
    return 'ok';
  } catch (e) {
    if (e && (e.statusCode === 404 || e.statusCode === 410)) return 'gone';
    console.error('push failed', e && e.statusCode, e && e.body);
    return 'error';
  }
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
