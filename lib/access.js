import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'bili_session';
const SESSION_SECONDS = 12 * 60 * 60;

export function configuredAccessCode() {
  const value = process.env.BILIREELS_ACCESS_CODE || '';
  return value.length >= 24 ? value : '';
}

export function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function signature(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function makeSession(secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const expires = nowSeconds + SESSION_SECONDS;
  const payload = `v1.${expires}`;
  return { value: `${payload}.${signature(payload, secret)}`, expires };
}

export function isSessionValid(req, secret = configuredAccessCode(), nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) return false;
  const cookieHeader = req.headers?.cookie || '';
  const cookie = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return false;
  let value;
  try { value = decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)); } catch { return false; }
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^\d+$/.test(parts[1])) return false;
  const expires = Number(parts[1]);
  if (!Number.isSafeInteger(expires) || expires <= nowSeconds || expires > nowSeconds + SESSION_SECONDS + 60) return false;
  const payload = `v1.${expires}`;
  return constantTimeEqual(parts[2], signature(payload, secret));
}

export function isSameOrigin(req) {
  const origin = req.headers?.origin;
  if (typeof origin !== 'string' || !origin) return false;
  const hostHeader = req.headers?.['x-forwarded-host'] || req.headers?.host || '';
  const host = String(Array.isArray(hostHeader) ? hostHeader[0] : hostHeader).split(',')[0].trim().toLowerCase();
  const protoHeader = req.headers?.['x-forwarded-proto'] || 'https';
  const proto = String(Array.isArray(protoHeader) ? protoHeader[0] : protoHeader).split(',')[0].trim().toLowerCase();
  if (!host || !['http', 'https'].includes(proto)) return false;
  return origin === `${proto}://${host}`;
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
}

export function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}
