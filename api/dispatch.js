// api/dispatch.js
// Validates the session and dispatches the GitHub Actions worker with the user's options.
// Never returns the GitHub token or the workflow inputs to the browser.

import { verifySessionToken } from './auth.js';

const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 12_000;
const ALLOWED_DOMAINS = ['bilibili.com', 'bilibili.tv', 'b23.tv', 'bili.im', 'bili2233.cn'];
const MAX_URL_LENGTH = 4096;
const MIN_DURATION = 5;
const MAX_DURATION = 60;
const MAX_LOGO_URL_LENGTH = 2048;

function isDomain(hostname, domains) {
  const host = (hostname || '').toLowerCase().replace(/\.$/, '');
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function validateSourceUrl(value) {
  if (typeof value !== 'string') return { error: 'رابط المصدر مطلوب.' };
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return { error: 'رابط المصدر فارغ أو أطول من الحد.' };
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: 'صيغة رابط المصدر غير صحيحة.' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { error: 'يجب استخدام رابط HTTPS.' };
  if (parsed.username || parsed.password) return { error: 'الرابط يحتوي على بيانات دخول مضمّنة.' };
  const port = parsed.port;
  if (port && port !== '443' && port !== '80') return { error: 'منفذ الرابط غير مسموح.' };
  if (!isDomain(parsed.hostname, ALLOWED_DOMAINS)) {
    return { error: 'الرابط غير مدعوم. استخدم رابطًا من BiliBili.' };
  }
  parsed.protocol = 'https:';
  return { value: parsed.href };
}

function validateDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return { error: 'المدة يجب أن تكون رقمًا.' };
  const duration = Math.round(n);
  if (duration < MIN_DURATION || duration > MAX_DURATION) {
    return { error: `المدة يجب أن تكون بين ${MIN_DURATION} و ${MAX_DURATION} ثانية.` };
  }
  return { value: duration };
}

function validateLogoUrl(value) {
  if (value === undefined || value === null || value === '') return { value: '' };
  if (typeof value !== 'string') return { error: 'رابط الشعار غير صالح.' };
  const trimmed = value.trim();
  if (!trimmed) return { value: '' };
  if (trimmed.length > MAX_LOGO_URL_LENGTH) return { error: 'رابط الشعار طويل جدًا.' };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return { error: 'رابط الشعار يجب أن يكون HTTPS.' };
    return { value: parsed.href };
  } catch {
    return { error: 'رابط الشعار غير صالح.' };
  }
}

function validateSubtitles(value) {
  return { value: value === true || value === 1 || value === '1' ? '1' : '0' };
}

function generateRequestId() {
  // Short, URL-safe, opaque. Not a secret — just a handle for status polling.
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
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

function bearerFromHeader(req) {
  const raw = req.headers['authorization'] || req.headers['Authorization'];
  if (typeof raw !== 'string') return '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function dispatchWorkflow({ token, repo, inputs }) {
  const url = `${GITHUB_API}/repos/${repo}/actions/workflows/process-reel.yml/dispatches`;
  const body = JSON.stringify({
    ref: 'main',
    inputs,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'BiliReels-Vercel-Dispatch',
      },
      body,
      signal: controller.signal,
    });

    if (response.status === 204) return { ok: true };
    let detail = '';
    try {
      const data = await response.json();
      detail = data && data.message ? String(data.message) : '';
    } catch {
      // ignore
    }
    return { ok: false, status: response.status, detail };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { ok: false, status: 504, detail: 'انتهت مهلة الاتصال بـGitHub.' };
    }
    return { ok: false, status: 502, detail: 'تعذر الوصول إلى GitHub.' };
  } finally {
    clearTimeout(timeoutId);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'طريقة الطلب غير مدعومة.' });
  }

  const githubToken = process.env.GH_WORKER_TOKEN;
  const repo = process.env.GH_WORKER_REPO || 'koreaone10-del/BiliReels-Worker';

  if (!githubToken) {
    return res.status(503).json({
      ok: false,
      error: 'العامل غير مفعّل بعد: GH_WORKER_TOKEN غير مضبوط على الخادم.',
    });
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return res.status(503).json({
      ok: false,
      error: 'إعداد GH_WORKER_REPO غير صالح.',
    });
  }

  const session = bearerFromHeader(req);
  if (!verifySessionToken(session)) {
    return res.status(401).json({ ok: false, error: 'الجلسة منتهية أو غير صالحة. أعد إدخال رمز الوصول.' });
  }

  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'الطلب فارغ أو غير صالح.' });
  }

  const sourceResult = validateSourceUrl(body.source_url);
  if (sourceResult.error) return res.status(400).json({ ok: false, error: sourceResult.error });

  const durationResult = validateDuration(body.duration);
  if (durationResult.error) return res.status(400).json({ ok: false, error: durationResult.error });

  const logoResult = validateLogoUrl(body.logo_url);
  if (logoResult.error) return res.status(400).json({ ok: false, error: logoResult.error });

  const subtitlesResult = validateSubtitles(body.generate_subtitles);

  const requestId = generateRequestId();
  const inputs = {
    request_id: requestId,
    source_url: sourceResult.value,
    duration: String(durationResult.value),
    logo_url: logoResult.value,
    generate_subtitles: subtitlesResult.value,
  };

  const result = await dispatchWorkflow({ token: githubToken, repo, inputs });

  if (!result.ok) {
    const status = result.status === 401 || result.status === 403 ? 503 : (result.status || 502);
    const friendly =
      status === 503
        ? 'تعذر بدء العامل: تحقق من صلاحيات GH_WORKER_TOKEN ومن تفعيل Actions على المستودع.'
        : 'تعذر بدء العامل المجاني الآن. أعد المحاولة بعد قليل.';
    console.error('dispatch failed:', result.status, result.detail);
    return res.status(status).json({ ok: false, error: friendly });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(202).json({
    ok: true,
    requestId,
    repo,
    statusUrl: `/api/status?requestId=${encodeURIComponent(requestId)}`,
    message: 'بدأ العامل المجاني معالجة المقطع. قد يستغرق بضع دقائق.',
  });
}
