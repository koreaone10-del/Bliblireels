// api/status.js
// Polls the GitHub Actions run that matches a given requestId and returns
// the public video URL once the worker finishes.

import { verifySessionToken } from './auth.js';

const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 10_000;
const WORKFLOW_FILE = 'process-reel.yml';
const MAX_RUNS_TO_SCAN = 30;
const REQUEST_ID_PATTERN = /^[a-f0-9]{16,64}$/;

function bearerFromHeader(req) {
  const raw = req.headers['authorization'] || req.headers['Authorization'];
  if (typeof raw !== 'string') return '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function githubHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'BiliReels-Vercel-Status',
  };
}

async function ghFetch(url, token) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: githubHeaders(token), signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function findRun(token, repo, requestId) {
  const url = `${GITHUB_API}/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=${MAX_RUNS_TO_SCAN}`;
  const response = await ghFetch(url, token);
  if (!response.ok) {
    return { error: response.status };
  }
  const data = await response.json();
  const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
  // run-name is "BiliReels <requestId>"; match exactly.
  const expectedTitle = `BiliReels ${requestId}`;
  return { run: runs.find((r) => r.display_title === expectedTitle) || null };
}

async function fetchJobLogs(token, repo, runId) {
  const jobsUrl = `${GITHUB_API}/repos/${repo}/actions/runs/${runId}/jobs`;
  const jobsResponse = await ghFetch(jobsUrl, token);
  if (!jobsResponse.ok) return { error: jobsResponse.status };
  const jobsData = await jobsResponse.json();
  const job = (jobsData.jobs || [])[0];
  if (!job) return { error: 404 };

  const logsUrl = `${GITHUB_API}/repos/${repo}/actions/jobs/${job.id}/logs`;
  const logsResponse = await ghFetch(logsUrl, token);
  if (!logsResponse.ok) return { error: logsResponse.status };
  // GitHub returns a 302 to a signed URL; fetch follows redirects automatically.
  const text = await logsResponse.text();
  return { text, job };
}

function extractPublicUrl(logs) {
  if (typeof logs !== 'string' || !logs) return null;
  // The worker prints: PUBLIC_URL: https://.../reel_<id>_<ts>.mp4
  const match = logs.match(/PUBLIC_URL:\s*(https?:\/\/[^\s"'<>]+\.mp4)/);
  return match ? match[1] : null;
}

function extractErrorMessage(logs) {
  if (typeof logs !== 'string' || !logs) return null;
  const match = logs.match(/ERROR\s+([A-Z_]+):\s*([^\n\r]+)/);
  if (!match) return null;
  return { code: match[1], message: match[2].trim().slice(0, 300) };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
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

  const session = bearerFromHeader(req);
  if (!verifySessionToken(session)) {
    return res.status(401).json({ ok: false, error: 'الجلسة منتهية أو غير صالحة.' });
  }

  const requestId = typeof req.query?.requestId === 'string' ? req.query.requestId : '';
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    return res.status(400).json({ ok: false, error: 'معرّف الطلب غير صالح.' });
  }

  res.setHeader('Cache-Control', 'no-store');

  let found;
  try {
    found = await findRun(token, repo, requestId);
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ ok: false, error: 'انتهت مهلة الاتصال بـGitHub.' });
    }
    return res.status(502).json({ ok: false, error: 'تعذر الوصول إلى GitHub.' });
  }

  if (found.error) {
    const status = found.error === 404 ? 503 : 502;
    return res.status(status).json({
      ok: false,
      error: status === 503
        ? 'تعذر العثور على workflow العامل. تحقق من اسم الملف على GitHub.'
        : 'تعذر قراءة حالة العامل من GitHub.',
    });
  }

  if (!found.run) {
    // GitHub can take a few seconds to register a new run.
    return res.status(200).json({
      ok: true,
      state: 'starting',
      message: 'جارٍ تجهيز العامل المجاني…',
    });
  }

  const run = found.run;
  const status = String(run.status || '').toLowerCase();
  const conclusion = run.conclusion ? String(run.conclusion).toLowerCase() : null;

  if (status === 'queued' || status === 'requested' || status === 'waiting' || status === 'pending') {
    return res.status(200).json({
      ok: true,
      state: 'queued',
      message: 'العامل في قائمة الانتظار…',
      runUrl: run.html_url,
    });
  }

  if (status === 'in_progress') {
    return res.status(200).json({
      ok: true,
      state: 'in_progress',
      message: 'جارٍ تحميل المقطع ومعالجته…',
      runUrl: run.html_url,
    });
  }

  if (status !== 'completed') {
    return res.status(200).json({
      ok: true,
      state: 'unknown',
      message: 'حالة غير معروفة من GitHub.',
      runUrl: run.html_url,
    });
  }

  // Run completed. Handle success and failure.
  if (conclusion !== 'success') {
    let errorDetail = null;
    try {
      const logsResult = await fetchJobLogs(token, repo, run.id);
      if (logsResult.text) {
        errorDetail = extractErrorMessage(logsResult.text);
      }
    } catch {
      // ignore log fetch failures
    }
    return res.status(200).json({
      ok: true,
      state: 'failed',
      message: errorDetail?.message || 'فشل العامل المجاني في معالجة المقطع.',
      errorCode: errorDetail?.code || null,
      runUrl: run.html_url,
    });
  }

  // Success: extract the public URL from logs.
  let publicUrl = null;
  try {
    const logsResult = await fetchJobLogs(token, repo, run.id);
    if (logsResult.text) {
      publicUrl = extractPublicUrl(logsResult.text);
    }
  } catch {
    // ignore log fetch failures; fall back to null
  }

  if (!publicUrl) {
    return res.status(200).json({
      ok: true,
      state: 'completed_no_url',
      message: 'اكتمل العامل لكن تعذر استخراج رابط الفيديو. راجع سجل الـ workflow على GitHub.',
      runUrl: run.html_url,
    });
  }

  return res.status(200).json({
    ok: true,
    state: 'completed',
    message: 'الفيديو جاهز.',
    videoUrl: publicUrl,
    runUrl: run.html_url,
  });
}
