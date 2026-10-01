const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const API = {
  analyze: '/api/analyze',
  process: '/api/process'
};

const state = {
  sourceUrl: '',
  source: null,
  quality: '720p',
  duration: 30,
  smart: true,
  subs: true,
  subLang: 'ar',
  job: null,
  pollTimer: null,
  pollStartedAt: 0
};

function toast(message) {
  const el = $('#toast');
  if (!el) return;

  el.textContent = message;
  el.classList.add('show');

  clearTimeout(window.__brToastTimer);
  window.__brToastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 3200);
}

function setStatus(element, text, type = 'ready') {
  if (!element) return;
  element.textContent = text;
  element.className = `status ${type}`;
}

function formatDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '—';

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/*
 * Supported BiliBili domains:
 * - bilibili.com
 * - *.bilibili.com
 * - bilibili.tv
 * - *.bilibili.tv
 * - b23.tv
 * - bili.im
 */
function isBiliBiliUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();

    return (
      host === 'b23.tv' ||
      host === 'bili.im' ||
      host === 'bilibili.com' ||
      host.endsWith('.bilibili.com') ||
      host === 'bilibili.tv' ||
      host.endsWith('.bilibili.tv')
    );
  } catch {
    return false;
  }
}

function getErrorMessage(data, fallback) {
  if (data && typeof data.error === 'string' && data.error.trim()) {
    return data.error;
  }

  if (data && typeof data.message === 'string' && data.message.trim()) {
    return data.message;
  }

  return fallback;
}

function setProgress(percent, message) {
  const value = Math.max(
    0,
    Math.min(100, Math.round(Number(percent) || 0))
  );

  const bar = $('#progressBar');
  const text = $('#progressText');
  const note = $('#resultNote');

  if (bar) bar.style.width = `${value}%`;
  if (text) text.textContent = `${value}%`;
  if (note && message) note.textContent = message;
}

function updateSummary() {
  const summary = $('#processSummary');
  if (!summary) return;

  const parts = [
    state.duration ? `${state.duration}s` : '30s',
    state.quality || '720p',
    '9:16'
  ];

  if (state.smart) parts.push('Smart Split');
  if (state.subs) {
    parts.push(`Subtitles: ${state.subLang.toUpperCase()}`);
  }

  summary.textContent = parts.join(' · ');
}

function resetResults() {
  clearInterval(state.pollTimer);

  state.pollTimer = null;
  state.job = null;
  state.pollStartedAt = 0;

  const result = $('#result');
  const reelsList = $('#reelsList');
  const downloadAll = $('#downloadAll');
  const resultStatus = $('#resultStatus');

  if (result) result.classList.add('hidden');

  if (reelsList) {
    reelsList.innerHTML = '';
  }

  if (downloadAll) {
    downloadAll.disabled = true;
    downloadAll.onclick = null;
  }

  setStatus(resultStatus, 'READY', 'ready');
  setProgress(0, 'جاهز للمعالجة.');
}

function renderSource(data) {
  const preview = $('#remotePreview');
  const thumbnail = $('#videoThumbnail');
  const title = $('#videoTitle');
  const author = $('#videoAuthor');
  const duration = $('#videoDuration');

  if (thumbnail) {
    if (data.thumbnail) {
      thumbnail.src = data.thumbnail;
      thumbnail.style.display = '';
    } else {
      thumbnail.removeAttribute('src');
      thumbnail.style.display = 'none';
    }
  }

  if (title) {
    title.textContent = data.title || 'BiliBili Video';
  }

  if (author) {
    author.textContent = data.author ? `@${data.author}` : '—';
  }

  if (duration) {
    duration.textContent = formatDuration(data.duration);
  }

  if (preview) {
    preview.classList.remove('hidden');
  }
}

