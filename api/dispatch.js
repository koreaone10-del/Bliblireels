// api/dispatch.js — starts the Render download stage for the private GitHub Actions processor.
import { randomBytes } from 'node:crypto';
import { verifySessionToken } from './auth.js';

const WORKER_BASE = process.env.DOWNLOADER_URL || process.env.WORKER_URL || '';
const WORKER_SECRET = process.env.DOWNLOADER_SECRET || process.env.WORKER_SECRET || '';
const GH_TOKEN = process.env.GH_WORKER_TOKEN || '';
const MAX_URL_LENGTH = 4096;
const MIN_DURATION = 5;
const MAX_DURATION = 60;
const ALLOWED_DOMAINS = ['bilibili.com', 'bilibili.tv', 'b23.tv', 'bili.im', 'bili2233.cn'];
const REQUEST_TIMEOUT_MS = 12_000;

function isDomain(hostname, domains) {
  const host = (hostname || '').toLowerCase().replace(/\.$/, '');
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function normalizeWorkerBase(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function validateSourceUrl(value) {
  if (typeof value !== 'string') return { error: 'رابط المصدر مطلوب.' };
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return { error: 'رابط المصدر فارغ أو طويل.' };
  let parsed;
  try { parsed = new URL(trimmed); } catch { return { error: 'صيغة الرابط غير صحيحة.' }; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || (parsed.port && !['80', '443'].includes(parsed.port))) {
    return { error: 'استخدم رابط BiliBili عام عبر HTTPS.' };
  }
  if (!isDomain(parsed.hostname, ALLOWED_DOMAINS)) return { error: 'رابط BiliBili غير مدعوم.' };
  parsed.protocol = 'https:';
  parsed.port = '';
  return { value: parsed.href };
}

function validateDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return { error: 'المدة رقم غير صالح.' };
  const duration = Math.round(number);
  if (duration < MIN_DURATION || duration > MAX_DURATION) return { error: `المدة بين ${MIN_DURATION} و${MAX_DURATION} ثانية.` };
  return { value: duration };
}

function validateLogoUrl(value) {
  if (value === undefined || value === null || value === '') return { value: '' };
  const trimmed = String(value).trim();
  if (!trimmed) return { value: '' };
  if (trimmed.length > 2048) return { error: 'رابط الشعار طويل.' };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
      return { error: 'رابط الشعار يجب أن يكون HTTPS.' };
    }
    return { value: parsed.href };
  } catch {
    return { error: 'رابط الشعار غير صالح.' };
  }
}

function bearerFromHeader(req) {
  const raw = req.headers?.authorization || req.headers?.Authorization;
  if (typeof raw !== 'string') return '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'طريقة غير مدعومة.' });
  }

  const session = bearerFromHeader(req);
  if (!verifySessionToken(session)) return res.status(401).json({ ok: false, error: 'الجلسة منتهية.' });

  const workerBase = normalizeWorkerBase(WORKER_BASE);
  if (!workerBase) return res.status(503).json({ ok: false, error: 'عنوان عامل Render غير مضبوط. اضبط WORKER_URL في Vercel.' });
  if (!WORKER_SECRET) return res.status(503).json({ ok: false, error: 'سر العامل غير مضبوط. أضف DOWNLOADER_SECRET في Vercel.' });
  if (!GH_TOKEN) return res.status(503).json({ ok: false, error: 'GH_WORKER_TOKEN غير مضبوط في Vercel.' });

  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'طلب فارغ.' });
  const source = validateSourceUrl(body.source_url);
  if (source.error) return res.status(400).json({ ok: false, error: source.error });
  const duration = validateDuration(body.duration);
  if (duration.error) return res.status(400).json({ ok: false, error: duration.error });
  const logo = validateLogoUrl(body.logo_url);
  if (logo.error) return res.status(400).json({ ok: false, error: logo.error });

  const requestId = randomBytes(12).toString('hex');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${workerBase}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        source_url: source.value,
        request_id: requestId,
        client_secret: WORKER_SECRET,
        duration: duration.value,
        logo_url: logo.value,
        generate_subtitles: body.generate_subtitles === true || body.generate_subtitles === '1',
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok && response.status !== 202) {
      const detail = typeof data?.detail === 'string' ? data.detail : typeof data?.error === 'string' ? data.error : 'رفض عامل Render الطلب.';
      const code = response.status === 429 ? 409 : response.status === 401 || response.status === 503 ? 503 : response.status === 400 || response.status === 422 ? 400 : 502;
      return res.status(code).json({ ok: false, error: `فشل بدء التحميل: ${detail.slice(0, 180)}` });
    }
    return res.status(202).json({
      ok: true,
      requestId,
      statusUrl: `/api/status?requestId=${encodeURIComponent(requestId)}`,
      message: 'بدأ التحميل على Render؛ ستبدأ معالجة Reel بعد اكتماله.',
    });
  } catch (error) {
    const timeout = error?.name === 'AbortError' || error?.name === 'TimeoutError';
    return res.status(timeout ? 504 : 502).json({
      ok: false,
      error: timeout ? 'استغرق تشغيل عامل Render وقتًا طويلًا. انتظر قليلًا ثم أعد المحاولة.' : 'تعذر الوصول إلى عامل Render.',
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
