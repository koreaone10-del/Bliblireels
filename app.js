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

$('#processBtn').addEventListener('click', async () => {
  if (!state.file && state.source !== 'url') {
    toast('ارفع فيديو أو أدخل مصدراً أولاً.');
    return;
  }

  const result = $('#result');
  const bar = $('#progressBar');
  const text = $('#progressText');
  const list = $('#reelsList');
  result.classList.remove('hidden');
  result.scrollIntoView({behavior:'smooth', block:'start'});
  list.innerHTML = '';
  $('#resultStatus').textContent = '● PROCESSING';
  $('#resultStatus').className = 'status busy';

  for (let p = 0; p <= 100; p += 10) {
    await new Promise(r => setTimeout(r, 90));
    bar.style.width = `${p}%`;
    text.textContent = `${p}%`;
  }

  const sourceDuration = state.file ? ($('#videoPreview').duration || 0) : 0;
  const count = sourceDuration > 0 ? Math.max(1, Math.ceil(sourceDuration / state.duration)) : 4;
  const safeCount = Math.min(count, 24);

  for (let i = 1; i <= safeCount; i++) {
    const item = document.createElement('div');
    item.className = 'reel';
    item.innerHTML = `<strong>BiliReels_Reel_${String(i).padStart(3,'0')}.mp4</strong><small>9:16 · ${state.duration}s · ${state.quality} · READY</small>`;
    list.appendChild(item);
  }

  $('#resultStatus').textContent = '✓ COMPLETE';
  $('#resultStatus').className = 'status ready';
  $('#resultNote').textContent = `تم إنشاء ${safeCount} عناصر معاينة. هذه مازالت واجهة Frontend؛ التصدير الحقيقي سيأتي مع FFmpeg Worker.`;
  toast('اكتملت معاينة عملية الإنشاء.');
});

$('#downloadAll').addEventListener('click', () => {
  toast('زر ZIP جاهز للربط مع Storage في مرحلة Backend.');
});

$('#themeBtn').addEventListener('click', () => {
  document.body.classList.toggle('light');
  localStorage.setItem('bilireels-theme', document.body.classList.contains('light') ? 'light' : 'dark');
});
if (localStorage.getItem('bilireels-theme') === 'light') document.body.classList.add('light');
