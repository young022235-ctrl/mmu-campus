// 강의평가 공용 로직: 과목명 정리, 입력 검사, 욕설 필터 (서버·테스트 공용)
import { createHash } from 'node:crypto';

export const LIMITS = {
  textMin: 5,
  textMax: 300,
  courseMax: 40,
  hideAfterReports: 3, // 신고 3번이면 자동 숨김
  writesPerDay: 15,     // 한 기기/IP당 하루 작성·수정·신고 횟수
};
export const WORKLOAD = ['적음', '보통', '많음'];
export const DIFFICULTY = ['쉬움', '보통', '어려움'];

// 화면에 보여줄 과목명: 공백 정리
export function displayCourse(name) {
  return String(name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, LIMITS.courseMax);
}

// 같은 과목으로 묶을 키: 공백·괄호 표기 차이와 로마숫자(Ⅱ↔II)를 무시
const ROMAN = { 'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV', 'Ⅴ': 'V', 'ⅰ': 'I', 'ⅱ': 'II', 'ⅲ': 'III' };
export function courseKey(name) {
  let s = displayCourse(name).toUpperCase();
  s = s.replace(/[ⅠⅡⅢⅣⅤⅰⅱⅲ]/g, (c) => ROMAN[c]);
  s = s.replace(/[\s·•\-_()[\]（）]/g, '');
  return s;
}
export const courseId = (name) => createHash('sha256').update(courseKey(name)).digest('hex').slice(0, 24);

// 기기 ID는 수정·삭제 권한 증명용이라 그대로 저장하지 않고 해시만 저장
export const authorHash = (deviceId) => createHash('sha256').update('review-author:' + String(deviceId)).digest('hex').slice(0, 24);

// 욕설·비방 표현 (일부러 띄어 쓰거나 기호를 넣어도 걸리도록 비교 전에 정리)
const BAD = [
  '시발', '씨발', '씨바','ㅅㅂ', 'ㅆㅂ', '병신', 'ㅂㅅ', '븅신', '좆', 'ㅈㄴ', '존나', '졸라', '개새', '개색', '새끼', 'ㅅㄲ',
  '지랄', 'ㅈㄹ', '닥쳐', '꺼져', '미친놈', '미친년', '또라이', '등신', '멍청이', '쓰레기같', '애미', '애비', '느금', '니미',
  '엠창', '썅', 'fuck', 'shit', 'bitch',
];
export function hasBadWord(text) {
  const t = String(text).toLowerCase().replace(/[\s.,!?~^*_\-·]/g, '');
  return BAD.some((w) => t.includes(w));
}
// 전화번호·이메일 같은 개인정보
export const hasPersonalInfo = (text) => /01[016789][-\s]?\d{3,4}[-\s]?\d{4}|[\w.+-]+@[\w-]+\.[\w.]+/.test(String(text));

// 작성 내용 검사 → { ok, value } 또는 { ok:false, error }
export function validateReview(body) {
  const course = displayCourse(body.course);
  if (courseKey(course).length < 2) return { ok: false, error: '과목명을 입력해주세요.' };
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: '별점을 골라주세요.' };
  const workload = WORKLOAD.includes(body.workload) ? body.workload : '보통';
  const difficulty = DIFFICULTY.includes(body.difficulty) ? body.difficulty : '보통';
  const semester = /^\d{4}-[12]$/.test(String(body.semester)) ? String(body.semester) : '';
  const text = String(body.text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (text.length < LIMITS.textMin) return { ok: false, error: `후기를 ${LIMITS.textMin}자 이상 써주세요.` };
  if (text.length > LIMITS.textMax) return { ok: false, error: `후기는 ${LIMITS.textMax}자까지 쓸 수 있어요.` };
  if (hasBadWord(text) || hasBadWord(course)) return { ok: false, error: '욕설이나 비방 표현은 쓸 수 없어요. 강의 내용 위주로 작성해주세요.' };
  if (hasPersonalInfo(text)) return { ok: false, error: '전화번호나 이메일 같은 개인정보는 쓸 수 없어요.' };
  return { ok: true, value: { course, rating, workload, difficulty, semester, text } };
}

// 저장된 후기 목록 → 화면용 요약
export function summarize(reviews) {
  const shown = reviews.filter((r) => !r.hidden);
  const n = shown.length;
  const avg = n ? Math.round((shown.reduce((s, r) => s + r.rating, 0) / n) * 10) / 10 : 0;
  const count = (field, value) => shown.filter((r) => r[field] === value).length;
  return {
    count: n,
    avg,
    workload: Object.fromEntries(WORKLOAD.map((w) => [w, count('workload', w)])),
    difficulty: Object.fromEntries(DIFFICULTY.map((d) => [d, count('difficulty', d)])),
  };
}
