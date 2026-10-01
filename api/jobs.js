import { randomUUID } from 'node:crypto';
import { configuredAccessCode, isSameOrigin, isSessionValid, readJsonBody } from '../lib/access.js';

const DEFAULT_REPO = 'koreaone10-del/BiliReels-Worker';
const WORKFLOW = 'process-reel.yml';
const API = 'https://api.github.com';
const ACCEPTED_DOMAINS = ['bilibili.tv', 'bilibili.com', 'b23.tv', 'bili.im', 'bili2233.cn'];
const MONTHLY_JOB_CAP = 100;
const MAX_ACTIVE_ARTIFACT_BYTES = 350 * 1024 * 1024;
const MAX_ACTIVE_ARTIFACT_COUNT = 3;

function noCache(res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function parseRepo(value) {
  const repo = value || DEFAULT_REPO;
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return repo;
}

function parseSource(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const allowed = ACCEPTED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
    if (!allowed || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return null;
    url.protocol = 'https:';
    url.port = '';
    return url.href;
  } catch {
    return null;
  }
}

function validIds(runId, requestId) {
  return /^\d{1,20}$/.test(String(runId || '')) && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(requestId || ''));
}

function errorForGithub(status) {
  if (status === 401 || status === 403) return 'GitHub رفض العامل: تحقق من صلاحية Actions للحساب أو نفاد الحصة المجانية.';
  if (status === 404) return 'لم يُعثر على مستودع العامل أو ملف workflow؛ تحقق من GH_WORKER_REPO.';
  if (status === 422) return 'رفض GitHub مدخل المهمة؛ أعد الفحص وتأكد من تفعيل workflow في المستودع الخاص.';
  return 'تعذر الاتصال بعامل GitHub Actions. أعد المحاولة لاحقًا.';
}

async function github(token, repo, path, options = {}) {
  const response = await fetch(`${API}/repos/${repo}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(15_000),
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  return { response, data };
}

function stageMessage(run, jobs) {
  if (run.status === 'queued' || run.status === 'waiting' || run.status === 'requested') {
    return { stage: 'queued', message: 'المهمة في قائمة الانتظار المجانية لدى GitHub Actions.' };
  }
  const steps = (jobs || []).flatMap((job) => job.steps || []);
  const active = steps.find((step) => step.status === 'in_progress') || steps.find((step) => step.status === 'queued');
  const name = active?.name || '';
  if (/checkout|python|ffmpeg|install/i.test(name)) return { stage: 'preparing', message: 'تجهيز بيئة FFmpeg المجانية.' };
  if (/download|resolve|source/i.test(name)) return { stage: 'downloading', message: 'العامل يحاول قراءة أول 30 ثانية من المصدر العام.' };
  if (/transcode|convert|validate/i.test(name)) return { stage: 'transcoding', message: 'تحويل المقطع والتحقق من MP4 عمودي 720×1280.' };
  if (/upload|artifact/i.test(name)) return { stage: 'packaging', message: 'حفظ الملف مؤقتًا للتنزيل.' };
  return { stage: 'processing', message: 'عامل GitHub Actions ينفذ المهمة.' };
}

async function verifiedRun(token, repo, runId, requestId) {
  const { response, data } = await github(token, repo, `/actions/runs/${encodeURIComponent(runId)}`);
  if (!response.ok || !data) return { error: response.status === 404 ? 404 : response.status };
  if (data.event !== 'workflow_dispatch' || data.path?.split('/').pop() !== WORKFLOW || data.display_title !== `BiliReels ${requestId}`) {
    return { error: 404 };
  }
  return { run: data };
}

async function createJob(req, res, token, repo) {
  if (!isSameOrigin(req)) return res.status(403).json({ ok: false, error: 'رُفض طلب تشغيل من مصدر غير موثوق.' });
  const body = readJsonBody(req);
  const sourceUrl = parseSource(body.url);
  if (!sourceUrl) return res.status(400).json({ ok: false, error: 'استخدم رابط HTTPS عامًا مدعومًا من BiliBili.' });

  // Keep the free worker serial and bounded; never switch to a paid runner.
  const workflowRuns = await github(token, repo, `/actions/workflows/${WORKFLOW}/runs?per_page=100`);
  if (!workflowRuns.response.ok || !workflowRuns.data) {
    return res.status(workflowRuns.response.status === 404 ? 503 : 502).json({ ok: false, error: errorForGithub(workflowRuns.response.status) });
  }
  const runs = workflowRuns.data.workflow_runs || [];
  if (runs.some((run) => ['queued', 'in_progress', 'waiting', 'requested'].includes(run.status))) {
    return res.status(409).json({ ok: false, error: 'توجد مهمة واحدة قيد الانتظار أو المعالجة؛ انتظر انتهائها قبل بدء أخرى.' });
  }
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const thisMonth = runs.filter((run) => new Date(run.created_at) >= monthStart).length;
  if (thisMonth >= MONTHLY_JOB_CAP) {
    return res.status(429).json({ ok: false, error: 'وصل العامل إلى حد الحماية الشهري المجاني (100 مهمة). يتجدد الحد الشهر القادم.' });
  }

  const artifactsResult = await github(token, repo, '/actions/artifacts?per_page=100');
  if (!artifactsResult.response.ok || !artifactsResult.data) {
    return res.status(502).json({ ok: false, error: errorForGithub(artifactsResult.response.status) });
  }
  const liveArtifacts = (artifactsResult.data.artifacts || []).filter((item) => !item.expired);
  const activeBytes = liveArtifacts.reduce((sum, item) => sum + (Number(item.size_in_bytes) || 0), 0);
  if (liveArtifacts.length >= MAX_ACTIVE_ARTIFACT_COUNT || activeBytes >= MAX_ACTIVE_ARTIFACT_BYTES) {
    return res.status(429).json({ ok: false, error: 'امتلأت مساحة نتائج العامل المؤقتة؛ نزّل النتائج الحالية أو انتظر انتهاء صلاحيتها بعد يوم.' });
  }

  const requestId = randomUUID();
  const dispatch = await github(token, repo, `/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({
      ref: 'main',
      inputs: { request_id: requestId, source_url: sourceUrl }
    })
  });
  if (!dispatch.response.ok || !dispatch.data?.workflow_run_id) {
    return res.status(dispatch.response.status === 403 ? 429 : 502).json({ ok: false, error: errorForGithub(dispatch.response.status) });
  }
  return res.status(202).json({ ok: true, requestId, runId: String(dispatch.data.workflow_run_id), status: 'queued' });
}

