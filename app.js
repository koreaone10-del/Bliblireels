import { processVideo, onEngineProgress } from './ffmpeg-engine.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  source: null,
  file: null,
  objectUrl: null,
  duration: 30,
  quality: '720p',
  smartSplit: true,
  subtitles: true,
  language: 'ar',
  logoUrl: null
};

const toast = (message) => {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => el.classList.remove('show'), 2400);
};

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B','KB','MB','GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
};

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
};

function updateSummary() {
  const subtitle = state.subtitles ? 'Subtitles ON' : 'Subtitles OFF';
  $('#processSummary').textContent = `${state.file ? '1 فيديو' : 'مصدر واحد'} · ${state.duration}s · ${state.quality} · 9:16 · ${subtitle}`;
}

function showWorkspace() {
  $('#workspace').classList.remove('hidden');
  $('#workspace').scrollIntoView({behavior:'smooth', block:'start'});
  updateSummary();
}

function loadVideo(file) {
  if (!file || !file.type.startsWith('video/')) {
    toast('اختر ملف فيديو صالحاً.');
    return;
  }
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.file = file;
  state.source = 'upload';
  state.objectUrl = URL.createObjectURL(file);

  const video = $('#videoPreview');
  video.src = state.objectUrl;
  $('#fileName').textContent = file.name;
  $('#fileSize').textContent = formatBytes(file.size);
  $('#localPreview').classList.remove('hidden');
  $('#sourceStatus').textContent = '● LOADED';
  $('#sourceStatus').className = 'status ready';
  $('#logoOverlay').classList.add('hidden');

  video.onloadedmetadata = () => {
    $('#fileDuration').textContent = formatTime(video.duration);
    toast('تم تحميل الفيديو بنجاح.');
    showWorkspace();
  };
}

$('#videoInput').addEventListener('change', (e) => loadVideo(e.target.files[0]));

const dropzone = $('#dropzone');
['dragenter','dragover'].forEach(type => dropzone.addEventListener(type, e => {
  e.preventDefault();
  dropzone.classList.add('dragover');
}));
['dragleave','drop'].forEach(type => dropzone.addEventListener(type, e => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
}));
dropzone.addEventListener('drop', e => loadVideo(e.dataTransfer.files[0]));

$('#changeVideo').addEventListener('click', () => $('#videoInput').click());

$$('.source-tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.source-tab').forEach(x => x.classList.remove('active'));
  $$('.source-view').forEach(x => x.classList.remove('active'));
  tab.classList.add('active');
  $(`#${tab.dataset.source === 'upload' ? 'uploadSource' : 'urlSource'}`).classList.add('active');
}));

$('#analyzeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('#videoUrl').value.trim();
  if (!url) return toast('ألصق الرابط أولاً.');
  try { new URL(url); } catch { return toast('الرابط غير صالح.'); }
  state.source = 'url';
  state.file = null;
  $('#sourceStatus').textContent = '● ANALYZED';
  $('#sourceStatus').className = 'status ready';
  $('#fileName').textContent = 'Remote source';
  $('#fileSize').textContent = '—';
  $('#fileDuration').textContent = 'سيتم تحديدها من الـAPI';
  $('#localPreview').classList.remove('hidden');
  $('#videoPreview').removeAttribute('src');
  $('#videoPreview').load();
  toast('تم تجهيز المصدر للمرحلة التالية.');
  showWorkspace();
});

$$('.options').forEach(group => group.addEventListener('click', (e) => {
  const btn = e.target.closest('.option');
  if (!btn) return;
  group.querySelectorAll('.option').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  if (group.dataset.group === 'quality') state.quality = btn.dataset.value;
  updateSummary();
}));

$$('.split-options').forEach(group => group.addEventListener('click', (e) => {
  const btn = e.target.closest('.option');
  if (!btn) return;
  group.querySelectorAll('.option').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  const custom = btn.dataset.value === 'custom';
  $('#customDurationWrap').classList.toggle('hidden', !custom);
  state.duration = custom ? Number($('#customDuration').value) || 45 : Number(btn.dataset.value);
  updateSummary();
}));

$('#customDuration').addEventListener('input', (e) => {
  state.duration = Math.max(10, Math.min(600, Number(e.target.value) || 10));
  updateSummary();
});

$('#subtitleToggle').addEventListener('change', e => {
  state.subtitles = e.target.checked;
  $('#subtitleOverlay').classList.toggle('hidden', !state.subtitles);
  updateSummary();
});

$('#language').addEventListener('change', e => {
  state.language = e.target.value;
  toast(`لغة الترجمة: ${e.target.options[e.target.selectedIndex].text}`);
});

$('#smartSplit').addEventListener('change', e => {
  state.smartSplit = e.target.checked;
});

