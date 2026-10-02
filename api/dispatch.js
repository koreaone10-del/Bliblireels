// api/dispatch.js — coordinates: Render downloads, GitHub processes.
import { verifySessionToken } from './auth.js';

const DOWNLOADER_URL = process.env.DOWNLOADER_URL || '';
const DOWNLOADER_SECRET = process.env.DOWNLOADER_SECRET || '';
const GH_TOKEN = process.env.GH_WORKER_TOKEN || '';
const GH_REPO = process.env.GH_WORKER_REPO || 'koreaone10-del/BiliReels-Worker';
const REQUEST_TIMEOUT_MS = 15_000;
const ALLOWED_DOMAINS = ['bilibili.com', 'bilibili.tv', 'b23.tv', 'bili.im', 'bili2233.cn'];
const MAX_URL_LENGTH = 4096;
const MIN_DURATION = 5;
const MAX_DURATION = 600; // 10 minutes max

function isDomain(hostname, domains) {
  const host = (hostname || '').toLowerCase().replace(/\.$/, '');
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function validateSourceUrl(value) {
  if (typeof value !== 'string') return { error: 'رابط المصدر مطلوب.' };
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return { error: 'رابط المصدر فارغ أو طويل.' };
  let parsed;
  try { parsed = new URL(trimmed); } catch { return { error: 'صيغة الرابط غير صحيحة.' }; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { error: 'استخدم HTTPS.' };
  if (parsed.username || parsed.password) return { error: 'الرابط يحتوي بيانات دخول.' };
  if (!isDomain(parsed.hostname, ALLOWED_DOMAINS)) return { error: 'رابط BiliBili غير مدعوم.' };
  parsed.protocol = 'https:';
  return { value: parsed.href };
}

function validateDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return { error: 'المدة رقم غير صالح.' };
  const d = Math.round(n);
  if (d < MIN_DURATION || d > MAX_DURATION) return { error: `المدة بين ${MIN_DURATION} و${MAX_DURATION}.` };
  return { value: d };
}

function validateLogoUrl(value) {
  if (value === undefined || value === null || value === '') return { value: '' };
  const trimmed = String(value).trim();
  if (!trimmed) return { value: '' };
  if (trimmed.length > 2048) return { error: 'رابط الشعار طويل.' };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return { error: 'رابط الشعار HTTPS فقط.' };
    return { value: parsed.href };
  } catch { return { error: 'رابط الشعار غير صالح.' }; }
}

function generateRequestId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return null; } }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

function bearerFromHeader(req) {
  const raw = req.headers['authorization'] || req.headers['Authorization'];
  if (typeof raw !== 'string') return '';
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'طريقة غير مدعومة.' });
  }

  if (!DOWNLOADER_URL) return res.status(503).json({ ok: false, error: 'DOWNLOADER_URL غير مضبوط.' });
  if (!GH_TOKEN) return res.status(503).json({ ok: false, error: 'GH_WORKER_TOKEN غير مضبوط.' });

  const session = bearerFromHeader(req);
  if (!verifySessionToken(session)) return res.status(401).json({ ok: false, error: 'الجلسة منتهية.' });

  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'طلب فارغ.' });

  const src = validateSourceUrl(body.source_url);
  if (src.error) return res.status(400).json({ ok: false, error: src.error });
  const dur = validateDuration(body.duration);
  if (dur.error) return res.status(400).json({ ok: false, error: dur.error });
  const logo = validateLogoUrl(body.logo_url);
  if (logo.error) return res.status(400).json({ ok: false, error: logo.error });

  const requestId = generateRequestId();

  // Step 1: Trigger Render download
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const dlResponse = await fetch(`${DOWNLOADER_URL}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        source_url: src.value,
        request_id: requestId,
        client_secret: DOWNLOADER_SECRET,
      }),
      signal: controller.signal,
    });

    if (!dlResponse.ok && dlResponse.status !== 202) {
      const text = await dlResponse.text();
      return res.status(502).json({ ok: false, error: `فشل بدء التحميل: ${text.slice(0, 150)}` });
    }
  } catch (error) {
    return res.status(502).json({ ok: false, error: error?.name === 'AbortError' ? 'انتهت مهلة الاتصال بـRender.' : 'تعذر الوصول إلى Render.' });
  } finally {
    clearTimeout(timeoutId);
  }

  // Step 2: Pre-trigger GitHub Actions (it will download from Upstash after Render finishes)
  // We don't have the Upstash URL yet, so we'll trigger GitHub from the status endpoint.
  // For now, return the requestId and let /api/status handle the transition.

  return res.status(202).json({
    ok: true,
    requestId,
    statusUrl: `/api/status?requestId=${encodeURIComponent(requestId)}`,
    message: 'بدأ التحميل على Render. ستبدأ المعالجة تلقائيًا بعد اكتمال التحميل.',
    options: {
      duration: dur.value,
      logo_url: logo.value,
      generate_subtitles: body.generate_subtitles === true || body.generate_subtitles === '1',
    },
  });
}
