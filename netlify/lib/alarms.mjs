// 강의 알림 계산 로직 (서버/테스트 공용)
// 시간표의 시각은 모두 한국 시간(KST, UTC+9) 기준이다.

export const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const CHECK_INTERVAL_MIN = 5; // 예약 함수가 도는 간격(분)

const toMin = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
};

// 현재 시각(Date)을 한국 시간 기준 { dateKey, day, nowMin }으로 변환
export function kstNow(date = new Date()) {
  const k = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = k.getUTCFullYear();
  const mo = String(k.getUTCMonth() + 1).padStart(2, '0');
  const d = String(k.getUTCDate()).padStart(2, '0');
  return {
    dateKey: `${y}-${mo}-${d}`,
    day: DAYS[k.getUTCDay()],
    nowMin: k.getUTCHours() * 60 + k.getUTCMinutes(),
  };
}

// 한 사용자 기록에서 지금 보내야 할 알림 목록을 계산한다.
// record = { classes:[{id,n,days,start,end,room,on}], alarmMin, sent:{key:true} }
export function dueAlarms(record, date = new Date()) {
  const { dateKey, day, nowMin } = kstNow(date);
  const alarmMin = Number(record.alarmMin) || 10;
  const sent = record.sent || {};
  const out = [];
  for (const c of record.classes || []) {
    if (!c || !c.on || !Array.isArray(c.days) || !c.days.includes(day) || !c.start) continue;
    const left = toMin(c.start) - nowMin;
    const key = `${dateKey}|${c.id}`;
    // 알림 시간 안으로 들어온 강의는 (아직 안 보냈으면) 바로 발송.
    // 늦게 등록해서 알림 시점을 지났더라도 수업 시작 전이면 "N분 전"으로 보낸다.
    if (left > 0 && left <= alarmMin && !sent[key]) {
      out.push({
        key,
        payload: {
          title: `${c.n} ${left}분 전`,
          body: `${c.start} 시작${c.room ? ' · ' + c.room : ''}`,
          tag: `class-${c.id}`,
        },
      });
    }
  }
  return out;
}

// 오늘 남은 강의 중 다음 알림 (상태 확인용)
export function nextAlarm(record, date = new Date()) {
  const { day, nowMin, dateKey } = kstNow(date);
  const alarmMin = Number(record.alarmMin) || 10;
  let best = null;
  for (const c of record.classes || []) {
    if (!c || !c.on || !Array.isArray(c.days) || !c.days.includes(day) || !c.start) continue;
    const start = toMin(c.start);
    if (start <= nowMin || (record.sent || {})[`${dateKey}|${c.id}`]) continue;
    const at = Math.max(start - alarmMin, nowMin);
    if (!best || at < best.atMin) best = { atMin: at, name: c.n, start: c.start };
  }
  if (!best) return null;
  const hh = String(Math.floor(best.atMin / 60)).padStart(2, '0'), mm = String(best.atMin % 60).padStart(2, '0');
  return { name: best.name, start: best.start, at: `${hh}:${mm}` };
}

// 오늘이 아닌 발송 기록은 지워서 기록이 계속 커지지 않게 한다.
export function pruneSent(sent = {}, date = new Date()) {
  const { dateKey } = kstNow(date);
  const next = {};
  for (const k of Object.keys(sent)) if (k.startsWith(dateKey + '|')) next[k] = true;
  return next;
}
