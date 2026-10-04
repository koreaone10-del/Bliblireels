// app.js — BiliReels server studio + local fallback
// Handles BiliBili URL preview, reel options, access code, server dispatch, and polling.
// Also keeps the on-device ffmpeg.wasm path working via the collapsible local section.

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════
const FFMPEG_SCRIPT_URL = new URL('/vendor/ffmpeg/ffmpeg.js', window.location.origin).href;
const FFMPEG_CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CLIP_SECONDS = 30;
const OUTPUT_WIDTH = 720;
const OUTPUT_HEIGHT = 1280;

const ALLOWED_BILI_DOMAINS = ['bilibili.tv', 'bilibili.com', 'b23.tv', 'bili.im', 'bili2233.cn'];
const SUPPORTED_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', '3gp']);

const ACCESS_TOKEN_KEY = 'bilireels.session.v1';
const ACCESS_TOKEN_TTL_MS = 2 * 60 * 60 * 1000 - 60 * 1000; // 2h minus 1m safety
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 420; // 35 minutes: includes the 30-minute Actions limit plus startup margin

// ═══════════════════════════════════════════════════════════════
// Element references
// ═══════════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);

// Server flow
const analyzeForm = $('analyzeForm');
const analyzeBtn = $('analyzeBtn');
const urlInput = $('videoUrl');
const sourceStatus = $('sourceStatus');
const analysisMessage = $('analysisMessage');
const videoCard = $('videoCard');
const accessBanner = $('accessBanner');
const accessBannerText = $('accessBannerText');
const accessCodeBtn = $('accessCodeBtn');
const reelOptions = $('reelOptions');
const durationSlider = $('durationSlider');
const durationValue = $('durationValue');
const subtitlesToggle = $('subtitlesToggle');
const logoUrlInput = $('logoUrlInput');
const processSummary = $('processSummary');
const createReelBtn = $('createReelBtn');

// Progress + result
const progressSection = $('progressSection');
const progressStatusText = $('progressStatusText');
const progressPercentage = $('progressPercentage');
const processingProgress = $('processingProgress');
const progressBarFill = $('progressBarFill');
const resultsSection = $('resultsSection');
const reelPreviewWrap = $('reelPreviewWrap');
const reelVideo = $('reelVideo');
const reelPreviewStatus = $('reelPreviewStatus');
const resultStatus = $('resultStatus');
const resultNote = $('resultNote');
const downloadReel = $('downloadReel');
const runLink = $('runLink');

// Access dialog
const accessCodeDialog = $('accessCodeDialog');
const accessCodeInput = $('accessCodeInput');
const accessCodeError = $('accessCodeError');
const accessCodeSave = $('accessCodeSave');
const accessCodeCancel = $('accessCodeCancel');

// Local file flow
const fileInput = $('videoFileInput');
const fileDropzone = $('fileDropzone');
const localFileCard = $('localFileCard');
const localFileName = $('localFileName');
const localFileMeta = $('localFileMeta');
const sourcePreview = $('sourceVideoPreview');
const removeFileBtn = $('removeFileBtn');

// ═══════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════
let metadataTitle = '';
let metadataVideo = null;
let selectedFile = null;
let sourceObjectUrl = null;
let outputObjectUrl = null;
let serverObjectUrl = null;
let ffmpegInstance = null;
let ffmpegLoadPromise = null;
let isProcessing = false;
let pollTimer = null;
let pollAttempts = 0;
let lastRunUrl = '';
let activeRequestId = null;
const temporaryObjectUrls = new Set();

// ═══════════════════════════════════════════════════════════════
// Small helpers
// ═══════════════════════════════════════════════════════════════
function setVisible(element, visible) {
  if (!element) return;
  element.hidden = !visible;
  element.classList.toggle('hidden', !visible);
}

function setSourceStatus(text, state = 'ready') {
  if (!sourceStatus) return;
  sourceStatus.textContent = text;
  sourceStatus.classList.remove('ready', 'busy', 'error');
  sourceStatus.classList.add(state);
}

function setAnalysisMessage(text, state = 'ready') {
  if (!analysisMessage) return;
  analysisMessage.textContent = text;
  analysisMessage.dataset.state = state;
  setVisible(analysisMessage, Boolean(text));
}

function showToast(message, durationMs = 3200) {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => toast.classList.remove('show'), durationMs);
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return 'غير متاح';
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} كيلوبايت`;
  return `${(value / (1024 * 1024)).toFixed(1)} ميغابايت`;
}

function formatDuration(value) {
  if (!Number.isFinite(value) || value < 0) return 'غير متاح';
  const seconds = Math.floor(value);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${remainder} ثانية`;
}

function makeObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  temporaryObjectUrls.add(url);
  return url;
}

function revokeObjectUrl(url) {
  if (!url) return;
  URL.revokeObjectURL(url);
  temporaryObjectUrls.delete(url);
}

function isSupportedBiliUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    return ALLOWED_BILI_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function readApiResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`ردّ الخادم ليس JSON صالحًا (HTTP ${response.status}).`);
  }
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.error || `فشل الطلب (HTTP ${response.status}).`);
    error.status = response.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}

// ═══════════════════════════════════════════════════════════════
// Access code / session management
// ═══════════════════════════════════════════════════════════════
function getStoredSession() {
  try {
    const raw = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      return null;
    }
    if (Date.now() >= parsed.expiresAt) {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function storeSession(token, expiresInMs) {
  try {
    localStorage.setItem(ACCESS_TOKEN_KEY, JSON.stringify({
      token,
      expiresAt: Date.now() + Math.max(60_000, expiresInMs - 60_000),
    }));
  } catch {
    // ignore quota errors
  }
}

function clearStoredSession() {
  try { localStorage.removeItem(ACCESS_TOKEN_KEY); } catch {}
}

function setAccessBanner(message, state = 'error') {
  if (!accessBanner) return;
  if (!message) {
    setVisible(accessBanner, false);
    return;
  }
  setVisible(accessBanner, true);
  if (accessBannerText) accessBannerText.textContent = message;
  accessBanner.dataset.state = state;
}

async function requestAccessToken(code) {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await readApiResponse(response);
  if (!data?.token) throw new Error('لم يُرجع الخادم رمز جلسة صالحًا.');
  storeSession(data.token, Number(data.expiresInMs) || ACCESS_TOKEN_TTL_MS);
  return data.token;
}

function openAccessDialog(errorText = '') {
  if (!accessCodeDialog) return;
  setVisible(accessCodeDialog, true);
  if (accessCodeError) {
    accessCodeError.textContent = errorText;
    setVisible(accessCodeError, Boolean(errorText));
  }
  if (accessCodeInput) {
    accessCodeInput.value = '';
    window.setTimeout(() => accessCodeInput.focus(), 50);
  }
}

function closeAccessDialog() {
  if (!accessCodeDialog) return;
  setVisible(accessCodeDialog, false);
  if (accessCodeError) {
    accessCodeError.textContent = '';
    setVisible(accessCodeError, false);
  }
}

async function ensureSession({ interactive = true } = {}) {
  const existing = getStoredSession();
  if (existing) return existing.token;
  if (!interactive) return null;
  return new Promise((resolve) => {
    openAccessDialog();
    window.__bilireelsSessionResolve = resolve;
  });
}

// Dialog buttons
if (accessCodeSave && accessCodeInput) {
  accessCodeSave.addEventListener('click', async () => {
    const code = (accessCodeInput.value || '').trim();
    if (!code) {
      if (accessCodeError) {
        accessCodeError.textContent = 'أدخل رمز الوصول.';
        setVisible(accessCodeError, true);
      }
      return;
    }
    accessCodeSave.disabled = true;
    accessCodeSave.textContent = 'جارٍ التحقق…';
    try {
      const token = await requestAccessToken(code);
      closeAccessDialog();
      setAccessBanner('', 'ready');
      if (typeof window.__bilireelsSessionResolve === 'function') {
        window.__bilireelsSessionResolve(token);
        window.__bilireelsSessionResolve = null;
      }
      showToast('تم تفعيل الجلسة بنجاح.');
    } catch (error) {
      const msg = error.message || 'تعذر التحقق من الرمز.';
      if (accessCodeError) {
        accessCodeError.textContent = msg;
        setVisible(accessCodeError, true);
      }
      if (error.status === 503) {
        closeAccessDialog();
        setAccessBanner('العامل غير مفعّل بعد على الخادم. تواصل مع المالك.', 'error');
      }
    } finally {
      accessCodeSave.disabled = false;
      accessCodeSave.textContent = 'تفعيل';
    }
  });
}
if (accessCodeCancel) {
  accessCodeCancel.addEventListener('click', () => {
    closeAccessDialog();
    if (typeof window.__bilireelsSessionResolve === 'function') {
      window.__bilireelsSessionResolve(null);
      window.__bilireelsSessionResolve = null;
    }
  });
}
if (accessCodeBtn) {
  accessCodeBtn.addEventListener('click', () => openAccessDialog());
}
if (accessCodeDialog) {
  accessCodeDialog.addEventListener('click', (event) => {
    if (event.target === accessCodeDialog) {
      closeAccessDialog();
      if (typeof window.__bilireelsSessionResolve === 'function') {
        window.__bilireelsSessionResolve(null);
        window.__bilireelsSessionResolve = null;
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// Metadata preview
// ═══════════════════════════════════════════════════════════════
function renderMetadata(video) {
  const title = String(video.title || 'فيديو BiliBili').trim();
  const author = typeof video.author === 'object' ? video.author?.name : video.author;
  metadataTitle = title;
  metadataVideo = video;

  const t = $('videoTitle');
  const a = $('videoAuthor');
  const d = $('videoDuration');
  const v = $('videoViews');
  if (t) t.textContent = title;
  if (a) a.textContent = author || 'غير متاح';
  if (d) d.textContent = formatDuration(Number(video.duration));
  const views = Number(video.views);
  if (v) v.textContent = Number.isFinite(views) && views > 0 ? new Intl.NumberFormat('ar').format(views) : 'غير متاح';

  const image = $('videoThumbnail');
  const fallback = $('thumbnailFallback');
  if (image && fallback) {
    image.onerror = () => { image.hidden = true; fallback.hidden = false; };
    image.onload = () => { image.hidden = false; fallback.hidden = true; };
    try {
      const imageUrl = new URL(video.thumbnail);
      if (imageUrl.protocol !== 'https:' && imageUrl.protocol !== 'http:') throw new Error('bad');
      image.alt = `صورة مصغرة: ${title}`;
      image.src = imageUrl.href;
    } catch {
      image.removeAttribute('src');
      image.hidden = true;
      fallback.hidden = false;
    }
  }

  setVisible(videoCard, true);
  setVisible(reelOptions, true);
  updateProcessSummary();
  reelOptions?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateProcessSummary() {
  if (!processSummary) return;
  const duration = Number(durationSlider?.value || 30);
  const subtitles = subtitlesToggle?.checked ? 'ترجمة عربية' : 'بلا ترجمة';
  const logo = (logoUrlInput?.value || '').trim() ? 'مع شعار' : 'بلا شعار';
  processSummary.textContent = `${duration} ثانية · 720×1280 · ${subtitles} · ${logo}`;
}

if (durationSlider) {
  durationSlider.addEventListener('input', () => {
    if (durationValue) durationValue.textContent = `${durationSlider.value}s`;
    updateProcessSummary();
  });
}
if (subtitlesToggle) subtitlesToggle.addEventListener('change', updateProcessSummary);
if (logoUrlInput) logoUrlInput.addEventListener('input', updateProcessSummary);

// Analyze form
if (analyzeForm && analyzeBtn && urlInput) {
  analyzeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = urlInput.value.trim();
    if (!isSupportedBiliUrl(url)) {
      setAnalysisMessage('الرابط غير مدعوم. استخدم رابط BiliBili صحيحًا (bilibili.com، b23.tv، bilibili.tv).', 'error');
      setSourceStatus('● رابط غير صالح', 'error');
      return;
    }
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'جارٍ الفحص…';
    setAnalysisMessage('جارٍ جلب العنوان والصورة والمدة…', 'busy');
    setSourceStatus('● جارٍ الفحص', 'busy');
    setVisible(videoCard, false);
    setVisible(reelOptions, false);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    try {
      const endpoint = new URL('/api/metadata', window.location.origin);
      endpoint.searchParams.set('url', url);
      const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, signal: controller.signal });
      const data = await readApiResponse(response);
      if (!data.video || (!data.video.title && !data.video.thumbnail)) {
        throw new Error('لم تُرجع الصفحة عنوانًا أو صورة.');
      }
      renderMetadata(data.video);
      setAnalysisMessage('المعاينة جاهزة. اضبط الخيارات ثم اضغط «أنشئ Reel».', 'ready');
      setSourceStatus('● الرابط جاهز', 'ready');
    } catch (error) {
      const message = error.name === 'AbortError'
        ? 'انتهت مهلة الفحص. أعد المحاولة.'
        : error.message || 'تعذر فحص الرابط.';
      setAnalysisMessage(message, 'error');
      setSourceStatus('● فشل الفحص', 'error');
    } finally {
      window.clearTimeout(timeoutId);
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'فحص الرابط';
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// Server dispatch + polling
// ═══════════════════════════════════════════════════════════════
function resetServerOutput() {
  if (serverObjectUrl) {
    revokeObjectUrl(serverObjectUrl);
    serverObjectUrl = null;
  }
  if (reelVideo) {
    reelVideo.pause();
    reelVideo.removeAttribute('src');
    reelVideo.load();
  }
  if (downloadReel) {
    downloadReel.removeAttribute('href');
    downloadReel.removeAttribute('download');
  }
  if (runLink) {
    runLink.removeAttribute('href');
    setVisible(runLink, false);
  }
  setVisible(resultsSection, false);
  setVisible(progressSection, false);
}

function setProgress(message, progress = null, detail = '') {
  setVisible(progressSection, true);
  if (progressStatusText) progressStatusText.textContent = message;
  if (progressPercentage) progressPercentage.textContent = detail;
  const determinate = Number.isFinite(progress);
  if (progressBarFill) {
    progressBarFill.classList.toggle('progress-indeterminate', !determinate);
    progressBarFill.style.width = determinate ? `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` : '35%';
  }
  if (processingProgress) {
    if (determinate) processingProgress.setAttribute('aria-valuenow', String(Math.round(Math.max(0, Math.min(1, progress)) * 100)));
    else processingProgress.removeAttribute('aria-valuenow');
  }
}

async function dispatchToServer(payload, token) {
  const response = await fetch('/api/dispatch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return readApiResponse(response);
}

async function pollStatus(requestId, token) {
  const response = await fetch(`/api/status?requestId=${encodeURIComponent(requestId)}`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  return readApiResponse(response);
}

function stopPolling() {
  if (pollTimer) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }
  pollAttempts = 0;
  activeRequestId = null;
}

async function showServerResult(data) {
  if (!data.videoUrl) throw new Error('لم يُعد العامل رابط الفيديو.');

  // Set video element to stream from the URL directly (public bucket).
  reelVideo.src = data.videoUrl;
  reelVideo.load();
  downloadReel.href = data.videoUrl;
  downloadReel.download = `bilireels-${Date.now()}.mp4`;
  resultStatus.textContent = 'MP4 READY';
  resultNote.textContent = 'اكتمل الفيديو على الخادم. يمكنك معاينته أو تنزيله مباشرة.';
  reelPreviewStatus.textContent = 'المعاينة جاهزة.';

  if (data.runUrl && runLink) {
    runLink.href = data.runUrl;
    setVisible(runLink, true);
  } else if (runLink) {
    setVisible(runLink, false);
  }

  setVisible(reelPreviewWrap, true);
  setVisible(resultsSection, true);
  setProgress('اكتمل إنشاء Reel على الخادم.', 1, 'الفيديو جاهز الآن.');
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleCreateReel() {
  if (isProcessing) return;

  if (!metadataVideo) {
    showToast('افحص رابط BiliBili أولًا.');
    return;
  }

  const duration = Number(durationSlider?.value || 30);
  const subtitles = Boolean(subtitlesToggle?.checked);
  const logoUrl = (logoUrlInput?.value || '').trim();

  if (logoUrl && !/^https:\/\//i.test(logoUrl)) {
    showToast('رابط الشعار يجب أن يبدأ بـ https://.');
    return;
  }

  isProcessing = true;
  createReelBtn.disabled = true;
  createReelBtn.textContent = 'جارٍ الإرسال…';
  resetServerOutput();
  lastRunUrl = '';

  try {
    const token = await ensureSession({ interactive: true });
    if (!token) {
      isProcessing = false;
      createReelBtn.disabled = false;
      createReelBtn.textContent = 'أنشئ Reel على الخادم →';
      return;
    }

    setProgress('جارٍ إرسال الطلب إلى العامل…', null, 'تبدأ أولًا مرحلة تنزيل المصدر.');
    setSourceStatus('● العامل يعمل', 'busy');

    const payload = {
      source_url: urlInput.value.trim(),
      duration,
      logo_url: logoUrl,
      generate_subtitles: subtitles,
    };

    const dispatch = await dispatchToServer(payload, token);
    activeRequestId = dispatch.requestId;
    pollAttempts = 0;
    setProgress('العامل بدأ العمل…', null, 'تنزيل المصدر ثم تحويله إلى Reel عمودي.');

    pollTimer = window.setTimeout(async function tick() {
      if (!activeRequestId) return;
      pollAttempts += 1;

      if (pollAttempts > POLL_MAX_ATTEMPTS) {
        stopPolling();
        setProgress('انتهت مهلة الانتظار.', 0, 'راجع سجل GitHub لمعرفة ما حدث.');
        if (lastRunUrl && runLink) {
          runLink.href = lastRunUrl;
          setVisible(runLink, true);
          setVisible(resultsSection, true);
        }
        setSourceStatus('● مهلة', 'error');
        isProcessing = false;
        createReelBtn.disabled = false;
        createReelBtn.textContent = 'أنشئ Reel على الخادم →';
        return;
      }

      try {
        const status = await pollStatus(activeRequestId, token);
        if (status.runUrl) lastRunUrl = status.runUrl;

        if (status.state === 'starting' || status.state === 'queued') {
          setProgress('في قائمة الانتظار…', null, status.message || 'بانتظار دور العامل.');
        } else if (status.state === 'in_progress') {
          // The two external workers do not expose a reliable numeric percentage.
          setProgress('جارٍ التحميل والمعالجة…', null, status.message || 'العامل يعمل الآن.');
        } else if (status.state === 'completed' && status.videoUrl) {
          stopPolling();
          await showServerResult(status);
          setSourceStatus('● جاهز', 'ready');
          isProcessing = false;
          createReelBtn.disabled = false;
          createReelBtn.textContent = 'أنشئ Reel جديد →';
          return;
        } else if (status.state === 'failed' || status.state === 'completed_no_url') {
          stopPolling();
          const msg = status.message || 'فشل العامل.';
          setProgress('فشل العامل', 0, msg);
          setSourceStatus('● فشل', 'error');
          if (status.runUrl && runLink) {
            runLink.href = status.runUrl;
            setVisible(runLink, true);
            setVisible(resultsSection, true);
            resultStatus.textContent = 'FAILED';
            resultNote.textContent = msg;
            if (reelPreviewWrap) setVisible(reelPreviewWrap, false);
          }
          isProcessing = false;
          createReelBtn.disabled = false;
          createReelBtn.textContent = 'أعد المحاولة →';
          return;
        }

        pollTimer = window.setTimeout(tick, POLL_INTERVAL_MS);
      } catch (error) {
        if (error.status === 401) {
          // Session expired mid-poll.
          clearStoredSession();
          stopPolling();
          setProgress('انتهت الجلسة.', 0, 'أعد إدخال رمز الوصول.');
          isProcessing = false;
          createReelBtn.disabled = false;
          createReelBtn.textContent = 'أنشئ Reel على الخادم →';
          openAccessDialog('انتهت الجلسة. أعد الإدخال.');
          return;
        }
        if ([400, 403, 404, 409, 422, 503].includes(error.status)) {
          stopPolling();
          setProgress('توقفت المعالجة', 0, error.message || 'تحقق من إعدادات العامل ثم أعد المحاولة.');
          setSourceStatus('● يحتاج إجراء', 'error');
          if (lastRunUrl && runLink) {
            runLink.href = lastRunUrl;
            setVisible(runLink, true);
            setVisible(resultsSection, true);
          }
          isProcessing = false;
          createReelBtn.disabled = false;
          createReelBtn.textContent = 'أعد المحاولة →';
          return;
        }
        // Transient Render/GitHub error: show a live retry state instead of failing silently.
        setProgress('انقطع الاتصال مؤقتًا…', null, 'نعيد الاتصال بالعامل تلقائيًا.');
        pollTimer = window.setTimeout(tick, POLL_INTERVAL_MS * 2);
      }
    }, POLL_INTERVAL_MS);
  } catch (error) {
    stopPolling();
    const msg = error.message || 'تعذر إرسال الطلب.';
    setProgress('تعذر بدء العامل', 0, msg);
    setSourceStatus('● تعذر البدء', 'error');
    if (error.status === 401) openAccessDialog('انتهت الجلسة. أعد الإدخال.');
    else if (error.status === 503) setAccessBanner(msg, 'error');
    else showToast(msg);
    isProcessing = false;
    createReelBtn.disabled = false;
    createReelBtn.textContent = 'أنشئ Reel على الخادم →';
  }
}

if (createReelBtn) {
  createReelBtn.addEventListener('click', handleCreateReel);
}

// Check for existing session on load
(function checkExistingSession() {
  if (!getStoredSession()) {
    setAccessBanner('أدخل رمز المالك مرة واحدة قبل بدء المعالجة على الخادم.', 'info');
  } else {
    setAccessBanner('', 'ready');
  }
})();

// ═══════════════════════════════════════════════════════════════
// LOCAL FILE PATH (unchanged behavior, kept as fallback)
// ═══════════════════════════════════════════════════════════════
function validateFile(file) {
  if (!file || !file.size) return 'الملف فارغ أو غير قابل للقراءة.';
  if (file.size > MAX_SOURCE_BYTES) return 'حجم الملف يتجاوز 2 غيغابايت.';
  const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  if (!(file.type.startsWith('video/') || SUPPORTED_EXTENSIONS.has(extension))) {
    return 'اختر ملف فيديو مثل MP4 أو MOV أو WebM.';
  }
  return '';
}

function clearLocalOutput() {
  if (outputObjectUrl) revokeObjectUrl(outputObjectUrl);
  outputObjectUrl = null;
}

function selectFile(file) {
  const error = validateFile(file);
  if (error) {
    setSourceStatus('● ملف غير صالح', 'error');
    setAnalysisMessage(error, 'error');
    return;
  }
  clearLocalOutput();
  if (sourceObjectUrl) revokeObjectUrl(sourceObjectUrl);
  selectedFile = file;
  sourceObjectUrl = makeObjectUrl(file);
  if (localFileName) localFileName.textContent = file.name;
  if (localFileMeta) localFileMeta.textContent = `${formatBytes(file.size)} · جارٍ قراءة المدة…`;
  if (sourcePreview) {
    sourcePreview.onerror = () => {
      if (localFileMeta) localFileMeta.textContent = `${formatBytes(file.size)} · تعذر العرض؛ جرّب MP4.`;
    };
    sourcePreview.onloadedmetadata = () => {
      if (localFileMeta) localFileMeta.textContent = `${formatBytes(file.size)} · ${formatDuration(sourcePreview.duration)} · أول 30 ثانية كحد أقصى`;
    };
    sourcePreview.src = sourceObjectUrl;
    sourcePreview.load();
  }
  if (fileInput) fileInput.value = '';
  setVisible(localFileCard, true);
  showToast('الملف المحلي جاهز للمعالجة على الجهاز.');
}

function removeSelectedFile() {
  selectedFile = null;
  if (sourceObjectUrl) revokeObjectUrl(sourceObjectUrl);
  sourceObjectUrl = null;
  if (sourcePreview) {
    sourcePreview.pause();
    sourcePreview.removeAttribute('src');
    sourcePreview.load();
  }
  if (fileInput) fileInput.value = '';
  if (localFileMeta) localFileMeta.textContent = '';
  setVisible(localFileCard, false);
  clearLocalOutput();
}

if (fileInput) fileInput.addEventListener('change', () => selectFile(fileInput.files?.[0]));
if (removeFileBtn) removeFileBtn.addEventListener('click', removeSelectedFile);
if (fileDropzone) {
  fileDropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    fileDropzone.classList.add('dragover');
  });
  fileDropzone.addEventListener('dragleave', () => fileDropzone.classList.remove('dragover'));
  fileDropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    fileDropzone.classList.remove('dragover');
    selectFile(event.dataTransfer?.files?.[0]);
  });
}

// Local ffmpeg.wasm path (unchanged)
function loadFfmpegScript() {
  if (window.FFmpegWASM?.FFmpeg) return Promise.resolve();
  if (ffmpegLoadPromise) return ffmpegLoadPromise;
  ffmpegLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = FFMPEG_SCRIPT_URL;
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.onload = () => window.FFmpegWASM?.FFmpeg ? resolve() : reject(new Error('تعذر تحميل مكتبة التحويل.'));
    script.onerror = () => reject(new Error('تعذر تحميل مكتبة الفيديو من CDN.'));
    document.head.appendChild(script);
  }).catch((error) => {
    ffmpegLoadPromise = null;
    throw error;
  });
  return ffmpegLoadPromise;
}

async function toBlobURL(url, mimeType) {
  const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
  if (!response.ok) throw new Error(`تعذر تنزيل محرك الفيديو (HTTP ${response.status}).`);
  const blob = await response.blob();
  return makeObjectUrl(new Blob([blob], { type: mimeType }));
}

async function loadFfmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  setProgress('تحميل محرك MP4 المحلي (حوالي 31MB)…', null, 'الخطوة الأولى فقط.');
  await loadFfmpegScript();
  const ffmpeg = new window.FFmpegWASM.FFmpeg();
  const coreURL = await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, 'text/javascript');
  const wasmURL = await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm');
  await ffmpeg.load({ coreURL, wasmURL });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

function drawVerticalFrame(video, context) {
  const width = OUTPUT_WIDTH;
  const height = OUTPUT_HEIGHT;
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return;
  context.clearRect(0, 0, width, height);
  const coverScale = Math.max(width / sourceWidth, height / sourceHeight);
  const coverWidth = sourceWidth * coverScale;
  const coverHeight = sourceHeight * coverScale;
  context.save();
  context.filter = 'blur(30px) brightness(0.62)';
  context.drawImage(video, (width - coverWidth) / 2, (height - coverHeight) / 2, coverWidth, coverHeight);
  context.restore();
  const fitScale = Math.min(width / sourceWidth, height / sourceHeight);
  const fitWidth = sourceWidth * fitScale;
  const fitHeight = sourceHeight * fitScale;
  context.save();
  context.filter = 'none';
  context.drawImage(video, (width - fitWidth) / 2, (height - fitHeight) / 2, fitWidth, fitHeight);
  context.restore();
}

function chooseRecorder(stream) {
  if (!window.MediaRecorder) throw new Error('هذا المتصفح لا يدعم التسجيل المحلي.');
  const candidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4'
  ];
  for (const mimeType of candidates) {
    if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(mimeType)) {
      try { return new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 }); } catch {}
    }
  }
  try { return new MediaRecorder(stream, { videoBitsPerSecond: 4_000_000 }); }
  catch { throw new Error('تعذر بدء التسجيل على هذا المتصفح.'); }
}

