import { extractReelMp4 } from './zip-preview.js';

const analyzeForm = document.getElementById('analyzeForm');
const analyzeBtn = document.getElementById('analyzeBtn');
const urlInput = document.getElementById('videoUrl');
const videoCard = document.getElementById('videoCard');
const workspace = document.getElementById('workspace');
const progressSection = document.getElementById('progressSection');
const resultsSection = document.getElementById('resultsSection');
const startDownloadBtn = document.getElementById('startDownloadBtn');
const sourceStatus = document.getElementById('sourceStatus');
const analysisMessage = document.getElementById('analysisMessage');
const workerAuthDialog = document.getElementById('workerAuthDialog');
const workerAuthForm = document.getElementById('workerAuthForm');
const workerAccessCode = document.getElementById('workerAccessCode');
const workerAuthError = document.getElementById('workerAuthError');
const workerAuthSubmit = document.getElementById('workerAuthSubmit');
const workerAuthCancel = document.getElementById('workerAuthCancel');
const progressStatusText = document.getElementById('progressStatusText');
const progressBarFill = document.getElementById('progressBarFill');
const progressPercentage = document.getElementById('progressPercentage');
const workspaceState = document.getElementById('workspaceState');
const resultStatus = document.getElementById('resultStatus');
const resultNote = document.getElementById('resultNote');
const downloadAll = document.getElementById('downloadAll');
const reelPreviewWrap = document.getElementById('reelPreviewWrap');
const reelVideo = document.getElementById('reelVideo');
const reelPreviewStatus = document.getElementById('reelPreviewStatus');

const ACTIVE_JOB_KEY = 'bilireels-active-job-v1';
const COMPLETED_JOB_KEY = 'bilireels-completed-job-v1';
const POLL_INTERVAL_MS = 5000;
let currentVideoData = null;
let currentSourceUrl = null;
let analyzedInputUrl = null;
let isAnalyzing = false;
let isProcessing = false;
let pendingStartAfterAuth = false;
let activeJob = null;
let completedJob = null;
let polling = false;
let reelObjectUrl = null;

function setVisible(element, visible) {
  if (!element) return;
  element.classList.toggle('hidden', !visible);
  element.hidden = !visible;
}

function setStatus(state, message) {
  if (sourceStatus) {
    sourceStatus.classList.remove('ready', 'busy', 'error');
    sourceStatus.classList.add(state);
    sourceStatus.textContent = state === 'busy'
      ? '● جاري الفحص'
      : state === 'error'
        ? '● تعذر الفحص'
        : '● تم العثور على الفيديو';
  }
  if (analysisMessage) {
    analysisMessage.textContent = message;
    analysisMessage.dataset.state = state;
    setVisible(analysisMessage, Boolean(message));
  }
}

function isSupportedBiliUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    const domains = ['bilibili.com', 'bilibili.tv', 'b23.tv', 'bili.im', 'bili2233.cn'];
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function formatDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return 'غير متاح';
  const seconds = Math.floor(duration);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatCount(value) {
  if (value === null || value === undefined || value === '') return 'غير متاح';
  const count = Number(value);
  return Number.isFinite(count) ? new Intl.NumberFormat('ar').format(count) : 'غير متاح';
}

function renderVideo(video) {
  const title = String(video.title || 'فيديو BiliBili').trim();
  const author = typeof video.author === 'object' ? video.author?.name : video.author;
  const titleElement = document.getElementById('videoTitle');
  const authorElement = document.getElementById('videoAuthor');
  const durationElement = document.getElementById('videoDuration');
  const viewsElement = document.getElementById('videoViews');
  const thumbnail = document.getElementById('videoThumbnail');
  const thumbnailFallback = document.getElementById('thumbnailFallback');

  if (titleElement) titleElement.textContent = title;
  if (authorElement) authorElement.textContent = author ? `👤 ${author}` : '👤 غير متاح';
  if (durationElement) durationElement.textContent = `⏱ ${formatDuration(video.duration)}`;
  if (viewsElement) viewsElement.textContent = `👁 ${formatCount(video.views)}`;

  if (thumbnail) {
    thumbnail.onerror = () => {
      thumbnail.hidden = true;
      if (thumbnailFallback) thumbnailFallback.hidden = false;
    };
    thumbnail.onload = () => {
      thumbnail.hidden = false;
      if (thumbnailFallback) thumbnailFallback.hidden = true;
    };
    try {
      const imageUrl = new URL(video.thumbnail);
      if (!['https:', 'http:'].includes(imageUrl.protocol)) throw new Error('Unsupported image URL');
      thumbnail.alt = `صورة مصغرة: ${title}`;
      thumbnail.src = imageUrl.href;
    } catch {
      thumbnail.removeAttribute('src');
      thumbnail.hidden = true;
      if (thumbnailFallback) thumbnailFallback.hidden = false;
    }
  }

  currentVideoData = video;
  setVisible(videoCard, true);
  setVisible(workspace, true);
  setVisible(progressSection, false);
  setVisible(resultsSection, false);
  if (startDownloadBtn) {
    startDownloadBtn.disabled = false;
    startDownloadBtn.textContent = 'إنشاء Reel واحد · 30 ثانية';
  }
}

