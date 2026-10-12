// 예약 함수: 5분마다 모든 구독자의 시간표를 확인해 강의 N분 전 알림을 보낸다.
import { subsStore, configStore, getVapidKeys, sendPush } from '../lib/push.mjs';
import { dueAlarms, pruneSent } from '../lib/alarms.mjs';

export default async () => {
  const store = subsStore();
  const { blobs } = await store.list();
  const now = new Date();
  let sentCount = 0, errors = 0;
  // 실행 기록: 앱에서 "서버가 마지막으로 확인한 시각"을 보여주는 데 쓴다.
  const heartbeat = () => configStore().setJSON('last-run', { at: now.toISOString(), subscribers: blobs.length, sent: sentCount, errors });
  if (!blobs.length) { await heartbeat(); return; }
  const keys = await getVapidKeys();

  for (const { key } of blobs) {
    const rec = await store.get(key, { type: 'json' });
    if (!rec || !rec.subscription) continue;
    const due = dueAlarms(rec, now);
    if (!due.length) continue;

    const sent = pruneSent(rec.sent, now);
    let gone = false;
    for (const a of due) {
      const r = await sendPush(rec.subscription, a.payload, keys);
      if (r === 'gone') { gone = true; break; }
      if (r === 'ok') { sent[a.key] = true; sentCount++; }
      if (r === 'error') errors++;
    }
    if (gone) await store.delete(key); // 앱 삭제·권한 해제된 구독 정리
    else await store.setJSON(key, { ...rec, sent, lastSentAt: now.toISOString() });
  }
  await heartbeat();
  console.log(`checked ${blobs.length} subscribers, sent ${sentCount} alarms, errors ${errors}`);
};

// UTC 기준 cron. 5분마다 실행 (한국 시간도 매 5분 정각과 동일)
export const config = { schedule: '*/5 * * * *' };
