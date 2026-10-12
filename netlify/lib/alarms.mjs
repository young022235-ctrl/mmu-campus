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
    // 검사 간격(5분) 안에 알림 시점이 들어오면 발송. 이미 보낸 건 건너뜀.
    if (left > 0 && left <= alarmMin && left > alarmMin - CHECK_INTERVAL_MIN && !sent[key]) {
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

// 오늘이 아닌 발송 기록은 지워서 기록이 계속 커지지 않게 한다.
export function pruneSent(sent = {}, date = new Date()) {
  const { dateKey } = kstNow(date);
  const next = {};
  for (const k of Object.keys(sent)) if (k.startsWith(dateKey + '|')) next[k] = true;
  return next;
}
