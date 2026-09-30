import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';

const app = express();
const PORT = Number(process.env.PORT || 8080);
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const ALLOWED = (process.env.ALLOWED_DOMAINS || 'bilibili.com,www.bilibili.com,b23.tv').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

app.use(cors({ origin: true, methods: ['GET', 'OPTIONS'] }));
app.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }));

function validUrl(raw) {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    if (!ALLOWED.some(d => host === d || host.endsWith(`.${d}`))) return null;
    return u;
  } catch { return null; }
}

function run(args, timeout = 55_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('yt-dlp timeout')); }, timeout);
    child.stdout.on('data', d => { out += d.toString(); if (out.length > 2_000_000) { child.kill('SIGKILL'); reject(new Error('yt-dlp output too large')); } });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve({out,err}); else reject(new Error(err.trim().slice(-1500) || `yt-dlp exited with ${code}`)); });
  });
}

app.get('/health', (_req,res) => res.json({ ok:true, service:'BiliReels Video API', ytdlp:YTDLP }));

app.get('/resolve', async (req,res) => {
  const u = validUrl(req.query.url);
  if (!u) return res.status(400).json({ok:false,error:'Unsupported or invalid URL. Only configured public video domains are accepted.'});
  try {
    const {out} = await run(['--dump-single-json','--no-warnings','--no-playlist','--skip-download',u.toString()], 45_000);
    const info = JSON.parse(out.trim().split('\n').pop());
    res.json({ ok:true, title:info.title || 'Video', duration:Number(info.duration || 0), thumbnail:info.thumbnail || null, uploader:info.uploader || info.channel || null, filename:(info.title || 'BiliReels').replace(/[^a-z0-9._-]+/gi,'_').slice(0,100)+'.mp4' });
  } catch (e) { res.status(502).json({ok:false,error:e.message}); }
});

app.get('/stream', async (req,res) => {
  const u = validUrl(req.query.url);
  if (!u) return res.status(400).json({ok:false,error:'Unsupported or invalid URL.'});
  try {
    // Prefer a single-file MP4 so the browser can fetch one stream and ffmpeg.wasm
    // can process it locally. If unavailable, fall back to best available format.
    const {out} = await run(['--get-url','--no-warnings','--no-playlist','-f','best[ext=mp4]/best',u.toString()], 45_000);
    const direct = out.trim().split(/\r?\n/).filter(Boolean)[0];
    if (!direct) throw new Error('No playable stream URL was returned.');
    const upstream = await fetch(direct, { headers:{ 'User-Agent':'Mozilla/5.0', Referer:u.origin + '/' }, signal:AbortSignal.timeout(30_000) });
    if (!upstream.ok || !upstream.body) throw new Error(`Source stream returned HTTP ${upstream.status}`);
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
    const len=upstream.headers.get('content-length'); if(len)res.setHeader('Content-Length',len);
    res.setHeader('Cache-Control','no-store');
    // Web Streams -> Node stream bridge.
    const nodeStream = PassThrough.fromWeb(upstream.body);
    nodeStream.on('error',()=>res.destroy());
    nodeStream.pipe(res);
  } catch (e) { if(!res.headersSent) res.status(502).json({ok:false,error:e.message}); else res.destroy(); }
});

app.listen(PORT, () => console.log(`BiliReels API listening on :${PORT}`));