async function getJob(req, res, token, repo) {
  const runId = req.query?.runId;
  const requestId = req.query?.requestId;
  if (!validIds(runId, requestId)) return res.status(400).json({ ok: false, error: 'معرّف المهمة غير صالح.' });

  const verified = await verifiedRun(token, repo, runId, requestId);
  if (verified.error) {
    const status = verified.error === 404 ? 404 : 502;
    return res.status(status).json({ ok: false, error: status === 404 ? 'لم يُعثر على المهمة أو انتهت صلاحيتها.' : errorForGithub(verified.error) });
  }
  const run = verified.run;

  if (req.query?.download === '1') {
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      return res.status(409).json({ ok: false, error: 'لم يكتمل Reel بنجاح بعد.' });
    }
    const artifacts = await github(token, repo, `/actions/runs/${encodeURIComponent(runId)}/artifacts?per_page=100`);
    if (!artifacts.response.ok || !artifacts.data) return res.status(502).json({ ok: false, error: errorForGithub(artifacts.response.status) });
    const name = `reel-${requestId}`;
    const artifact = (artifacts.data.artifacts || []).find((item) => item.name === name && !item.expired && String(item.workflow_run?.id) === String(runId));
    if (!artifact) return res.status(410).json({ ok: false, error: 'انتهت صلاحية ملف Reel المؤقت؛ أعد إنشاء المهمة.' });

    const archive = await fetch(`${API}/repos/${repo}/actions/artifacts/${artifact.id}/zip`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10' },
      redirect: 'manual'
    });
    const location = archive.headers.get('location');
    if (archive.status !== 302 || !location) return res.status(502).json({ ok: false, error: 'تعذر إنشاء رابط تنزيل مؤقت من GitHub.' });
    res.statusCode = 302;
    res.setHeader('Location', location);
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.end();
  }

  if (req.query?.preview === '1') {
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      return res.status(409).json({ ok: false, error: 'لم يكتمل Reel بنجاح بعد.' });
    }
    const artifacts = await github(token, repo, `/actions/runs/${encodeURIComponent(runId)}/artifacts?per_page=100`);
    if (!artifacts.response.ok || !artifacts.data) return res.status(502).json({ ok: false, error: errorForGithub(artifacts.response.status) });
    const artifact = (artifacts.data.artifacts || []).find((item) => item.name === `reel-${requestId}` && !item.expired && String(item.workflow_run?.id) === String(runId));
    if (!artifact) return res.status(410).json({ ok: false, error: 'انتهت صلاحية ملف Reel المؤقت؛ أعد إنشاء المهمة.' });
    const archive = await fetch(`${API}/repos/${repo}/actions/artifacts/${artifact.id}/zip`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10' },
      redirect: 'manual'
    });
    const location = archive.headers.get('location');
    if (archive.status !== 302 || !location) return res.status(502).json({ ok: false, error: 'تعذر إنشاء رابط المعاينة المؤقت.' });
    const zip = await fetch(location, { signal: AbortSignal.timeout(180_000) });
    if (!zip.ok || !zip.body) return res.status(502).json({ ok: false, error: 'تعذر تنزيل ملف المعاينة من التخزين المؤقت.' });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const length = zip.headers.get('content-length');
    if (length && /^\d+$/.test(length)) res.setHeader('Content-Length', length);
    const { Readable } = await import('node:stream');
    const { pipeline } = await import('node:stream/promises');
    await pipeline(Readable.fromWeb(zip.body), res);
    return undefined;
  }

  if (run.status === 'completed') {
    if (run.conclusion !== 'success') {
      return res.status(200).json({ ok: true, status: 'failed', stage: 'failed', message: 'تعذّر إنشاء Reel. قد يكون المصدر غير متاح أو مقيّدًا؛ لم تُستخدم بيانات دخول أو تجاوز قيود.' });
    }
    const artifacts = await github(token, repo, `/actions/runs/${encodeURIComponent(runId)}/artifacts?per_page=100`);
    if (!artifacts.response.ok || !artifacts.data) return res.status(502).json({ ok: false, error: errorForGithub(artifacts.response.status) });
    const artifact = (artifacts.data.artifacts || []).find((item) => item.name === `reel-${requestId}` && !item.expired && String(item.workflow_run?.id) === String(runId));
    if (!artifact) return res.status(200).json({ ok: true, status: 'failed', stage: 'expired', message: 'انتهت صلاحية ملف المعالجة أو لم يُرفع؛ أعد إنشاء المهمة.' });
    return res.status(200).json({
      ok: true, status: 'completed', stage: 'completed', message: 'اكتمل Reel بنجاح. ملف MP4 داخل أرشيف ZIP خاص مؤقت.',
      artifactReady: true, expiresAt: artifact.expires_at, sizeBytes: artifact.size_in_bytes,
      downloadUrl: `/api/jobs?runId=${encodeURIComponent(runId)}&requestId=${encodeURIComponent(requestId)}&download=1`
    });
  }

  const jobList = await github(token, repo, `/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=100`);
  const state = stageMessage(run, jobList.response.ok ? jobList.data?.jobs || [] : []);
  return res.status(200).json({ ok: true, status: run.status === 'queued' ? 'queued' : 'in_progress', ...state });
}

