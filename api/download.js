import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 240_000;
const ALLOWED_DOMAINS = [
  'bilibili.com',
  'bilibili.tv',
  'biliapi.net',
  'bilivideo.com',
  'bilivideo.cn',
  'bilivideo.net',
  'bstarstatic.com',
  'hdslb.com'
];

function isAllowedHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return ALLOWED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function parseVideoUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || !isAllowedHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function safeFileName(value) {
  const cleaned = String(value || 'BiliReel')
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'BiliReel';
  const ascii = cleaned.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'BiliReel';
  const encoded = encodeURIComponent(`${cleaned}.mp4`).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}.mp4"; filename*=UTF-8''${encoded}`;
}

async function fetchWithAllowedRedirects(startUrl, signal) {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Referer: 'https://www.bilibili.com/',
        'User-Agent': 'Mozilla/5.0 (compatible; BiliReels/1.0)',
        Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.1'
      },
      signal
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get('location');
    try { await response.body?.cancel(); } catch {}
    if (!location) throw new Error('أعاد مصدر الفيديو تحويلًا بلا وجهة.');
    if (hop === MAX_REDIRECTS) throw new Error('تجاوز مصدر الفيديو عدد التحويلات المسموح به.');

    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.protocol !== 'https:' || nextUrl.username || nextUrl.password || !isAllowedHost(nextUrl.hostname)) {
      throw new Error('رُفض تحويل الفيديو إلى نطاق غير مسموح.');
    }
    currentUrl = nextUrl;
  }
  throw new Error('تعذر الوصول إلى مصدر الفيديو.');
}

function sendError(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'طريقة الطلب غير مدعومة.');
  }

  const sourceUrl = parseVideoUrl(req.query?.url);
  if (!sourceUrl) {
    return sendError(res, 400, 'رابط الفيديو المباشر غير صالح أو ليس من نطاقات BiliBili المسموحة.');
  }

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetchWithAllowedRedirects(sourceUrl, timeoutSignal);
    if (!upstream.ok) {
      try { await upstream.body?.cancel(); } catch {}
      return sendError(res, 502, `تعذر جلب ملف الفيديو من المصدر (HTTP ${upstream.status}).`);
    }

    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!(contentType.startsWith('video/') || contentType === 'application/octet-stream' || contentType === 'binary/octet-stream')) {
      try { await upstream.body?.cancel(); } catch {}
      return sendError(res, 415, 'المصدر لم يُرجع ملف فيديو مباشرًا؛ رابط صفحة المشاهدة لا يصلح للتنزيل.');
    }
    if (!upstream.body) return sendError(res, 502, 'مصدر الفيديو أعاد استجابة بلا محتوى.');

    const rawTitle = req.query?.title;
    const title = typeof rawTitle === 'string' ? rawTitle : 'BiliReel';
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', safeFileName(title));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const contentLength = upstream.headers.get('content-length');
    if (contentLength && /^\d+$/.test(contentLength)) res.setHeader('Content-Length', contentLength);

    await pipeline(Readable.fromWeb(upstream.body), res, { signal: timeoutSignal });
    return undefined;
  } catch (error) {
    console.error('BiliReels download proxy error:', error);
    if (res.headersSent) {
      res.destroy?.(error);
      return undefined;
    }
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return sendError(res, timedOut ? 504 : 502, timedOut ? 'انتهت مهلة تنزيل الفيديو.' : error?.message || 'تعذر تنزيل ملف الفيديو.');
  }
}
