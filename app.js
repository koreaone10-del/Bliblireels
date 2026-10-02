// Keep the UMD bundle and its class worker on this origin; browsers block CDN-hosted workers.
const FFMPEG_SCRIPT_URL = new URL('/vendor/ffmpeg/ffmpeg.js', window.location.origin).href;
const FFMPEG_CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CLIP_SECONDS = 30;
const OUTPUT_WIDTH = 720;
const OUTPUT_HEIGHT = 1280;

const fileInput = document.getElementById('videoFileInput');
const fileDropzone = document.getElementById('fileDropzone');
const localFileCard = document.getElementById('localFileCard');
const localFileName = document.getElementById('localFileName');
const localFileMeta = document.getElementById('localFileMeta');
const sourcePreview = document.getElementById('sourceVideoPreview');
const removeFileBtn = document.getElementById('removeFileBtn');
const workspace = document.getElementById('workspace');
const processVideoBtn = document.getElementById('processVideoBtn');
const progressSection = document.getElementById('progressSection');
const progressStatusText = document.getElementById('progressStatusText');
const progressPercentage = document.getElementById('progressPercentage');
const processingProgress = document.getElementById('processingProgress');
const progressBarFill = document.getElementById('progressBarFill');
const resultsSection = document.getElementById('resultsSection');
const reelPreviewWrap = document.getElementById('reelPreviewWrap');
const reelVideo = document.getElementById('reelVideo');
const reelPreviewStatus = document.getElementById('reelPreviewStatus');
const resultStatus = document.getElementById('resultStatus');
const resultNote = document.getElementById('resultNote');
const downloadReel = document.getElementById('downloadReel');
const analyzeForm = document.getElementById('analyzeForm');
const analyzeBtn = document.getElementById('analyzeBtn');
const urlInput = document.getElementById('videoUrl');
const sourceStatus = document.getElementById('sourceStatus');
const analysisMessage = document.getElementById('analysisMessage');
const videoCard = document.getElementById('videoCard');

const ALLOWED_BILI_DOMAINS = ['bilibili.tv', 'bilibili.com', 'b23.tv', 'bili.im', 'bili2233.cn'];
const SUPPORTED_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', '3gp']);
let selectedFile = null;
let sourceObjectUrl = null;
let outputObjectUrl = null;
let metadataTitle = '';
let ffmpegInstance = null;
let ffmpegLoadPromise = null;
let isProcessing = false;
const temporaryObjectUrls = new Set();

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