export default async function handler(req, res) {
  noCache(res);
  if (!configuredAccessCode()) return res.status(503).json({ ok: false, error: 'أضف BILIREELS_ACCESS_CODE (24 محرفًا أو أكثر) إلى Vercel أولًا.' });
  if (!isSessionValid(req)) return res.status(401).json({ ok: false, error: 'أدخل رمز الوصول الخاص قبل بدء المعالجة.' });

  const token = process.env.GH_WORKER_TOKEN || '';
  if (!token) return res.status(503).json({ ok: false, error: 'أضف GH_WORKER_TOKEN إلى Vercel لتوصيل العامل الخاص.' });
  const repo = parseRepo(process.env.GH_WORKER_REPO);
  if (!repo) return res.status(500).json({ ok: false, error: 'قيمة GH_WORKER_REPO غير صحيحة.' });

  try {
    if (req.method === 'POST') return await createJob(req, res, token, repo);
    if (req.method === 'GET') return await getJob(req, res, token, repo);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'طريقة الطلب غير مدعومة.' });
  } catch (error) {
    console.error('BiliReels jobs API failure:', error?.name || 'Error');
    if (res.headersSent) {
      res.destroy?.(error);
      return undefined;
    }
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({ ok: false, error: timedOut ? 'انتهت مهلة الاتصال بعامل GitHub.' : 'تعذر الاتصال بعامل GitHub Actions.' });
  }
}
