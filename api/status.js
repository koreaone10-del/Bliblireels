// api/status.js — polls the Render worker for job state.
import { verifySessionToken } from './auth.js';

const WORKER_URL = process.env.WORKER_URL || '';
const REQUEST_TIMEOUT_MS = 10_000;
const REQUEST_ID_PATTERN = /^[a-f0-9]{16,64}$/;

function bearerFromHeader(req) {
  const raw = req.headers['authorization'] || req.headers['Authorization'];
  if (typeof raw !== 'string') return '';
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'طريقة غير مدعومة.' });
  }
  if (!WORKER_URL) return res.status(503).json({ ok: false, error: 'WORKER_URL غير مضبوط.' });

  const session = bearerFromHeader(req);
  if (!verifySessionToken(session)) return res.status(401).json({ ok: false, error: 'جلسة منتهية.' });

  const requestId = typeof req.query?.requestId === 'string' ? req.query.requestId : '';
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    return res.status(400).json({ ok: false, error: 'معرّف غير صالح.' });
  }

  res.setHeader('Cache-Control', 'no-store');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${WORKER_URL}/api/status?requestId=${encodeURIComponent(requestId)}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({ ok: false, error: 'تعذر الاتصال بالعامل.' });
  } finally {
    clearTimeout(timeoutId);
  }
}
