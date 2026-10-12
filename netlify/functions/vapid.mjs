// GET /api/vapid → 브라우저가 구독할 때 쓰는 공개키
import { getVapidKeys, json } from '../lib/push.mjs';

export default async () => {
  const { publicKey } = await getVapidKeys();
  return json({ publicKey });
};

export const config = { path: '/api/vapid' };
