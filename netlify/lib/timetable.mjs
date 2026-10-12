// 학사행정 시간표 캡처 → 앱 시간표 변환 (AI가 읽은 "칸" 목록을 강의 블록으로 합친다)
//
// AI에게는 칸 하나하나(요일·교시·과목·강의실)만 읽게 하고,
// 연속 교시 합치기·시간 계산은 여기서 코드로 정확하게 처리한다.

export const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 교시 → 시각. 앱의 기존 규칙과 같음: 1교시 09:00~10:00, n교시는 (8+n)시 시작, 60분 단위.
const FIRST_HOUR = 8; // 0교시 시작 시각
const pad = (n) => String(n).padStart(2, '0');
export const periodStart = (p) => `${pad(FIRST_HOUR + p)}:00`;
export const periodEnd = (p) => `${pad(FIRST_HOUR + p + 1)}:00`;

const clean = (s, max = 60) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const normDay = (d) => {
  const s = clean(d, 10);
  const c = s[0];
  return DAYS.includes(c) ? c : null; // "화요일" → "화"
};

// "9115(미래융복합관)" / "미래융복합관 9115" / room+building 따로 → "미래융복합관 9115"
export function formatRoom(room, building) {
  let r = clean(room, 40), b = clean(building, 40);
  const m = r.match(/^(.*?)\s*\((.+)\)\s*$/); // 9115(미래융복합관)
  if (m) { r = m[1].trim(); if (!b) b = m[2].trim(); }
  if (b && r.includes(b)) return r;
  return [b, r].filter(Boolean).join(' ');
}

// cells: [{day, period, course, room, building}] → classes: [{n, days, dayStr, start, end, room, on}]
export function cellsToClasses(cells) {
  const groups = new Map();
  for (const c of Array.isArray(cells) ? cells : []) {
    const day = normDay(c.day);
    const period = Number(c.period);
    const n = clean(c.course);
    if (!day || !Number.isInteger(period) || period < 0 || period > 14 || !n) continue;
    const room = formatRoom(c.room, c.building);
    const key = `${day}|${n}|${room}`;
    if (!groups.has(key)) groups.set(key, { day, n, room, periods: new Set() });
    groups.get(key).periods.add(period);
  }
  const out = [];
  for (const g of groups.values()) {
    const ps = [...g.periods].sort((a, b) => a - b);
    // 연속 교시끼리 하나의 강의로 (1,2,3 → 1~3교시 / 1,2,5 → 두 강의)
    let runStart = ps[0], prev = ps[0];
    const flush = (a, b) => out.push({ n: g.n, days: [g.day], dayStr: g.day, start: periodStart(a), end: periodEnd(b), room: g.room, on: true, periods: [a, b] });
    for (const p of ps.slice(1)) {
      if (p === prev + 1) { prev = p; continue; }
      flush(runStart, prev); runStart = prev = p;
    }
    flush(runStart, prev);
  }
  // 요일 → 시작시간 순 정렬
  out.sort((a, b) => DAYS.indexOf(a.days[0]) - DAYS.indexOf(b.days[0]) || a.start.localeCompare(b.start));
  return out;
}

// AI 응답 도구 형식 (Claude tool use 스키마)
export const TIMETABLE_TOOL = {
  name: 'report_timetable',
  description: '시간표 이미지에서 읽은 수업 칸 목록을 보고한다.',
  input_schema: {
    type: 'object',
    properties: {
      cells: {
        type: 'array',
        description: '수업이 적힌 칸 하나당 항목 하나. 같은 과목이 여러 교시에 걸쳐 있으면 교시마다 따로 적는다.',
        items: {
          type: 'object',
          properties: {
            day: { type: 'string', enum: ['월', '화', '수', '목', '금', '토', '일'] },
            period: { type: 'integer', description: '왼쪽 열의 교시 번호 (0, 1, 2 ...)' },
            course: { type: 'string', description: '과목명 (칸의 첫 줄)' },
            room: { type: 'string', description: '강의실 번호, 예: 9115' },
            building: { type: 'string', description: '건물명, 예: 미래융복합관' },
          },
          required: ['day', 'period', 'course'],
        },
      },
      unscheduled: {
        type: 'array',
        items: { type: 'string' },
        description: '"시간표가 없는 수강 신청 과목"에 적힌 과목명들 (온라인 강의 등)',
      },
    },
    required: ['cells'],
  },
};

export const TIMETABLE_PROMPT = `이 이미지는 목포해양대학교 학사행정 시스템의 "개인 시간표" 화면 캡처입니다.
표의 열은 요일(월~토), 행은 왼쪽 숫자 교시(0, 1, 2, ...)입니다.
수업이 적힌 칸마다 요일, 교시, 과목명(첫 줄), 강의실 번호와 건물명(둘째 줄, 예: "9115(미래융복합관)")을 읽어 report_timetable 도구로 보고하세요.
- 빈 칸은 넣지 마세요. 같은 과목이 연속 교시에 반복되면 교시마다 하나씩 넣으세요.
- 교수명(셋째 줄), 학생 이름, IP 주소 같은 개인정보는 넣지 마세요.
- 글자가 잘려 확실하지 않은 칸은 보이는 그대로 적으세요. 추측해서 만들어내지 마세요.
- 여러 장이면 같은 칸이 겹쳐 보여도 한 번만 넣으세요.`;