function setProgress(message, progress = null, detail = '') {
  setVisible(progressSection, true);
  if (progressStatusText) progressStatusText.textContent = message;
  if (progressPercentage) progressPercentage.textContent = detail || 'ملف الفيديو يبقى على جهازك.';
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

function clearOutput() {
  if (outputObjectUrl) revokeObjectUrl(outputObjectUrl);
  outputObjectUrl = null;
  if (reelVideo) {
    reelVideo.pause();
    reelVideo.removeAttribute('src');
    reelVideo.load();
  }
  if (downloadReel) {
    downloadReel.removeAttribute('href');
    downloadReel.removeAttribute('download');
  }
  setVisible(resultsSection, false);
  setVisible(progressSection, false);
}

function validateFile(file) {
  if (!file || !file.size) return 'الملف فارغ أو غير قابل للقراءة.';
  if (file.size > MAX_SOURCE_BYTES) return 'حجم الملف يتجاوز 2 غيغابايت؛ اختر ملفًا أصغر ليتعامل معه المتصفح بأمان.';
  const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  if (!(file.type.startsWith('video/') || SUPPORTED_EXTENSIONS.has(extension))) {
    return 'اختر ملف فيديو مثل MP4 أو MOV أو WebM.';
  }
  return '';
}

function selectFile(file) {
  const error = validateFile(file);
  if (error) {
    setSourceStatus('● ملف غير صالح', 'error');
    setAnalysisMessage(error, 'error');
    return;
  }
  clearOutput();
  if (sourceObjectUrl) revokeObjectUrl(sourceObjectUrl);
  selectedFile = file;
  sourceObjectUrl = makeObjectUrl(file);
  metadataTitle = '';
  if (localFileName) localFileName.textContent = file.name;
  if (localFileMeta) localFileMeta.textContent = `${formatBytes(file.size)} · جارٍ قراءة المدة…`;
  if (sourcePreview) {
    sourcePreview.onerror = () => {
      if (localFileMeta) localFileMeta.textContent = `${formatBytes(file.size)} · تعذر عرض المعاينة بهذا الترميز؛ جرّب MP4 أو MOV.`;
    };
    sourcePreview.onloadedmetadata = () => {
      if (localFileMeta) localFileMeta.textContent = `${formatBytes(file.size)} · ${formatDuration(sourcePreview.duration)} · أول 30 ثانية كحد أقصى`;
    };
    sourcePreview.src = sourceObjectUrl;
    sourcePreview.load();
  }
  if (fileInput) fileInput.value = '';
  setVisible(localFileCard, true);
  setVisible(workspace, true);
  if (processVideoBtn) {
    processVideoBtn.disabled = false;
    processVideoBtn.textContent = 'إنشاء Reel على جهازي →';
  }
  setSourceStatus('● الملف جاهز محليًا', 'ready');
  setAnalysisMessage('تم اختيار الملف. لن يُرسل إلى الخادم؛ اضغط «إنشاء Reel» لبدء المعالجة على جهازك.', 'ready');
  workspace.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function removeSelectedFile() {
  selectedFile = null;
  if (sourceObjectUrl) revokeObjectUrl(sourceObjectUrl);
  sourceObjectUrl = null;
  metadataTitle = '';
  if (sourcePreview) {
    sourcePreview.pause();
    sourcePreview.removeAttribute('src');
    sourcePreview.load();
  }
  if (fileInput) fileInput.value = '';
  if (localFileMeta) localFileMeta.textContent = '';
  setVisible(localFileCard, false);
  setVisible(workspace, false);
  clearOutput();
  setSourceStatus('● بانتظار الملف', 'ready');
  setAnalysisMessage('', 'ready');
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

function readAttribute(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(pattern);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : '';
}

async function readApiResponse(response) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`ردّ الخادم ليس JSON صالحًا (HTTP ${response.status}).`); }
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `فشلت معاينة الرابط (HTTP ${response.status}).`);
  return data;
}

function renderMetadata(video) {
  const title = String(video.title || 'فيديو BiliBili').trim();
  const author = typeof video.author === 'object' ? video.author?.name : video.author;
  metadataTitle = title;
  document.getElementById('videoTitle').textContent = title;
  document.getElementById('videoAuthor').textContent = author || 'غير متاح';
  document.getElementById('videoDuration').textContent = formatDuration(Number(video.duration));
  const views = Number(video.views);
  document.getElementById('videoViews').textContent = Number.isFinite(views) && views > 0 ? new Intl.NumberFormat('ar').format(views) : 'غير متاح';
  const image = document.getElementById('videoThumbnail');
  const fallback = document.getElementById('thumbnailFallback');
  image.onerror = () => { image.hidden = true; fallback.hidden = false; };
  image.onload = () => { image.hidden = false; fallback.hidden = true; };
  try {
    const imageUrl = new URL(video.thumbnail);
    if (imageUrl.protocol !== 'https:' && imageUrl.protocol !== 'http:') throw new Error('invalid image URL');
    image.alt = `صورة مصغرة: ${title}`;
    image.src = imageUrl.href;
  } catch {
    image.removeAttribute('src');
    image.hidden = true;
    fallback.hidden = false;
  }
  setVisible(videoCard, true);
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

if (analyzeForm && analyzeBtn && urlInput) {
  analyzeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = urlInput.value.trim();
    if (!isSupportedBiliUrl(url)) {
      setAnalysisMessage('الرابط غير مدعوم. استخدم رابط BiliBili صحيحًا؛ هذه المعاينة لا تنزّل الفيديو.', 'error');
      return;
    }
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'جارٍ الفحص…';
    setAnalysisMessage('جارٍ جلب العنوان والصورة فقط…', 'busy');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    try {
      const endpoint = new URL('/api/metadata', window.location.origin);
      endpoint.searchParams.set('url', url);
      const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, signal: controller.signal });
      const data = await readApiResponse(response);
      if (!data.video || (!data.video.title && !data.video.thumbnail)) throw new Error('لم تُرجع الصفحة عنوانًا أو صورة للمعاينة.');
      renderMetadata(data.video);
      setAnalysisMessage('ظهرت بيانات الرابط فقط. اختر ملف الفيديو المحفوظ على جهازك لإنتاج Reel.', 'ready');
    } catch (error) {
      const message = error.name === 'AbortError' ? 'انتهت مهلة معاينة الرابط؛ يمكنك متابعة العمل باختيار ملف محلي.' : error.message || 'تعذر فحص الرابط.';
      setAnalysisMessage(message, 'error');
    } finally {
      window.clearTimeout(timeoutId);
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'معاينة';
    }
  });
}

