// api/auth.js
// Verifies the shared access code once and issues a short-lived HMAC session token.
// The raw access code never travels again after this endpoint returns.

import crypto from 'node:crypto';

const MAX_CODE_LENGTH = 256;
const MIN_CODE_LENGTH = 16;
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const BRUTE_FORCE_DELAY_MS = 250;

function getAccessCode() {
  const value = process.env.BILIREELS_ACCESS_CODE;
  if (!value || value.length < MIN_CODE_LENGTH) return null;
  return value;
}

function getSigningKey() {
  const code = getAccessCode();
  if (!code) return null;
  // Derive a signing key from the access code so we don't need a second secret.
  return crypto.createHash('sha256').update(`bilireels:session:${code}`).digest();
}

function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Perform a comparison anyway to keep timing roughly constant.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function issueToken() {
  const key = getSigningKey();
  if (!key) return null;
  const issuedAt = Date.now();
  const expiresAt = issuedAt + TOKEN_TTL_MS;
  const payload = `${issuedAt}.${expiresAt}`;
  const sig = crypto
    .createHmac('sha256', key)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

// Exported so dispatch.js and status.js can reuse it.
export function verifySessionToken(token) {
  if (typeof token !== 'string' || !token || token.length > 512) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [issuedAtStr, expiresAtStr, sig] = parts;
  const issuedAt = Number(issuedAtStr);
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return false;
  const now = Date.now();
  if (issuedAt > now + 60_000) return false; // guard against clock skew abuse
  if (now > expiresAt) return false;
  const key = getSigningKey();
  if (!key) return false;
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${issuedAtStr}.${expiresAtStr}`)
    .digest('base64url');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'طريقة الطلب غير مدعومة.' });
  }

  const expectedCode = getAccessCode();
  if (!expectedCode) {
    return res.status(503).json({
      ok: false,
      error:
        'العامل المجاني غير مفعّل بعد: متغير BILIREELS_ACCESS_CODE غير مضبوط على الخادم.',
    });
  }

  const body = await readJsonBody(req);
  const code = body && typeof body.code === 'string' ? body.code : '';
  if (!code || code.length > MAX_CODE_LENGTH) {
    return res.status(400).json({ ok: false, error: 'أدخل رمز الوصول.' });
  }

  if (!timingSafeEqualString(code, expectedCode)) {
    // Small delay to slow brute-force attempts.
    await new Promise((resolve) => setTimeout(resolve, BRUTE_FORCE_DELAY_MS));
    return res.status(401).json({ ok: false, error: 'رمز الوصول غير صحيح.' });
  }

  const token = issueToken();
  if (!token) {
    return res.status(503).json({
      ok: false,
      error: 'تعذر إصدار جلسة؛ أعد المحاولة.',
    });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    token,
    expiresInMs: TOKEN_TTL_MS,
  });
}
