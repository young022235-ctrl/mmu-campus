// POST /api/alarm-status { endpoint } → 이 기기의 서버 알림 상태
// { registered, classes, alarmMin, next: {name,start,at} | null, lastRun: {at, minutesAgo, subscribers, sent} | null }
// 앱에서 "서버가 제대로 돌고 있는지" 확인하는 용도.
import { subsStore, configStore, subKey, json } from '../lib/push.mjs';
import { nextAlarm } from '../lib/alarms.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const last = await configStore().get('last-run', { type: 'json' });
  const lastRun = last ? { ...last, minutesAgo: Math.round((Date.now() - Date.parse(last.at)) / 60000) } : null;
  if (!body.endpoint) return json({ registered: false, lastRun });
  const rec = await subsStore().get(subKey(body.endpoint), { type: 'json', consistency: 'strong' });
  if (!rec) return json({ registered: false, lastRun });
  return json({
    registered: true,
    classes: (rec.classes || []).filter((c) => c.on).length,
    alarmMin: rec.alarmMin,
    next: nextAlarm(rec),
    lastSentAt: rec.lastSentAt || null,
    lastRun,
  });
};

export const config = { path: '/api/alarm-status' };
