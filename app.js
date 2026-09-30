const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const API_BASE =
  (document.querySelector('meta[name="bilireels-api"]')?.content || '')
    .replace(/\/$/, '');

const API = API_BASE || '';

const state = {
  sourceUrl: '',
  source: null,
  quality: '720p',
  duration: 30,
  smartSplit: true,
  subtitles: true,
  language: 'ar',
  jobId: null,
  reels: [],
  zipUrl: null,
  polling: null
};


function toast(message) {
  const el = $('#toast');

  if (!el) return;

  el.textContent = message;
  el.classList.add('show');

  clearTimeout(window.__toastTimer);

  window.__toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 3500);
}


function formatDuration(seconds) {

  const value = Number(seconds || 0);

  if (!value) return '—';

  const minutes = Math.floor(value / 60);
  const secs = Math.floor(value % 60);

  return `${minutes}:${String(secs).padStart(2, '0')}`;
}


function setBusy(button, busy, text) {

  if (!button) return;

  button.disabled = busy;

  if (busy) {
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = text || 'جاري العمل…';
  } else if (button.dataset.originalText) {
    button.innerHTML = button.dataset.originalText;
  }
}


function show(el) {
  el?.classList.remove('hidden');
}


function hide(el) {
  el?.classList.add('hidden');
}


async function apiFetch(url, options = {}) {

  const response = await fetch(`${API}${url}`, {
    ...options,
    headers: {
      ...(options.body
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `Request failed (${response.status})`
    );
  }

  return data;
}


/* ----------------------------------
   THEME
----------------------------------- */

$('#themeBtn')?.addEventListener('click', () => {
  document.documentElement.classList.toggle('light-mode');
});


/* ----------------------------------
   QUALITY
----------------------------------- */

$$('[data-group="quality"] .option').forEach(button => {

  button.addEventListener('click', () => {

    $$('[data-group="quality"] .option')
      .forEach(item => item.classList.remove('active'));

    button.classList.add('active');

    state.quality = button.dataset.value;

    updateSummary();
  });

});


/* ----------------------------------
   SPLIT
----------------------------------- */

$$('[data-group="split"] .option').forEach(button => {

  button.addEventListener('click', () => {

    $$('[data-group="split"] .option')
      .forEach(item => item.classList.remove('active'));

    button.classList.add('active');

    const value = button.dataset.value;

    if (value === 'custom') {

      show($('#customDurationWrap'));

      state.duration =
        Number($('#customDuration')?.value || 45);

    } else {

      hide($('#customDurationWrap'));

      state.duration = Number(value);

    }

    updateSummary();
  });

});


$('#customDuration')?.addEventListener('input', event => {

  const value = Math.max(
    10,
    Math.min(600, Number(event.target.value || 45))
  );

  state.duration = value;

  updateSummary();
});


/* ----------------------------------
   OPTIONS
----------------------------------- */

$('#subtitleToggle')?.addEventListener('change', event => {
  state.subtitles = event.target.checked;
});


$('#language')?.addEventListener('change', event => {
  state.language = event.target.value;
});


$('#smartSplit')?.addEventListener('change', event => {
  state.smartSplit = event.target.checked;
});


function updateSummary() {

  const summary = $('#processSummary');

  if (!summary) return;

  summary.textContent =
    `1 · ${state.duration}s · ${state.quality} · 9:16`;
}


/* ----------------------------------
   ANALYZE
----------------------------------- */

$('#analyzeForm')?.addEventListener('submit', async event => {

  event.preventDefault();

  const input = $('#videoUrl');
  const button = $('#analyzeBtn');

  const url = input?.value.trim();

  if (!url) {
    toast('ألصق رابط BiliBili أولاً.');
    input?.focus();
    return;
  }


  try {

    const parsed = new URL(url);

    const hostname = parsed.hostname.toLowerCase();

    const valid =
      hostname === 'b23.tv' ||
      hostname.endsWith('bilibili.com');

    if (!valid) {
      throw new Error('الرابط يجب أن يكون من BiliBili.');
    }

  } catch {

    toast('رابط BiliBili غير صالح.');
    return;
  }


  state.sourceUrl = url;

  setBusy(button, true, 'جاري التحليل…');

  $('#sourceStatus').textContent = '● ANALYZING';


  try {

    const data = await apiFetch(
      `/api/analyze?url=${encodeURIComponent(url)}`
    );

    if (data.error) {
      throw new Error(data.error);
    }

    state.source = data;

    renderSource(data);

    show($('#workspace'));

    $('#sourceStatus').textContent = '● READY';

    $('#workspaceState').textContent = 'SOURCE READY';

    toast('تم تحليل الفيديو بنجاح.');

    $('#workspace')
      ?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });

  } catch (error) {

    $('#sourceStatus').textContent = '● ERROR';

    toast(error.message || 'تعذر تحليل الرابط.');

  } finally {

    setBusy(button, false);

  }

});


/* ----------------------------------
   SOURCE CARD
----------------------------------- */

