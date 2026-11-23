// 강의평가 API  (/api/reviews)
//   GET    /api/reviews                    → 과목 목록 [{id, name, count, avg}]
//   GET    /api/reviews?course=과목명       → 과목 요약 + 후기 목록 (숨김 제외, 내 후기 표시)
//   POST   /api/reviews  {deviceId, course, rating, workload, difficulty, semester, text} → 작성/수정
//   POST   /api/reviews  {action:"report", deviceId, course, reviewId}                   → 신고
//   DELETE /api/reviews  {deviceId, course}                                               → 내 후기 삭제
// 로그인 대신 기기마다 만든 무작위 deviceId(헤더 x-device-id 또는 본문)로 "내 후기"를 구분한다.
import { getStore } from '@netlify/blobs';
import { createHash, randomUUID } from 'node:crypto';
import { courseId, displayCourse, authorHash, validateReview, summarize, LIMITS } from '../lib/reviews.mjs';

const store = () => getStore('course-reviews');
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const validDevice = (d) => typeof d === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(d);

async function readCourse(id) {
  return (await store().get(`course/${id}`, { type: 'json', consistency: 'strong' })) || null;
}
async function readIndex() {
  return (await store().get('index', { type: 'json', consistency: 'strong' })) || { courses: {} };
}
async function saveCourse(id, rec) {
  await store().setJSON(`course/${id}`, rec);
  const index = await readIndex();
  const s = summarize(rec.reviews);
  if (s.count) index.courses[id] = { name: rec.name, count: s.count, avg: s.avg, updatedAt: new Date().toISOString() };
  else delete index.courses[id];
  await store().setJSON('index', index);
}

// 하루 작성 횟수 제한 (기기와 IP 각각)
async function overLimit(keys) {
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const k = `usage/${day}`;
  const rec = (await store().get(k, { type: 'json', consistency: 'strong' })) || {};
  const ids = keys.filter(Boolean).map((x) => createHash('sha256').update(String(x)).digest('hex').slice(0, 16));
  if (ids.some((id) => (rec[id] || 0) >= LIMITS.writesPerDay)) return true;
  ids.forEach((id) => { rec[id] = (rec[id] || 0) + 1; });
  await store().setJSON(k, rec);
  return false;
}

function publicReview(r, me) {
  return {
    id: r.id, rating: r.rating, workload: r.workload, difficulty: r.difficulty, semester: r.semester,
    text: r.text, createdAt: r.createdAt, updatedAt: r.updatedAt, mine: r.author === me,
    reported: !!(me && (r.reports || []).includes(me)),
  };
}

export async function handle(req, ip) {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const course = url.searchParams.get('course');
    if (!course) {
      const index = await readIndex();
      const courses = Object.entries(index.courses).map(([id, c]) => ({ id, ...c }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));
      return json({ courses });
    }
    const device = req.headers.get('x-device-id');
    const me = validDevice(device) ? authorHash(device) : null;
    const rec = await readCourse(courseId(course));
    if (!rec) return json({ course: displayCourse(course), summary: summarize([]), reviews: [] });
    const reviews = rec.reviews.filter((r) => !r.hidden || r.author === me)
      .sort((a, b) => (b.author === me) - (a.author === me) || b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ ...publicReview(r, me), hidden: r.hidden && r.author === me }));
    return json({ course: rec.name, summary: summarize(rec.reviews), reviews });
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: '요청 형식이 올바르지 않아요.' }, 400); }
  if (!validDevice(body.deviceId)) return json({ error: '기기 정보가 없어요. 앱을 새로고침해주세요.' }, 400);
  const me = authorHash(body.deviceId);

  if (req.method === 'DELETE') {
    const id = courseId(body.course);
    const rec = await readCourse(id);
    if (!rec || !rec.reviews.some((r) => r.author === me)) return json({ error: '삭제할 내 후기가 없어요.' }, 404);
    rec.reviews = rec.reviews.filter((r) => r.author !== me);
    await saveCourse(id, rec);
    return json({ ok: true, summary: summarize(rec.reviews) });
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (await overLimit([body.deviceId, ip])) return json({ error: `오늘은 ${LIMITS.writesPerDay}번까지 작성·신고할 수 있어요. 내일 다시 시도해주세요.` }, 429);

  if (body.action === 'report') {
    const id = courseId(body.course);
    const rec = await readCourse(id);
    const r = rec && rec.reviews.find((x) => x.id === body.reviewId);
    if (!r) return json({ error: '후기를 찾을 수 없어요.' }, 404);
    if (r.author === me) return json({ error: '내 후기는 신고할 수 없어요.' }, 400);
    r.reports = r.reports || [];
    if (!r.reports.includes(me)) r.reports.push(me);
    if (r.reports.length >= LIMITS.hideAfterReports) r.hidden = true;
    await saveCourse(id, rec);
    return json({ ok: true, hidden: !!r.hidden });
  }

  const v = validateReview(body);
  if (!v.ok) return json({ error: v.error }, 400);
  const id = courseId(v.value.course);
  const rec = (await readCourse(id)) || { name: v.value.course, reviews: [] };
  const now = new Date().toISOString();
  const mine = rec.reviews.find((r) => r.author === me);
  if (mine) {
    // 수정하면 신고 기록을 초기화하고 다시 공개 (같은 내용으로 재신고되면 다시 숨김)
    Object.assign(mine, v.value, { updatedAt: now, reports: [], hidden: false });
    delete mine.course;
  } else {
    const { course, ...rest } = v.value;
    rec.reviews.push({ id: randomUUID().slice(0, 12), author: me, ...rest, createdAt: now, updatedAt: now, reports: [], hidden: false });
  }
  await saveCourse(id, rec);
  return json({ ok: true, updated: !!mine, summary: summarize(rec.reviews) });
}

export default async (req, context) => {
  try {
    return await handle(req, context && context.ip);
  } catch (e) {
    console.error('reviews error', e);
    return json({ error: '서버 오류가 났어요. 잠시 후 다시 시도해주세요.' }, 500);
  }
};

export const config = { path: '/api/reviews' };