async function recordFirstVerticalSegment(file) {
  if (!HTMLCanvasElement.prototype.captureStream) throw new Error('المتصفح لا يدعم التقاط الفيديو.');
  const fileUrl = makeObjectUrl(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.style.cssText = 'position:fixed;left:-4px;top:-4px;width:2px;height:2px;opacity:0;pointer-events:none;';
  document.body.appendChild(video);

  let audioContext = null;
  let sourceNode = null;
  let recorder = null;
  let rafId = 0;
  let timeoutId = 0;
  let recordingStream = null;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      try {
        audioContext = new AudioContextClass();
        void audioContext.resume().catch(() => {});
      } catch { audioContext = null; }
    }

    const metadataReady = new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('انتهت مهلة قراءة الفيديو.')), 30000);
      video.addEventListener('loadedmetadata', () => { window.clearTimeout(timer); resolve(); }, { once: true });
      video.addEventListener('error', () => { window.clearTimeout(timer); reject(new Error('تعذر فتح هذا الترميز.')); }, { once: true });
    });
    video.src = fileUrl;
    video.load();
    const earlyPlay = video.play().catch(() => null);
    await metadataReady;
    await earlyPlay;
    video.pause();
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
      throw new Error('لم يتمكن المتصفح من قراءة مدة الفيديو أو أبعاده.');
    }
    const duration = Math.min(MAX_CLIP_SECONDS, video.duration);
    if (video.currentTime > 0.05) {
      video.currentTime = 0;
      await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
    }

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('تعذر تجهيز مساحة الرسم.');
    drawVerticalFrame(video, context);
    const canvasStream = canvas.captureStream(30);
    const tracks = [...canvasStream.getVideoTracks()];

    if (audioContext) {
      try {
        sourceNode = audioContext.createMediaElementSource(video);
        const destination = audioContext.createMediaStreamDestination();
        const silentOutput = audioContext.createGain();
        silentOutput.gain.value = 0;
        sourceNode.connect(destination);
        sourceNode.connect(silentOutput);
        silentOutput.connect(audioContext.destination);
        tracks.push(...destination.stream.getAudioTracks());
        await audioContext.resume();
      } catch {
        const capture = video.captureStream?.() || video.webkitCaptureStream?.();
        if (capture) tracks.push(...capture.getAudioTracks());
      }
    } else {
      const capture = video.captureStream?.() || video.webkitCaptureStream?.();
      if (capture) tracks.push(...capture.getAudioTracks());
    }

    recordingStream = new MediaStream(tracks);
    recorder = chooseRecorder(recordingStream);
    const chunks = [];

    const resultPromise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) chunks.push(event.data); });
      recorder.addEventListener('error', (event) => finish(reject, event.error || new Error('فشل التسجيل.')), { once: true });
      recorder.addEventListener('stop', () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        finish(blob.size ? resolve : reject, blob.size ? blob : new Error('لم ينتج المتصفح بيانات فيديو.'));
      }, { once: true });

      const draw = () => {
        drawVerticalFrame(video, context);
        const ratio = Math.min(1, video.currentTime / duration);
        setProgress(`تسجيل أول ${Math.ceil(duration)} ثانية…`, ratio, `${Math.floor(Math.min(video.currentTime, duration))} / ${Math.ceil(duration)} ثانية`);
        if (video.ended || video.currentTime >= duration - 0.02) {
          video.pause();
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        rafId = requestAnimationFrame(draw);
      };

      recorder.start(1000);
      timeoutId = window.setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, (duration + 45) * 1000);
      video.play().then(() => { rafId = requestAnimationFrame(draw); }).catch((error) => finish(reject, new Error(`تعذر تشغيل الملف: ${error.message || ''}`)));
    });

    const recordedBlob = await resultPromise;
    return { blob: recordedBlob, duration, mimeType: recordedBlob.type || recorder.mimeType || 'video/webm' };
  } finally {
    window.clearTimeout(timeoutId);
    if (rafId) cancelAnimationFrame(rafId);
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
    }
    recordingStream?.getTracks().forEach((track) => track.stop());
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    if (sourceNode) { try { sourceNode.disconnect(); } catch {} }
    if (audioContext) { try { await audioContext.close(); } catch {} }
    revokeObjectUrl(fileUrl);
  }
}

