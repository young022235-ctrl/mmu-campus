// POST   /api/subscribe  { subscription, classes, alarmMin } → 구독·시간표 저장/갱신
// DELETE /api/subscribe  { endpoint }                         → 알림 해제
import { subsStore, subKey, json } from '../lib/push.mjs';

const MAX_CLASSES = 40;

function cleanClasses(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_CLASSES).map((c) => ({
    id: String(c.id).slice(0, 40),
    n: String(c.n || '').slice(0, 60),
    days: Array.isArray(c.days) ? c.days.filter((d) => '일월화수목금토'.includes(d)).slice(0, 7) : [],
    start: /^\d{2}:\d{2}$/.test(c.start) ? c.start : '',
    end: /^\d{2}:\d{2}$/.test(c.end) ? c.end : '',
    room: String(c.room || '').slice(0, 60),
    on: !!c.on,
  }));
}

export default async (req) => {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const store = subsStore();

  if (req.method === 'DELETE') {
    if (!body.endpoint) return json({ error: 'endpoint required' }, 400);
    await store.delete(subKey(body.endpoint));
    return json({ ok: true });
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const sub = body.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys) {
    return json({ error: 'invalid subscription' }, 400);
  }
  const key = subKey(sub.endpoint);
  const prev = (await store.get(key, { type: 'json' })) || {};
  const alarmMin = Math.min(60, Math.max(5, Number(body.alarmMin) || 10));
  await store.setJSON(key, {
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    classes: cleanClasses(body.classes),
    alarmMin,
    sent: prev.sent || {},
    updatedAt: new Date().toISOString(),
  });
  return json({ ok: true });
};

export const config = { path: '/api/subscribe' };