function renderResults(data) {
  const reelsList = $('#reelsList');
  const downloadAll = $('#downloadAll');

  const reels = Array.isArray(data.reels)
    ? data.reels
    : [];

  if (!reelsList) return;

  reelsList.innerHTML = reels.map((reel, index) => {
    const filename =
      reel.filename ||
      `BiliReels_Reel_${String(index + 1).padStart(3, '0')}.mp4`;

    const url = reel.url || '';
    const quality = reel.quality || state.quality;

    if (!url) {
      return `
        <div class="reel">
          <strong>${filename}</strong>
          <small>${quality} · 9:16</small>
          <span>الرابط غير متاح بعد</span>
        </div>
      `;
    }

    return `
      <a
        class="reel"
        href="${url}"
        target="_blank"
        rel="noopener noreferrer"
      >
        <strong>${filename}</strong>
        <small>${quality} · 9:16</small>
        <span>↧</span>
      </a>
    `;
  }).join('');

  if (!downloadAll) return;

  if (data.zipUrl) {
    downloadAll.disabled = false;

    downloadAll.onclick = () => {
      window.location.href = data.zipUrl;
    };
  } else {
    downloadAll.disabled = true;
    downloadAll.onclick = null;
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        data,
        `Request failed (${response.status})`
      )
    );
  }

  return data;
}

async function analyzeSource(url) {
  const analyzeBtn = $('#analyzeBtn');
  const sourceStatus = $('#sourceStatus');

  if (!isBiliBiliUrl(url)) {
    toast('ألصق رابط BiliBili صحيح فقط.');
    return;
  }

  if (analyzeBtn) {
    analyzeBtn.disabled = true;
  }

  setStatus(
    sourceStatus,
    '● ANALYZING',
    'busy'
  );

  try {
    resetResults();

    const data = await requestJson(
      `${API.analyze}?url=${encodeURIComponent(url)}`
    );

    state.sourceUrl = url;
    state.source = data;

    renderSource(data);

    const workspace = $('#workspace');

    if (workspace) {
      workspace.classList.remove('hidden');
    }

    setStatus(
      sourceStatus,
      '● READY',
      'ready'
    );

    updateSummary();

    toast('تم تحليل مصدر BiliBili بنجاح.');
  } catch (error) {
    state.sourceUrl = '';
    state.source = null;

    setStatus(
      sourceStatus,
      '● ERROR',
      'error'
    );

    toast(
      error.message ||
      'تعذر تحليل الرابط.'
    );
  } finally {
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
    }
  }
}

function setupOptionGroups() {
  $$('.options, .split-options').forEach((group) => {
    group.addEventListener('click', (event) => {
      const button =
        event.target.closest('.option');

      if (!button || !group.contains(button)) {
        return;
      }

      group
        .querySelectorAll('.option')
        .forEach((item) => {
          item.classList.remove('active');
        });

      button.classList.add('active');

      if (group.dataset.group === 'quality') {
        state.quality =
          button.dataset.value || '720p';
      } else {
        const value =
          button.dataset.value || '30';

        const custom = value === 'custom';
        const customWrap =
          $('#customDurationWrap');

        if (customWrap) {
          customWrap.classList.toggle(
            'hidden',
            !custom
          );
        }

        if (!custom) {
          state.duration = Math.max(
            10,
            Math.min(
              600,
              Number(value) || 30
            )
          );
        }
      }

      updateSummary();
    });
  });
}

function setupControls() {
  const themeBtn = $('#themeBtn');

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      document.body.classList.toggle('light');
    });
  }

  const language = $('#language');

  if (language) {
    language.addEventListener(
      'change',
      (event) => {
        state.subLang =
          event.target.value || 'ar';

        updateSummary();
      }
    );
  }

  const subtitleToggle =
    $('#subtitleToggle');

  if (subtitleToggle) {
    state.subs =
      subtitleToggle.checked;

    subtitleToggle.addEventListener(
      'change',
      (event) => {
        state.subs =
          event.target.checked;

        updateSummary();
      }
    );
  }

  const smartSplit =
    $('#smartSplit');

  if (smartSplit) {
    state.smart =
      smartSplit.checked;

    smartSplit.addEventListener(
      'change',
      (event) => {
        state.smart =
          event.target.checked;

        updateSummary();
      }
    );
  }

  const customDuration =
    $('#customDuration');

  if (customDuration) {
    customDuration.addEventListener(
      'input',
      (event) => {
        const value =
          Number(event.target.value) || 10;

        state.duration = Math.max(
          10,
          Math.min(600, value)
        );

        updateSummary();
      }
    );
  }
}

function setupAnalyzeForm() {
  const form = $('#analyzeForm');
  const input = $('#videoUrl');

  if (!form || !input) return;

  form.addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();

      await analyzeSource(
        input.value.trim()
      );
    }
  );
}