async function convertSegmentToMp4(segment) {
  const ffmpeg = await loadFfmpeg();
  const extension = segment.mimeType.includes('mp4') ? 'mp4' : 'webm';
  const stamp = Date.now();
  const inputName = `bilireels-input-${stamp}.${extension}`;
  const outputName = `bilireels-output-${stamp}.mp4`;
  const bytes = new Uint8Array(await segment.blob.arrayBuffer());
  setProgress('تحويل المقطع إلى MP4 عمودي…', null, 'يعمل على جهازك.');
  try {
    await ffmpeg.writeFile(inputName, bytes);
    const code = await ffmpeg.exec([
      '-hide_banner', '-i', inputName,
      '-t', segment.duration.toFixed(3),
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', outputName
    ]);
    if (code !== 0) throw new Error(`تعذر ترميز MP4 (رمز ${code}).`);
    const data = await ffmpeg.readFile(outputName);
    if (!data || !data.length) throw new Error('اكتمل التحويل دون ملف ناتج.');
    return new Blob([data], { type: 'video/mp4' });
  } finally {
    try { await ffmpeg.deleteFile(inputName); } catch {}
    try { await ffmpeg.deleteFile(outputName); } catch {}
  }
}

function localOutputFileName() {
  const base = (metadataTitle || selectedFile?.name?.replace(/\.[^.]+$/, '') || 'BiliReels-Reel')
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72) || 'BiliReels-Reel';
  return `${base}-reel-30s.mp4`;
}