$('#logoInput').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (state.logoUrl) URL.revokeObjectURL(state.logoUrl);
  state.logoUrl = URL.createObjectURL(file);
  $('#logoOverlay').src = state.logoUrl;
  $('#logoOverlay').classList.remove('hidden');
  $('#logoLabel').textContent = `✓ ${file.name}`;
  toast('تمت إضافة الشعار للـPreview.');
});

function updateLogo() {
  const size = Number($('#logoSize').value);
  const opacity = Number($('#logoOpacity').value);
  $('#logoSizeValue').textContent = `${size}%`;
  $('#logoOpacityValue').textContent = `${opacity}%`;
  $('#logoOverlay').style.width = `${Math.max(42, size * 1.8)}px`;
  $('#logoOverlay').style.opacity = opacity / 100;
}
$('#logoSize').addEventListener('input', updateLogo);
$('#logoOpacity').addEventListener('input', updateLogo);
updateLogo();

const activeDownloads = [];

function renderReels(reels) {
  const list = $('#reelsList');
  list.innerHTML = '';
  activeDownloads.length = 0;

  reels.forEach((reel) => {
    const item = document.createElement('article');
    item.className = 'reel';
    item.innerHTML = `
      <div>
        <strong>${reel.filename}</strong>
        <small>9:16 · ${Math.round(reel.duration)}s · ${reel.quality} · ${reel.width}×${reel.height}</small>
      </div>
      <div class="reel-actions">
        <a class="secondary small" href="${reel.url}" download="${reel.filename}">تحميل</a>
        <a class="secondary small" href="${reel.url}" target="_blank" rel="noopener">معاينة</a>
      </div>`;
    list.appendChild(item);
    activeDownloads.push(reel);
  });
}

function updateProcessingProgress(progress) {
  const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
  $('#progressBar').style.width = `${percent}%`;
  $('#progressText').textContent = `${percent}%`;
}

onEngineProgress(({ progress }) => updateProcessingProgress(progress));

$('#processBtn').addEventListener('click', async () => {
  if (!state.file) {
    toast('المعالجة الحقيقية في هذه المرحلة تحتاج فيديو محلياً.');
    return;
  }

  const result = $('#result');
  const bar = $('#progressBar');
  const text = $('#progressText');
  result.classList.remove('hidden');
  result.scrollIntoView({behavior:'smooth', block:'start'});
  bar.style.width = '0%';
  text.textContent = '0%';
  $('#reelsList').innerHTML = '';
  $('#resultStatus').textContent = '● LOADING ENGINE';
  $('#resultStatus').className = 'status busy';
  $('#resultNote').textContent = 'يتم تشغيل FFmpeg داخل المتصفح. الفيديو لا يُرفع إلى Netlify أثناء هذه العملية.';

  const button = $('#processBtn');
  button.disabled = true;
  button.classList.add('processing');

  try {
    const output = await processVideo({
      file: state.file,
      duration: state.duration,
      quality: state.quality,
      smartSplit: state.smartSplit,
      onStatus: ({ stage, message }) => {
        $('#resultStatus').textContent = stage === 'encoding' ? '● ENCODING' : '● ' + stage.toUpperCase();
        if (message) $('#resultNote').textContent = message;
      }
    });

    if (!output.reels.length) throw new Error('لم ينتج محرك الفيديو أي مقطع.');

    renderReels(output.reels);
    updateProcessingProgress(1);
    $('#resultStatus').textContent = '✓ COMPLETE';
    $('#resultStatus').className = 'status ready';
    $('#resultNote').textContent = `تم إنشاء ${output.reels.length} Reel حقيقية بصيغة MP4 (${output.width}×${output.height}). يمكنك تحميل كل مقطع مباشرة.`;
    toast(`تم إنشاء ${output.reels.length} Reels بنجاح.`);
  } catch (error) {
    console.error(error);
    $('#resultStatus').textContent = '× ERROR';
    $('#resultStatus').className = 'status error';
    $('#resultNote').textContent = `تعذر إكمال المعالجة: ${error?.message || 'خطأ غير معروف'}`;
    toast('حدث خطأ أثناء معالجة الفيديو.');
  } finally {
    button.disabled = false;
    button.classList.remove('processing');
  }
});

$('#downloadAll').addEventListener('click', async () => {
  if (!activeDownloads.length) return toast('لا توجد Reels جاهزة للتحميل.');

  // ZIP packaging is intentionally deferred until the Storage/Backend phase.
  // For now each generated MP4 has its own download link, avoiding another heavy
  // client-side dependency on mobile devices.
  activeDownloads.forEach((reel, index) => {
    setTimeout(() => {
      const link = document.createElement('a');
      link.href = reel.url;
      link.download = reel.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }, index * 180);
  });
  toast(`بدأ تحميل ${activeDownloads.length} ملفات.`);
});

$('#themeBtn').addEventListener('click', () => {
  document.body.classList.toggle('light');
  localStorage.setItem('bilireels-theme', document.body.classList.contains('light') ? 'light' : 'dark');
});
if (localStorage.getItem('bilireels-theme') === 'light') document.body.classList.add('light');
