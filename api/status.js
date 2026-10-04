// api/status.js — coordinates Render download -> private GitHub Actions transcode.
import { inflateRawSync } from 'node:zlib';
import { verifySessionToken } from './auth.js';

const GITHUB_API = 'https://api.github.com';
const WORKER_BASE = process.env.DOWNLOADER_URL || process.env.WORKER_URL || '';
const WORKER_SECRET = process.env.DOWNLOADER_SECRET || process.env.WORKER_SECRET || '';
const GH_TOKEN = process.env.GH_WORKER_TOKEN || '';
const GH_REPO = process.env.GH_WORKER_REPO || 'koreaone10-del/BiliReels-Worker';
const WORKFLOW_FILE = 'process-reel.yml';
const REQUEST_ID_PATTERN = /^[a-f0-9]{16,64}$/;
const GH_TIMEOUT_MS = 6500;
const WORKER_TIMEOUT_MS = 9000;
const CONTROL_TIMEOUT_MS = 4000;
const MAX_LOG_ARCHIVE_BYTES = 12 * 1024 * 1024;
const MAX_LOG_TEXT_BYTES = 32 * 1024 * 1024;

function noCache(res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function bearerFromHeader(req) {
  const raw = req.headers?.authorization || req.headers?.Authorization;
  if (typeof raw !== 'string') return '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
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

function githubHeaders() {
  return {
    Authorization: `Bearer ${GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'BiliReels-Vercel-Status',
  };
}

async function github(path, options = {}) {
  const response = await fetch(`${GITHUB_API}/repos/${GH_REPO}${path}`, {
    ...options,
    headers: {
      ...githubHeaders(),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    signal: options.signal || AbortSignal.timeout(GH_TIMEOUT_MS),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  return { response, data, text };
}

function githubError(status) {
  if (status === 401 || status === 403) return 'GitHub رفض صلاحية Actions. يلزم رمز GH_WORKER_TOKEN بصلاحية Actions: Read and write للمستودع الخاص.';
  if (status === 404) return 'لم يُعثر على مستودع العامل أو workflow process-reel.yml.';
  if (status === 422) return 'رفض GitHub مدخلات المعالجة؛ تحقق من تفعيل workflow ومدخلاته.';
  return 'تعذر الاتصال بـGitHub Actions. أعد المحاولة.';
}

async function findRun(requestId) {
  const path = `/actions/workflows/${encodeURIComponent(WORKFLOW_FILE)}/runs?event=workflow_dispatch&per_page=100`;
  const result = await github(path);
  if (!result.response.ok || !result.data) return { error: result.response.status };
  const expectedTitle = `BiliReels ${requestId}`;
  const run = (result.data.workflow_runs || []).find((item) =>
    item.event === 'workflow_dispatch' && item.display_title === expectedTitle
  ) || null;
  return { run };
}

function extractZipText(archive) {
  const bytes = Buffer.from(archive);
  if (bytes.length > MAX_LOG_ARCHIVE_BYTES) throw new Error('GitHub log archive too large.');
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) {
    return bytes.toString('utf8');
  }

  let eocd = -1;
  const minOffset = Math.max(0, bytes.length - 65_557);
  for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid GitHub log archive.');

  const entries = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  const texts = [];
  let totalExpanded = 0;

  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    if (uncompressedSize > MAX_LOG_TEXT_BYTES || totalExpanded + uncompressedSize > MAX_LOG_TEXT_BYTES) {
      throw new Error('Expanded GitHub logs exceed limit.');
    }
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('Invalid log entry.');
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error('Truncated log entry.');

    if (name.toLowerCase().endsWith('.txt')) {
      const compressed = bytes.subarray(dataStart, dataEnd);
      let content;
      if (method === 0) content = compressed;
      else if (method === 8) content = inflateRawSync(compressed, { maxOutputLength: MAX_LOG_TEXT_BYTES - totalExpanded });
      else throw new Error('Unsupported log compression method.');
      totalExpanded += content.length;
      texts.push(content.toString('utf8'));
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return texts.join('\n');
}

function extractPublicUrl(logs) {
  const match = String(logs || '').match(/PUBLIC_URL:\s*(https:\/\/[^\s"'<>]+\.mp4(?:\?[^\s"'<>]*)?)/i);
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    const host = url.hostname.toLowerCase();
    const allowed = host.endsWith('.blob.upstash.io') || host.endsWith('.blob.vercel-storage.com');
    if (!allowed || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function extractWorkerError(logs) {
  const match = String(logs || '').match(/ERROR\s+([A-Z_]+):\s*([^\n\r]+)/);
  return match ? { code: match[1], message: match[2].trim().slice(0, 240) } : null;
}

async function getWorkerStatus(workerBase, requestId) {
  const url = new URL(`${workerBase}/api/download-status`);
  url.searchParams.set('requestId', requestId);
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'x-worker-secret': WORKER_SECRET },
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}

async function controlWorker(workerBase, endpoint, requestId) {
  const response = await fetch(`${workerBase}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-worker-secret': WORKER_SECRET },
    body: JSON.stringify({ request_id: requestId }),
    signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}

async function fetchRunLogs(runId) {
  const jobsResult = await github(`/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=100`);
  if (!jobsResult.response.ok || !jobsResult.data) return { error: jobsResult.response.status };
  const job = (jobsResult.data.jobs || [])[0];
  if (!job) return { error: 404 };

  const response = await fetch(`${GITHUB_API}/repos/${GH_REPO}/actions/jobs/${encodeURIComponent(job.id)}/logs`, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(GH_TIMEOUT_MS),
  });
  if (!response.ok) return { error: response.status };
  const archive = await response.arrayBuffer();
  if (archive.byteLength > MAX_LOG_ARCHIVE_BYTES) return { error: 413 };
  return { logs: extractZipText(archive), job };
}

async function handleExistingRun(res, run) {
  const status = String(run.status || '').toLowerCase();
  const runUrl = typeof run.html_url === 'string' ? run.html_url : undefined;
  if (['queued', 'requested', 'waiting', 'pending'].includes(status)) {
    return res.status(200).json({ ok: true, state: 'queued', message: 'Reel في قائمة انتظار GitHub Actions المجانية…', runUrl });
  }
  if (status === 'in_progress') {
    return res.status(200).json({ ok: true, state: 'in_progress', message: 'يجري قص الفيديو وإضافة الشعار/الترجمة على GitHub Actions…', runUrl });
  }
  if (status !== 'completed') {
    return res.status(200).json({ ok: true, state: 'in_progress', message: 'العامل يجهز المهمة…', runUrl });
  }
  if (String(run.conclusion || '').toLowerCase() !== 'success') {
    let detail = null;
    try {
      const logs = await fetchRunLogs(run.id);
      if (logs.logs) detail = extractWorkerError(logs.logs);
    } catch {
      // Keep the safe generic failure if logs cannot be fetched.
    }
    return res.status(200).json({
      ok: true,
      state: 'failed',
      message: detail?.message || 'فشل GitHub Actions في إنشاء Reel. افتح سجل التشغيل لمعرفة الخطوة الفاشلة.',
      errorCode: detail?.code || null,
      runUrl,
    });
  }

  try {
    const result = await fetchRunLogs(run.id);
    const videoUrl = result.logs ? extractPublicUrl(result.logs) : null;
    if (!videoUrl) {
      return res.status(200).json({ ok: true, state: 'completed_no_url', message: 'اكتملت المعالجة لكن تعذر العثور على رابط MP4 في السجل.', runUrl });
    }
    return res.status(200).json({ ok: true, state: 'completed', message: 'اكتمل Reel وأصبح جاهزًا.', videoUrl, runUrl });
  } catch {
    return res.status(200).json({ ok: true, state: 'in_progress', message: 'اكتملت المعالجة؛ جارٍ تجهيز رابط MP4…', runUrl });
  }
}

export default async function handler(req, res) {
  noCache(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'طريقة غير مدعومة.' });
  }
  if (!verifySessionToken(bearerFromHeader(req))) return res.status(401).json({ ok: false, error: 'جلسة منتهية.' });

  const requestId = typeof req.query?.requestId === 'string' ? req.query.requestId : '';
  if (!REQUEST_ID_PATTERN.test(requestId)) return res.status(400).json({ ok: false, error: 'معرّف غير صالح.' });
  const workerBase = normalizeWorkerBase(WORKER_BASE);
  if (!workerBase) return res.status(503).json({ ok: false, error: 'عنوان عامل Render غير مضبوط. اضبط WORKER_URL في Vercel.' });
  if (!WORKER_SECRET) return res.status(503).json({ ok: false, error: 'سر العامل غير مضبوط. أضف DOWNLOADER_SECRET في Vercel.' });
  if (!GH_TOKEN) return res.status(503).json({ ok: false, error: 'GH_WORKER_TOKEN غير مضبوط في Vercel.' });
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(GH_REPO)) return res.status(500).json({ ok: false, error: 'GH_WORKER_REPO غير صالح.' });

  try {
    const [existingResult, workerResult] = await Promise.allSettled([
      findRun(requestId),
      getWorkerStatus(workerBase, requestId),
    ]);
    if (existingResult.status === 'rejected') throw existingResult.reason;
    const existing = existingResult.value;
    if (existing.error) {
      const code = [401, 403].includes(existing.error) ? 403 : existing.error === 404 ? 503 : 502;
      return res.status(code).json({ ok: false, error: githubError(existing.error) });
    }
    if (existing.run) return handleExistingRun(res, existing.run);

    if (workerResult.status === 'rejected') throw workerResult.reason;
    const worker = workerResult.value;
    if (!worker.response.ok || !worker.data) {
      const code = worker.response.status === 401 ? 503 : 502;
      return res.status(code).json({ ok: false, error: 'تعذر قراءة حالة التنزيل من Render. تحقق من DOWNLOADER_SECRET ومطابقته لـWORKER_SECRET.' });
    }
    const job = worker.data;
    if (job.state === 'unknown') {
      return res.status(503).json({ ok: false, error: 'فقد Render حالة المهمة بعد إعادة التشغيل. أعد المحاولة؛ قد يلزم تنظيف المصدر المؤقت من Upstash.' });
    }
    if (job.state === 'failed') {
      return res.status(200).json({ ok: true, state: 'failed', message: job.message || 'فشل تنزيل المصدر من BiliBili.' });
    }
    if (job.state !== 'completed' || !job.videoUrl) {
      const active = ['downloading', 'uploading'].includes(job.state);
      return res.status(200).json({
        ok: true,
        state: active ? 'in_progress' : 'starting',
        message: job.message || (active ? 'يجري تنزيل المصدر إلى التخزين المؤقت…' : 'Render يجهز عامل التنزيل…'),
      });
    }

    let rawUrl;
    try {
      rawUrl = new URL(job.videoUrl);
      if (rawUrl.protocol !== 'https:' || rawUrl.username || rawUrl.password) throw new Error('bad URL');
    } catch {
      return res.status(502).json({ ok: false, error: 'أعاد Render رابط مصدر غير صالح.' });
    }

    const claim = await controlWorker(workerBase, '/api/claim-processing', requestId);
    if (!claim.response.ok) return res.status(502).json({ ok: false, error: 'تعذر حجز مرحلة المعالجة على العامل.' });
    if (!claim.data?.claimed) {
      return res.status(200).json({ ok: true, state: 'starting', message: 'بدأت المعالجة؛ جارٍ ظهور مهمة GitHub Actions…' });
    }

    const inputs = {
      request_id: requestId,
      source_url: rawUrl.href,
      duration: String(job.duration || 30),
      logo_url: String(job.logo_url || ''),
      generate_subtitles: job.generate_subtitles ? '1' : '0',
    };
    const dispatch = await github(`/actions/workflows/${encodeURIComponent(WORKFLOW_FILE)}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: 'main', inputs }),
    });
    if (!dispatch.response.ok) {
      await controlWorker(workerBase, '/api/release-processing', requestId).catch(() => {});
      const code = [401, 403].includes(dispatch.response.status) ? 403 : 502;
      return res.status(code).json({ ok: false, error: githubError(dispatch.response.status) });
    }
    return res.status(200).json({
      ok: true,
      state: 'in_progress',
      message: 'اكتمل تنزيل المصدر؛ بدأ الآن قص Reel ومعالجته على GitHub Actions.',
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({
      ok: false,
      error: timedOut ? 'انتهت مهلة الاتصال بأحد العاملين؛ أعد المحاولة بعد لحظات.' : 'تعذر متابعة معالجة Reel.',
    });
  }
}