async function readApiResponse(response) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`ردّ الخادم ليس JSON صالحًا (HTTP ${response.status}).`); }
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.error || `فشل الطلب (HTTP ${response.status}).`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function authenticateStatus() {
  const response = await fetch('/api/auth', { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  if (response.status === 401) return false;
  const data = await readApiResponse(response);
  return Boolean(data.authenticated);
}

function showAuthDialog() {
  if (!workerAuthDialog) {
    showProcessError('لا يتوفر نموذج رمز الوصول في هذه النسخة.');
    return;
  }
  if (workerAuthError) {
    workerAuthError.textContent = '';
    workerAuthError.hidden = true;
  }
  if (typeof workerAuthDialog.showModal === 'function') workerAuthDialog.showModal();
  else workerAuthDialog.setAttribute('open', '');
  window.setTimeout(() => workerAccessCode?.focus(), 50);
}

function setProgress(message, stage = 'processing') {
  setVisible(progressSection, true);
  setVisible(resultsSection, false);
  if (progressStatusText) {
    progressStatusText.textContent = stage === 'failed' ? 'تعذّر الإنشاء' : stage === 'completed' ? 'اكتملت المهمة' : message;
  }
  if (progressPercentage) {
    progressPercentage.textContent = stage === 'failed'
      ? 'المعاينة بقيت كما هي؛ يمكنك تعديل الرابط أو المحاولة لاحقًا.'
      : stage === 'completed'
        ? 'اكتمل التحقق من الناتج: MP4 · 30 ثانية كحد أقصى · 720×1280.'
        : `المرحلة الفعلية: ${message}`;
  }
  if (progressBarFill) {
    progressBarFill.classList.toggle('progress-indeterminate', !['failed', 'completed'].includes(stage));
    progressBarFill.style.width = stage === 'completed' ? '100%' : stage === 'failed' ? '0%' : '35%';
    progressBarFill.style.background = stage === 'failed' ? '#ff5f78' : '#8b5cf6';
  }
  if (workspaceState) {
    workspaceState.textContent = stage === 'failed' ? 'FAILED' : stage === 'completed' ? 'DONE' : 'PROCESSING';
  }
}

function showProcessError(message) {
  setProgress(message, 'failed');
  isProcessing = false;
  if (startDownloadBtn) {
    startDownloadBtn.disabled = false;
    startDownloadBtn.textContent = 'إعادة المحاولة · Reel واحد';
  }
}

function renderCompleted(data, job = activeJob) {
  const link = data.downloadUrl || (job ? `/api/jobs?runId=${encodeURIComponent(job.runId)}&requestId=${encodeURIComponent(job.requestId)}&download=1` : '');
  completedJob = { ...job, downloadUrl: link, expiresAt: data.expiresAt || null };
  try { sessionStorage.setItem(COMPLETED_JOB_KEY, JSON.stringify(completedJob)); } catch {}
  setProgress(data.message || 'اكتملت المهمة.', 'completed');
  setVisible(resultsSection, true);
  if (resultStatus) resultStatus.textContent = 'REEL READY';
  if (resultNote) {
    const expiry = data.expiresAt ? ` رابط الملف مؤقت حتى ${new Date(data.expiresAt).toLocaleString('ar')}.` : '';
    resultNote.textContent = `سيُنزل أرشيف ZIP خاص يحتوي ملف bili-reel-30s.mp4. فك ضغطه لتشغيل الفيديو.${expiry}`;
  }
  if (downloadAll) {
    downloadAll.disabled = false;
    downloadAll.textContent = 'تنزيل Reel · ZIP يحتوي MP4';
    downloadAll.dataset.downloadUrl = link;
  }
  if (job?.runId && job?.requestId) loadReelPreview(job);
  isProcessing = false;
  activeJob = null;
  try { sessionStorage.removeItem(ACTIVE_JOB_KEY); } catch {}
  if (startDownloadBtn) {
    startDownloadBtn.disabled = false;
    startDownloadBtn.textContent = 'إنشاء Reel آخر · 30 ثانية';
  }
}

async function loadReelPreview(job) {
  if (!reelPreviewWrap || !reelVideo || !reelPreviewStatus) return;
  setVisible(reelPreviewWrap, true);
  reelPreviewStatus.textContent = 'جاري جلب ZIP الخاص واستخراج MP4 للمعاينة…';
  try {
    const query = new URLSearchParams({ runId: job.runId, requestId: job.requestId, preview: '1' });
    const response = await fetch(`/api/jobs?${query}`, { headers: { Accept: 'application/zip' }, credentials: 'same-origin' });
    if (!response.ok) {
      let message = 'تعذر تجهيز المعاينة؛ ما زال بإمكانك تنزيل ZIP.';
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    const archive = await response.arrayBuffer();
    const mp4 = await extractReelMp4(archive);
    if (reelObjectUrl) URL.revokeObjectURL(reelObjectUrl);
    reelObjectUrl = URL.createObjectURL(mp4);
    reelVideo.src = reelObjectUrl;
    reelVideo.load();
    reelPreviewStatus.textContent = 'المعاينة جاهزة — ملف MP4 عمودي.';
  } catch (error) {
    reelPreviewStatus.textContent = error.message || 'تعذر تجهيز المعاينة؛ استخدم تنزيل ZIP.';
  }
}

function renderActiveJob(job, message) {
  activeJob = job;
  isProcessing = true;
  setVisible(progressSection, true);
  setVisible(resultsSection, false);
  setProgress(message || 'عامل GitHub Actions ينفذ المهمة.', 'processing');
  if (startDownloadBtn) {
    startDownloadBtn.disabled = true;
    startDownloadBtn.textContent = 'جارٍ إنشاء Reel...';
  }
  try { sessionStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job)); } catch {}
}

async function pollActiveJob() {
  if (polling || !activeJob) return;
  polling = true;
  const job = activeJob;
  try {
    const query = new URLSearchParams({ runId: job.runId, requestId: job.requestId });
    const response = await fetch(`/api/jobs?${query}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    const data = await readApiResponse(response);
    if (!activeJob || activeJob.runId !== job.runId) return;
    if (data.status === 'completed' && data.artifactReady) {
      renderCompleted(data, job);
      return;
    }
    if (data.status === 'failed') {
      activeJob = null;
      try { sessionStorage.removeItem(ACTIVE_JOB_KEY); } catch {}
      showProcessError(data.message || 'تعذّر إنشاء Reel من هذا المصدر.');
      return;
    }
    renderActiveJob(job, data.message || 'يعالج العامل المصدر.');
  } catch (error) {
    if (error.status === 401) {
      activeJob = null;
      try { sessionStorage.removeItem(ACTIVE_JOB_KEY); } catch {}
      showProcessError('انتهت جلسة الوصول؛ افتح رمز الوصول ثم أعد تشغيل المهمة إذا لم تكتمل.');
      pendingStartAfterAuth = false;
      return;
    }
    // Temporary network/API errors do not discard the running job or successful source preview.
    if (progressStatusText) progressStatusText.textContent = 'تعذّر تحديث الحالة مؤقتًا؛ ستتم إعادة المحاولة.';
  } finally {
    polling = false;
    if (activeJob) window.setTimeout(pollActiveJob, POLL_INTERVAL_MS);
  }
}

async function startWorkerJob() {
  if (!currentVideoData || isProcessing) return;
  if (!analyzedInputUrl || urlInput?.value?.trim() !== analyzedInputUrl) {
    showProcessError('تغيّر الرابط بعد الفحص؛ أعد تحليل الرابط قبل إنشاء Reel.');
    return;
  }
  isProcessing = true;
  if (startDownloadBtn) {
    startDownloadBtn.disabled = true;
    startDownloadBtn.textContent = 'جارٍ بدء العامل المجاني...';
  }
  setProgress('إرسال المهمة إلى GitHub Actions.', 'processing');
  try {
    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ url: currentSourceUrl || analyzedInputUrl })
    });
    const data = await readApiResponse(response);
    const job = { runId: String(data.runId), requestId: String(data.requestId), startedAt: Date.now() };
    renderActiveJob(job, 'أُرسلت المهمة؛ العامل يجهّز التنفيذ.');
    pollActiveJob();
  } catch (error) {
    showProcessError(error.message || 'تعذر بدء العامل؛ بقيت معاينة المصدر محفوظة.');
  }
}

if (analyzeForm && analyzeBtn && urlInput) {
  analyzeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isAnalyzing) return;
    if (isProcessing) {
      setStatus('ready', 'انتظر اكتمال Reel الحالي قبل فحص رابط جديد.');
      return;
    }

    const url = urlInput.value.trim();
    currentVideoData = null;
    currentSourceUrl = null;
    analyzedInputUrl = null;
    setVisible(videoCard, false);
    setVisible(workspace, false);
    if (!url) {
      setStatus('error', 'ألصق رابط BiliBili أولًا.');
      urlInput.focus();
      return;
    }
    if (!isSupportedBiliUrl(url)) {
      setStatus('error', 'الرابط غير مدعوم. استخدم رابطًا من bilibili.tv أو bilibili.com أو bili.im أو b23.tv.');
      return;
    }

    isAnalyzing = true;
    analyzeForm.setAttribute('aria-busy', 'true');
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'جاري الاتصال...';
    setVisible(videoCard, false);
    setVisible(workspace, false);
    setVisible(progressSection, false);
    setVisible(resultsSection, false);
    setStatus('busy', 'جاري الاتصال بـ BiliBili وجلب بيانات الفيديو...');

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    try {
      const endpoint = new URL('/api/metadata', window.location.origin);
      endpoint.searchParams.set('url', url);
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      const data = await readApiResponse(response);
      if (!data?.video || (!data.video.title && !data.video.thumbnail)) {
        throw new Error('وصل الرد، لكن لم يعثر BiliReels على عنوان أو صورة لهذا الفيديو.');
      }
      renderVideo(data.video);
      currentSourceUrl = typeof data.resolvedUrl === 'string' ? data.resolvedUrl : url;
      analyzedInputUrl = url;
      setStatus('ready', 'تم العثور على الفيديو. يمكنك إنشاء Reel واحد بطول 30 ثانية.');
      videoCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'انتهت مهلة الاتصال بعد 15 ثانية. أعد المحاولة أو جرّب الرابط الكامل بدل المختصر.'
        : error?.message || 'تعذر الاتصال بالخادم. تحقّق من اتصالك ثم أعد المحاولة.';
      currentVideoData = null;
      setVisible(videoCard, false);
      setVisible(workspace, false);
      setStatus('error', message);
    } finally {
      window.clearTimeout(timeoutId);
      isAnalyzing = false;
      analyzeForm.removeAttribute('aria-busy');
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'تحليل';
    }
  });
} else {
  console.error('BiliReels: required analyze form elements are missing.');
}

if (startDownloadBtn) {
  startDownloadBtn.addEventListener('click', async () => {
    if (!currentVideoData || isProcessing) return;
    try {
      const authenticated = await authenticateStatus();
      if (authenticated) {
        await startWorkerJob();
      } else {
        pendingStartAfterAuth = true;
        showAuthDialog();
      }
    } catch (error) {
      showProcessError(error.message || 'عامل الفيديو غير مهيأ بعد.');
    }
  });
}

if (workerAuthForm) {
  workerAuthForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!workerAccessCode?.value || !workerAuthSubmit) return;
    workerAuthSubmit.disabled = true;
    if (workerAuthError) {
      workerAuthError.textContent = '';
      workerAuthError.hidden = true;
    }
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ code: workerAccessCode.value })
      });
      await readApiResponse(response);
      workerAccessCode.value = '';
      workerAuthDialog?.close();
      if (pendingStartAfterAuth) {
        pendingStartAfterAuth = false;
        await startWorkerJob();
      }
    } catch (error) {
      if (workerAuthError) {
        workerAuthError.textContent = error.message || 'تعذر فتح جلسة المعالجة.';
        workerAuthError.hidden = false;
      }
      workerAccessCode?.select();
    } finally {
      workerAuthSubmit.disabled = false;
    }
  });
}

workerAuthCancel?.addEventListener('click', () => {
  pendingStartAfterAuth = false;
  workerAccessCode.value = '';
  workerAuthDialog?.close();
});

workerAuthDialog?.addEventListener('click', (event) => {
  if (event.target === workerAuthDialog) {
    pendingStartAfterAuth = false;
    workerAccessCode.value = '';
    workerAuthDialog.close();
  }
});

downloadAll?.addEventListener('click', () => {
  const downloadUrl = downloadAll.dataset.downloadUrl || completedJob?.downloadUrl;
  if (downloadUrl) window.location.assign(downloadUrl);
});

function restoreSavedState() {
  try {
    const savedCompleted = JSON.parse(sessionStorage.getItem(COMPLETED_JOB_KEY) || 'null');
    if (savedCompleted?.downloadUrl) {
      completedJob = savedCompleted;
      if (downloadAll) {
        downloadAll.dataset.downloadUrl = savedCompleted.downloadUrl;
        downloadAll.textContent = 'تنزيل Reel · ZIP يحتوي MP4';
      }
      setVisible(resultsSection, true);
      if (savedCompleted.runId && savedCompleted.requestId) loadReelPreview(savedCompleted);
    }
    const savedActive = JSON.parse(sessionStorage.getItem(ACTIVE_JOB_KEY) || 'null');
    if (savedActive?.runId && savedActive?.requestId) {
      renderActiveJob(savedActive, 'استعادة حالة مهمة Reel السابقة.');
      pollActiveJob();
    }
  } catch {
    try {
      sessionStorage.removeItem(ACTIVE_JOB_KEY);
      sessionStorage.removeItem(COMPLETED_JOB_KEY);
    } catch {}
  }
}

restoreSavedState();
