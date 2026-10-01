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

let currentVideoData = null;
let isAnalyzing = false;

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
    startDownloadBtn.disabled = !video.directUrl;
    startDownloadBtn.textContent = video.directUrl
      ? 'بدء التحميل والتحويل'
      : 'التحميل سيكون متاحًا في المرحلة التالية';
  }
}

if (analyzeForm && analyzeBtn && urlInput) {
  analyzeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isAnalyzing) return;

    const url = urlInput.value.trim();
    currentVideoData = null;
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
      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(`ردّ الخادم ليس JSON صالحًا (HTTP ${response.status}).`);
      }

      if (!response.ok || data?.ok === false || data?.error) {
        throw new Error(data?.error || `تعذر جلب بيانات الفيديو (HTTP ${response.status}).`);
      }
      if (!data?.video || (!data.video.title && !data.video.thumbnail)) {
        throw new Error('وصل الرد، لكن لم يعثر BiliReels على عنوان أو صورة لهذا الفيديو.');
      }

      renderVideo(data.video);
      setStatus('ready', 'تم العثور على الفيديو. تظهر المعاينة وبيانات المصدر أدناه.');
      videoCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'انتهت مهلة الاتصال بعد 15 ثانية. أعد المحاولة أو جرّب الرابط الكامل بدل المختصر.'
        : error?.message || 'تعذر الاتصال بالخادم. تحقّق من اتصالك ثم أعد المحاولة.';
      currentVideoData = null;
      setVisible(videoCard, false);
      setVisible(workspace, false);
      setStatus('error', message);
      console.error('BiliReels metadata error:', error);
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
  startDownloadBtn.addEventListener('click', () => {
    if (!currentVideoData?.directUrl) {
      setStatus('ready', 'تم فحص الرابط بنجاح. تنزيل الفيديو ومعالجته مرحلة منفصلة لم تُفعّل بعد.');
      return;
    }

    const downloadUrl = new URL('/api/download', window.location.origin);
    downloadUrl.searchParams.set('url', currentVideoData.directUrl);
    downloadUrl.searchParams.set('title', currentVideoData.title || 'BiliReel');
    window.location.assign(downloadUrl.href);
  });
}
