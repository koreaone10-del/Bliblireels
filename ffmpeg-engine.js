// BiliReels Phase 2 — browser video engine powered by ffmpeg.wasm.
// Loaded lazily so the landing page stays fast until the user actually processes a video.

const FFMPEG_VERSION = '0.12.10';
const CORE_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_VERSION}/dist/umd`;

let ffmpeg = null;
let loaded = false;
let loadingPromise = null;

const ENGINE_EVENTS = new EventTarget();

export function onEngineProgress(callback) {
  const handler = (event) => callback(event.detail);
  ENGINE_EVENTS.addEventListener('progress', handler);
  return () => ENGINE_EVENTS.removeEventListener('progress', handler);
}

function emitProgress(detail) {
  ENGINE_EVENTS.dispatchEvent(new CustomEvent('progress', { detail }));
}

async function loadEngine() {
  if (loaded) return ffmpeg;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js'),
      import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js')
    ]);

    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      ENGINE_EVENTS.dispatchEvent(new CustomEvent('log', { detail: message }));
    });
    ffmpeg.on('progress', ({ progress, time }) => {
      emitProgress({ progress: Math.max(0, Math.min(1, progress)), time });
    });

    // toBlobURL avoids cross-origin issues when the core files are served from the CDN.
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm')
    });

    ffmpeg.__fetchFile = fetchFile;
    loaded = true;
    return ffmpeg;
  })().catch((error) => {
    loadingPromise = null;
    throw error;
  });

  return loadingPromise;
}

function outputSize(quality) {
  if (quality === '480p') return [480, 854];
  if (quality === '1080p') return [1080, 1920];
  return [720, 1280];
}

function bitrate(quality) {
  if (quality === '480p') return '900k';
  if (quality === '1080p') return '5000k';
  return '2800k';
}

function even(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * Process a local video into one or more 9:16 MP4 Reels.
 *
 * Important: this is a real local browser encode. The original file is never uploaded
 * to Netlify by this engine. This makes Phase 2 usable on the current static deployment.
 */
export async function processVideo({ file, duration, quality, smartSplit, onStatus }) {
  if (!(file instanceof File)) throw new Error('No local video file was supplied.');

  const engine = await loadEngine();
  const fetchFile = engine.__fetchFile;
  const [width, height] = outputSize(quality);
  const sourceUrl = URL.createObjectURL(file);

  try {
    onStatus?.({ stage: 'loading', message: 'تم تشغيل محرك الفيديو…' });
    await engine.writeFile('input.mp4', await fetchFile(file));

    // The HTML video element gives us reliable source dimensions before encoding.
    const sourceVideo = document.createElement('video');
    sourceVideo.preload = 'metadata';
    sourceVideo.src = sourceUrl;
    await new Promise((resolve, reject) => {
      sourceVideo.onloadedmetadata = resolve;
      sourceVideo.onerror = () => reject(new Error('تعذر قراءة خصائص الفيديو.'));
    });

    const sourceDuration = Number.isFinite(sourceVideo.duration) ? sourceVideo.duration : 0;
    if (!sourceDuration) throw new Error('تعذر تحديد مدة الفيديو.');

    const cropScale = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    const rate = bitrate(quality);
    const segmentDuration = Math.max(1, Number(duration) || 30);
    const maxSegments = 24;

    onStatus?.({ stage: 'encoding', message: 'جاري تحويل الفيديو إلى 9:16…' });

    // Segment muxing gives us batch output in one FFmpeg pass.
    const args = [
      '-i', 'input.mp4',
      '-vf', cropScale,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', quality === '1080p' ? '20' : quality === '720p' ? '21' : '23',
      '-b:v', rate,
      '-maxrate', rate,
      '-bufsize', quality === '1080p' ? '10M' : '6M',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '48000',
      '-ac', '2',
      '-f', 'segment',
      '-segment_time', String(segmentDuration),
      '-reset_timestamps', '1',
      '-segment_format', 'mp4',
      '-segment_list', 'segments.ffconcat',
      '-segment_list_type', 'ffconcat',
      '-movflags', '+faststart',
      'reel_%03d.mp4'
    ];

    // ffmpeg.wasm progress is reported by encoded media time. We also expose an overall
    // status from the file count after the encode completes.
    emitProgress({ progress: 0.05, time: 0 });
    await engine.exec(args);
    emitProgress({ progress: 1, time: sourceDuration * 1e6 });

    const count = Math.min(maxSegments, Math.max(1, Math.ceil(sourceDuration / segmentDuration)));
    const reels = [];

    for (let i = 0; i < count; i += 1) {
      const name = `reel_${String(i).padStart(3, '0')}.mp4`;
      try {
        const data = await engine.readFile(name);
        const blob = new Blob([data.buffer], { type: 'video/mp4' });
        reels.push({
          index: i + 1,
          filename: `BiliReels_Reel_${String(i + 1).padStart(3, '0')}.mp4`,
          blob,
          url: URL.createObjectURL(blob),
          duration: Math.min(segmentDuration, Math.max(0, sourceDuration - i * segmentDuration)),
          width,
          height,
          quality
        });
        await engine.deleteFile(name);
      } catch {
        // Some encoders can emit fewer files than the estimated duration count.
        break;
      }
    }

    // Smart Split is intentionally represented in the UI at this stage. True semantic
    // scene/subject splitting belongs to the AI analysis phase; this engine performs
    // deterministic duration splitting and preserves the user's setting for that phase.
    if (smartSplit) {
      onStatus?.({ stage: 'smart-ready', message: 'تم تجهيز المقاطع. التحليل الذكي سيأتي في مرحلة AI.' });
    }

    await engine.deleteFile('input.mp4');
    try { await engine.deleteFile('segments.ffconcat'); } catch {}

    return { reels, sourceDuration, width, height };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export function isEngineLoaded() {
  return loaded;
}