function renderSource(data) {

  const preview = $('#remotePreview');

  show(preview);

  const title =
    data.title ||
    'BiliBili Video';

  const author =
    data.author ||
    '—';

  const duration =
    formatDuration(data.duration);

  $('#videoTitle').textContent = title;
  $('#videoAuthor').textContent = author;
  $('#videoDuration').textContent = duration;


  const image = $('#videoThumbnail');

  if (image) {

    if (data.thumbnail) {

      image.src = data.thumbnail;
      image.style.display = 'block';

    } else {

      image.removeAttribute('src');
      image.style.display = 'none';

    }

  }
}


/* ----------------------------------
   PROCESS
----------------------------------- */

$('#processBtn')?.addEventListener('click', async () => {

  if (!state.sourceUrl) {
    toast('حلل رابط الفيديو أولاً.');
    return;
  }


  const button = $('#processBtn');

  setBusy(button, true, 'جاري إنشاء Reels…');

  show($('#result'));

  $('#resultStatus').textContent = 'PROCESSING';

  $('#resultNote').textContent =
    'جاري إرسال المهمة إلى محرك الفيديو…';

  setProgress(0);

  $('#reelsList').innerHTML = '';

  $('#downloadAll').disabled = true;


  try {

    const data = await apiFetch('/api/process', {

      method: 'POST',

      body: JSON.stringify({

        sourceUrl: state.sourceUrl,

        quality: state.quality,

        split: {
          duration: state.duration
        },

        smartSplit: state.smartSplit,

        subtitles: state.subtitles,

        language: state.language

      })

    });


    state.jobId = data.jobId;

    if (!state.jobId) {
      throw new Error('لم يتم إنشاء Job.');
    }


    await pollJob();

  } catch (error) {

    $('#resultStatus').textContent = 'ERROR';

    $('#resultNote').textContent =
      error.message || 'حدث خطأ أثناء المعالجة.';

    toast(error.message || 'حدث خطأ.');

  } finally {

    setBusy(button, false);

  }

});


/* ----------------------------------
   JOB POLLING
----------------------------------- */

async function pollJob() {

  clearInterval(state.polling);

  const check = async () => {

    if (!state.jobId) return;

    try {

      const data = await apiFetch(
        `/api/process?jobId=${encodeURIComponent(state.jobId)}`
      );


      const progress =
        Number(data.progress || 0);

      setProgress(progress);


      $('#resultNote').textContent =
        data.message ||
        'جاري المعالجة…';


      if (data.status === 'completed') {

        clearInterval(state.polling);

        state.reels = data.reels || [];
        state.zipUrl = data.zipUrl || null;

        renderResults();

        $('#resultStatus').textContent =
          'COMPLETED';

        $('#resultNote').textContent =
          data.message || 'اكتملت المعالجة.';

        $('#downloadAll').disabled =
          !state.zipUrl;

        toast('اكتملت معالجة Reels.');

        return;
      }


      if (data.status === 'failed') {

        clearInterval(state.polling);

        throw new Error(
          data.error ||
          data.message ||
          'فشلت المعالجة.'
        );
      }

    } catch (error) {

      clearInterval(state.polling);

      $('#resultStatus').textContent = 'ERROR';

      $('#resultNote').textContent =
        error.message || 'حدث خطأ.';

      toast(error.message || 'حدث خطأ.');

    }

  };


  await check();

  if (state.jobId) {

    state.polling =
      setInterval(check, 2500);

  }

}


/* ----------------------------------
   PROGRESS
----------------------------------- */

function setProgress(value) {

  const normalized =
    Math.max(0, Math.min(1, Number(value) || 0));

  const percent =
    Math.round(normalized * 100);

  const bar = $('#progressBar');

  if (bar) {
    bar.style.width = `${percent}%`;
  }

  const text = $('#progressText');

  if (text) {
    text.textContent = `${percent}%`;
  }
}


/* ----------------------------------
   RESULTS
----------------------------------- */

function renderResults() {

  const list = $('#reelsList');

  if (!list) return;

  list.innerHTML = '';


  if (!state.reels.length) {

    list.innerHTML = `
      <div class="hint">
        لم يتم إنشاء ملفات بعد.
      </div>
    `;

    return;
  }


  state.reels.forEach((reel, index) => {

    const item = document.createElement('div');

    item.className = 'reel-item';


    const number =
      String(index + 1).padStart(2, '0');


    const duration =
      formatDuration(reel.duration);


    item.innerHTML = `

      <div class="reel-info">

        <strong>
          Reel ${number}
        </strong>

        <small>
          ${reel.quality || state.quality}
          ·
          ${duration}
          ·
          9:16
        </small>

      </div>

      ${
        reel.url
          ? `
            <a
              class="secondary compact"
              href="${reel.url}"
              download
            >
              تحميل
            </a>
          `
          : `
            <span class="hint">
              الرابط غير متاح
            </span>
          `
      }

    `;


    list.appendChild(item);

  });

}


/* ----------------------------------
   DOWNLOAD ALL
----------------------------------- */

$('#downloadAll')?.addEventListener('click', () => {

  if (!state.zipUrl) {
    toast('ملف ZIP غير جاهز.');
    return;
  }

  window.open(
    state.zipUrl,
    '_blank',
    'noopener,noreferrer'
  );

});


/* ----------------------------------
   INIT
----------------------------------- */

updateSummary();

console.log(
  'BiliReels URL-only frontend initialized.'
);
