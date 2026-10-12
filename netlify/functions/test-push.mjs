// POST /api/test-push { endpoint } → 몇 초 뒤 이 기기로 테스트 푸시를 보낸다.
// 그 사이 앱을 완전히 닫아 두면 "앱을 꺼도 알림이 오는지" 확인할 수 있다.
import { subsStore, subKey, getVapidKeys, sendPush, json } from '../lib/push.mjs';

const DELAY_MS = 6000; // 일반 함수 실행 제한(10초) 안에서 기다림

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (!body.endpoint) return json({ error: 'endpoint required' }, 400);

  const rec = await subsStore().get(subKey(body.endpoint), { type: 'json' });
  if (!rec) return json({ error: 'not subscribed' }, 404);

  const keys = await getVapidKeys();
  await new Promise((r) => setTimeout(r, DELAY_MS));
  const first = (rec.classes || []).find((c) => c.on) || { n: '테스트 강의', start: '--:--', room: '' };
  const result = await sendPush(rec.subscription, {
    title: `[서버 테스트] ${first.n} ${rec.alarmMin}분 전`,
    body: `${first.start} 시작${first.room ? ' · ' + first.room : ''} — 앱이 닫혀 있어도 도착하면 성공!`,
    tag: 'server-test',
  }, keys);
  return json({ result });
};

export const config = { path: '/api/test-push' };