async function processSelectedFileLocally() {
  if (!selectedFile || isProcessing) {
    if (!selectedFile) showToast('اختر ملفًا محليًا أولًا.');
    return;
  }
  isProcessing = true;
  resetServerOutput();
  const btn = document.querySelector('.local-process-btn') || createReelBtn;
  try {
    const segment = await recordFirstVerticalSegment(selectedFile);
    const mp4 = await convertSegmentToMp4(segment);
    outputObjectUrl = makeObjectUrl(mp4);
    reelVideo.src = outputObjectUrl;
    reelVideo.load();
    downloadReel.href = outputObjectUrl;
    downloadReel.download = localOutputFileName();
    resultStatus.textContent = 'MP4 READY';
    resultNote.textContent = `اكتمل الفيديو محليًا، ${formatDuration(segment.duration)}، 720×1280.`;
    reelPreviewStatus.textContent = 'المعاينة جاهزة محليًا.';
    setVisible(reelPreviewWrap, true);
    setVisible(resultsSection, true);
    setProgress('اكتمل إنشاء Reel على جهازك.', 1, 'يمكنك التنزيل الآن.');
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    setProgress('تعذرت المعالجة', 0, error?.message || 'خطأ غير متوقع.');
  } finally {
    isProcessing = false;
  }
}

// Expose for the local fallback button if added later
window.__bilireelsProcessLocal = processSelectedFileLocally;

// ═══════════════════════════════════════════════════════════════
// Cleanup on unload
// ═══════════════════════════════════════════════════════════════
window.addEventListener('pagehide', () => {
  stopPolling();
  for (const url of temporaryObjectUrls) URL.revokeObjectURL(url);
  temporaryObjectUrls.clear();
});