function showResult() {
  const result = $('#result');

  if (!result) return;

  result.classList.remove('hidden');

  result.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

function stopPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function finishProcessError(message) {
  stopPolling();

  setStatus(
    $('#resultStatus'),
    '● ERROR',
    'error'
  );

  setProgress(
    0,
    message || 'فشلت المعالجة.'
  );

  const processBtn =
    $('#processBtn');

  if (processBtn) {
    processBtn.disabled = false;
  }

  toast(
    message ||
    'فشلت المعالجة.'
  );
}

async function checkJob(jobId) {
  try {
    const data =
      await requestJson(
        `${API.process}?jobId=${encodeURIComponent(jobId)}`
      );

    const progress =
      Number(data.progress);

    setProgress(
      Number.isFinite(progress)
        ? progress * 100
        : 0,
      data.message || ''
    );

    if (data.status === 'completed') {
      stopPolling();

      setStatus(
        $('#resultStatus'),
        '✓ COMPLETE',
        'ready'
      );

      renderResults(data);

      const processBtn =
        $('#processBtn');

      if (processBtn) {
        processBtn.disabled = false;
      }

      if (!data.reels?.length) {
        toast(
          'اكتملت المعالجة لكن لم يتم إرجاع ملفات Reels.'
        );
      } else if (
        !data.reels.some(
          (item) => item.url
        ) &&
        !data.zipUrl
      ) {
        setProgress(
          100,
          'تم إنشاء الـReels، لكن روابط الملفات غير متاحة. اضبط PUBLIC_BASE_URL في محرك الفيديو.'
        );

        toast(
          'تمت المعالجة، لكن روابط النتائج غير متاحة حالياً.'
        );
      } else {
        toast(
          'تم إنشاء Reels بنجاح.'
        );
      }

      return;
    }

    if (data.status === 'failed') {
      finishProcessError(
        data.error ||
        data.message ||
        'فشلت المعالجة.'
      );
    }
  } catch (error) {
    finishProcessError(
      error.message ||
      'تعذر قراءة حالة المعالجة.'
    );
  }
}

function startPolling(jobId) {
  stopPolling();

  state.pollStartedAt =
    Date.now();

  checkJob(jobId);

  state.pollTimer =
    setInterval(() => {
      if (
        Date.now() -
        state.pollStartedAt >
        45 * 60 * 1000
      ) {
        finishProcessError(
          'انتهت مهلة انتظار محرك الفيديو.'
        );

        return;
      }

      checkJob(jobId);
    }, 2000);
}

async function createProcessJob() {
  const processBtn =
    $('#processBtn');

  if (
    !state.source ||
    !state.sourceUrl
  ) {
    toast(
      'حلّل رابط BiliBili أولاً.'
    );

    return;
  }

  showResult();

  setStatus(
    $('#resultStatus'),
    '● STARTING',
    'busy'
  );

  setProgress(
    0,
    'جاري إرسال الطلب إلى محرك الفيديو…'
  );

  if (processBtn) {
    processBtn.disabled = true;
  }

  const payload = {
    sourceUrl: state.sourceUrl,

    bvid:
      state.source.bvid ||
      state.source.id ||
      null,

    quality: state.quality,

    split: {
      mode: state.smart
        ? 'smart'
        : 'fixed',

      duration:
        state.duration
    },

    subtitles: {
      enabled: state.subs,
      language: state.subLang
    },

    output: {
      aspect: '9:16',
      format: 'mp4'
    }
  };

  try {
    const data =
      await requestJson(
        API.process,
        {
          method: 'POST',

          headers: {
            'content-type':
              'application/json'
          },

          body:
            JSON.stringify(payload)
        }
      );

    if (!data.jobId) {
      throw new Error(
        'محرك الفيديو لم يُرجع jobId.'
      );
    }

    state.job =
      data.jobId;

    setStatus(
      $('#resultStatus'),
      '● PROCESSING',
      'busy'
    );

    setProgress(
      0,
      data.message ||
      'تم إنشاء مهمة المعالجة.'
    );

    startPolling(
      data.jobId
    );
  } catch (error) {
    finishProcessError(
      error.message ||
      'تعذر بدء المعالجة.'
    );
  }
}

function setupProcessButton() {
  const processBtn =
    $('#processBtn');

  if (!processBtn) return;

  processBtn.addEventListener(
    'click',
    createProcessJob
  );
}

function initialize() {
  setupAnalyzeForm();
  setupOptionGroups();
  setupControls();
  setupProcessButton();
  updateSummary();
}

initialize();