function loadFfmpegScript() {
  if (window.FFmpegWASM?.FFmpeg) return Promise.resolve();
  if (ffmpegLoadPromise) return ffmpegLoadPromise;
  ffmpegLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = FFMPEG_SCRIPT_URL;
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.onload = () => window.FFmpegWASM?.FFmpeg ? resolve() : reject(new Error('تعذر تحميل مكتبة التحويل.'));
    script.onerror = () => reject(new Error('تعذر تحميل مكتبة الفيديو من CDN. تحقق من الاتصال ثم أعد المحاولة.'));
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

function chooseRecorder(stream) {
  if (!window.MediaRecorder) throw new Error('هذا المتصفح لا يدعم التسجيل المحلي. جرّب Chrome أو Edge حديثًا.');
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
  catch { throw new Error('تعذر بدء تسجيل المقطع على هذا المتصفح. حدّث المتصفح أو جرّب Chrome/Edge.'); }
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

async function recordFirstVerticalSegment(file) {
  if (!HTMLCanvasElement.prototype.captureStream) throw new Error('المتصفح لا يدعم التقاط الفيديو المحلي. جرّب Chrome أو Edge حديثًا.');
  const fileUrl = makeObjectUrl(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  video.controls = false;
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
      const timer = window.setTimeout(() => reject(new Error('انتهت مهلة قراءة الفيديو. اختر ملف MP4 أو MOV يمكن للمتصفح تشغيله.')), 30000);
      video.addEventListener('loadedmetadata', () => { window.clearTimeout(timer); resolve(); }, { once: true });
      video.addEventListener('error', () => { window.clearTimeout(timer); reject(new Error('تعذر فتح ترميز هذا الملف في المتصفح. جرّب MP4 أو MOV.')); }, { once: true });
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
    if (!context) throw new Error('تعذر تجهيز مساحة الرسم في المتصفح.');
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
      recorder.addEventListener('error', (event) => finish(reject, event.error || new Error('فشل تسجيل الجزء المحلي من الفيديو.')), { once: true });
      recorder.addEventListener('stop', () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        finish(blob.size ? resolve : reject, blob.size ? blob : new Error('لم ينتج المتصفح بيانات فيديو.'));
      }, { once: true });

      const draw = () => {
        drawVerticalFrame(video, context);
        const ratio = Math.min(1, video.currentTime / duration);
        setProgress(`تسجيل أول ${Math.ceil(duration)} ثانية…`, ratio, `${Math.floor(Math.min(video.currentTime, duration))} / ${Math.ceil(duration)} ثانية · الملف محلي`);
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
      video.play().then(() => { rafId = requestAnimationFrame(draw); }).catch((error) => finish(reject, new Error(`تعذر تشغيل الملف محليًا: ${error.message || 'جرّب MP4.'}`)));
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

async function loadFfmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  setProgress('تحميل محرك MP4 المحلي (حوالي 31MB)…', null, 'هذه الخطوة الأولى فقط؛ لا يُرسل ملف الفيديو إلى CDN.');
  await loadFfmpegScript();
  const ffmpeg = new window.FFmpegWASM.FFmpeg();
  const coreURL = await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, 'text/javascript');
  const wasmURL = await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm');
  await ffmpeg.load({ coreURL, wasmURL });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

async function convertSegmentToMp4(segment) {
  const ffmpeg = await loadFfmpeg();
  const extension = segment.mimeType.includes('mp4') ? 'mp4' : 'webm';
  const stamp = Date.now();
  const inputName = `bilireels-input-${stamp}.${extension}`;
  const outputName = `bilireels-output-${stamp}.mp4`;
  const bytes = new Uint8Array(await segment.blob.arrayBuffer());
  setProgress('تحويل المقطع إلى MP4 عمودي…', null, 'التحويل يعمل على جهازك؛ سرعته تعتمد على الهاتف أو الحاسوب.');
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
    if (code !== 0) throw new Error(`تعذر ترميز MP4 (رمز ${code}). جرّب ملفًا بصيغة MP4 أو MOV.`);
    const data = await ffmpeg.readFile(outputName);
    if (!data || !data.length) throw new Error('اكتمل التحويل دون ملف ناتج. أعد المحاولة بملف فيديو آخر.');
    return new Blob([data], { type: 'video/mp4' });
  } catch (error) {
    const message = String(error?.message || error);
    if (/unknown encoder|encoder.*not found/i.test(message)) throw new Error('محرك المتصفح لا يحتوي مرمّز H.264 لهذا الجهاز؛ لا يوجد رفع للخادم كبديل.');
    throw error;
  } finally {
    try { await ffmpeg.deleteFile(inputName); } catch {}
    try { await ffmpeg.deleteFile(outputName); } catch {}
  }
}

function outputFileName() {
  const base = (metadataTitle || selectedFile?.name?.replace(/\.[^.]+$/, '') || 'BiliReels-Reel')
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72) || 'BiliReels-Reel';
  return `${base}-reel-30s.mp4`;
}

async function processSelectedFile() {
  if (!selectedFile || isProcessing) return;
  isProcessing = true;
  clearOutput();
  setVisible(progressSection, true);
  if (processVideoBtn) {
    processVideoBtn.disabled = true;
    processVideoBtn.textContent = 'جارٍ إنشاء Reel…';
  }
  setProgress('قراءة الملف محليًا…', null);
  try {
    const segment = await recordFirstVerticalSegment(selectedFile);
    const mp4 = await convertSegmentToMp4(segment);
    outputObjectUrl = makeObjectUrl(mp4);
    reelVideo.src = outputObjectUrl;
    reelVideo.load();
    downloadReel.href = outputObjectUrl;
    downloadReel.download = outputFileName();
    resultStatus.textContent = 'MP4 READY';
    resultNote.textContent = `اكتمل الفيديو بصيغة MP4، ${formatDuration(segment.duration)}، 720×1280. الملف لم يُرفع إلى أي خادم.`;
    reelPreviewStatus.textContent = 'المعاينة جاهزة محليًا.';
    setVisible(reelPreviewWrap, true);
    setVisible(resultsSection, true);
    setProgress('اكتمل إنشاء Reel على جهازك.', 1, 'يمكنك معاينة MP4 أو تنزيله الآن.');
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    const message = error?.message || 'تعذرت معالجة هذا الملف على الجهاز.';
    setProgress('تعذرت المعالجة', 0, message);
    if (progressStatusText) progressStatusText.classList.add('error-text');
    if (reelPreviewStatus) reelPreviewStatus.textContent = message;
  } finally {
    isProcessing = false;
    if (processVideoBtn) {
      processVideoBtn.disabled = !selectedFile;
      processVideoBtn.textContent = 'إنشاء Reel على جهازي →';
    }
  }
}

if (processVideoBtn) processVideoBtn.addEventListener('click', processSelectedFile);

window.addEventListener('pagehide', () => {
  for (const url of temporaryObjectUrls) URL.revokeObjectURL(url);
  temporaryObjectUrls.clear();
});
