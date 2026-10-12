// POST /api/parse-timetable  { images: [{ data: "<base64>", mediaType: "image/jpeg" }] }
// → { classes: [...], unscheduled: [...] }   또는 { error: "..." }
//
// 학사행정 시간표 캡처를 Claude(이미지 인식)로 읽어 앱 시간표로 바꾼다.
// - API 키: Netlify 환경변수 ANTHROPIC_API_KEY (코드·GitHub에는 넣지 않음)
// - 이미지는 저장하지 않고 인식에만 쓴다.
// - 응답을 스트리밍으로 보내 Netlify의 일반 함수 시간 제한(약 10초) 대신 60초까지 쓸 수 있게 한다.
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { cellsToClasses, TIMETABLE_TOOL, TIMETABLE_PROMPT } from '../lib/timetable.mjs';

const MODEL = process.env.TIMETABLE_MODEL || 'claude-haiku-5-5';
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024; // 앱이 줄여서 보내므로 장당 1.5MB면 충분
const LIMIT_PER_IP = 10;  // 한 사람(IP)당 하루 인식 횟수
const LIMIT_TOTAL = 300;  // 사이트 전체 하루 인식 횟수 (요금 폭주 방지)
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const jsonRes = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

// 하루 사용량 확인 (한국 날짜 기준)
async function checkQuota(ip) {
  const store = getStore('timetable-usage');
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const rec = (await store.get(day, { type: 'json', consistency: 'strong' })) || { total: 0, ip: {} };
  const who = createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 16);
  if (rec.total >= LIMIT_TOTAL) return '오늘 사이트 전체 인식 횟수를 다 썼어요. 내일 다시 시도해주세요.';
  if ((rec.ip[who] || 0) >= LIMIT_PER_IP) return `오늘은 ${LIMIT_PER_IP}번까지 인식할 수 있어요. 내일 다시 시도해주세요.`;
  rec.total++; rec.ip[who] = (rec.ip[who] || 0) + 1;
  await store.setJSON(day, rec);
  return null;
}

async function askClaude(images, apiKey) {
  const content = [
    ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
    { type: 'text', text: TIMETABLE_PROMPT },
  ];
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      tools: [TIMETABLE_TOOL],
      tool_choice: { type: 'tool', name: TIMETABLE_TOOL.name },
      messages: [{ role: 'user', content }],
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    console.error('anthropic error', r.status, body.slice(0, 500));
    if (r.status === 401) throw new Error('AI 키가 올바르지 않아요 (관리자 설정 확인 필요)');
    if (r.status === 429 || r.status === 529) throw new Error('AI 서비스가 바빠요. 잠시 후 다시 시도해주세요.');
    if (r.status === 400 && /credit/i.test(body)) throw new Error('AI 사용 크레딧이 부족해요 (관리자 충전 필요)');
    throw new Error(`AI 인식 실패 (${r.status})`);
  }
  const data = await r.json();
  const use = (data.content || []).find((b) => b.type === 'tool_use' && b.name === TIMETABLE_TOOL.name);
  if (!use) throw new Error('AI가 시간표를 읽지 못했어요. 시간표 표가 잘 보이게 다시 캡처해주세요.');
  return use.input || {};
}

export async function handle(body, { ip, apiKey, quota = checkQuota, ask = askClaude } = {}) {
  if (!apiKey) return { status: 503, data: { error: '아직 AI 키가 설정되지 않았어요 (Netlify 환경변수 ANTHROPIC_API_KEY)' } };
  const images = Array.isArray(body && body.images) ? body.images : [];
  if (!images.length) return { status: 400, data: { error: '이미지를 선택해주세요.' } };
  if (images.length > MAX_IMAGES) return { status: 400, data: { error: `한 번에 ${MAX_IMAGES}장까지 올릴 수 있어요.` } };
  for (const img of images) {
    if (!img || typeof img.data !== 'string' || !TYPES.includes(img.mediaType)) return { status: 400, data: { error: '지원하지 않는 이미지 형식이에요.' } };
    if (img.data.length * 0.75 > MAX_IMAGE_BYTES) return { status: 413, data: { error: '이미지가 너무 커요.' } };
  }
  const blocked = await quota(ip);
  if (blocked) return { status: 429, data: { error: blocked } };

  const result = await ask(images, apiKey);
  const classes = cellsToClasses(result.cells);
  const unscheduled = (Array.isArray(result.unscheduled) ? result.unscheduled : [])
    .map((s) => String(s).replace(/[,，]\s*$/, '').trim()).filter(Boolean).slice(0, 20);
  if (!classes.length) return { status: 422, data: { error: '시간표에서 수업을 찾지 못했어요. 표 부분이 보이게 다시 캡처해주세요.', unscheduled } };
  return { status: 200, data: { classes, unscheduled } };
}

export default async (req, context) => {
  if (req.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405);
  let body;
  try { body = await req.json(); } catch { return jsonRes({ error: '요청 형식이 올바르지 않아요.' }, 400); }

  // 스트리밍 응답: 처리하는 동안 공백을 보내 연결을 유지하고, 끝나면 JSON 한 덩어리를 보낸다.
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const beat = setInterval(() => ctrl.enqueue(enc.encode(' ')), 4000);
      let out;
      try {
        out = await handle(body, { ip: context && context.ip, apiKey: process.env.ANTHROPIC_API_KEY });
      } catch (e) {
        out = { status: 500, data: { error: e.message || '인식 중 오류가 났어요.' } };
      }
      clearInterval(beat);
      ctrl.enqueue(enc.encode(JSON.stringify({ ...out.data, status: out.status })));
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
};

export const config = { path: '/api/parse-timetable' };
