# BiliReels — Local Reel Studio

BiliReels now processes a video file selected by the visitor directly in the browser. It does not upload the video, start GitHub Actions, or require GitHub/Vercel API tokens. The optional BiliBili link form retrieves page metadata only; it does not download media.

## Visitor flow

1. Save a video file to the device using a method permitted for that content.
2. Select the local file in BiliReels.
3. The browser plays and captures up to the first 30 seconds, fitting the complete frame into a 9:16 canvas with a blurred background.
4. A pinned ffmpeg.wasm UMD/core build converts that short capture into a 720×1280 H.264/AAC MP4. The visitor can preview and download the result.

Files are held in local browser object URLs and are not sent to the BiliReels server. The pinned ffmpeg.wasm 0.12.15 UMD bundle and its small worker are served from this site (`vendor/ffmpeg/`) so the worker is same-origin. On first conversion, the browser fetches the pinned ffmpeg-core 0.12.10 JavaScript/WebAssembly files (about 31 MB total) from jsDelivr and converts them to local blob URLs; this transfers the processing library, not the visitor's source video. The included FFmpeg.wasm files are MIT-licensed; see `vendor/ffmpeg/LICENSE`. On-device conversion can be slow or unavailable on older/low-memory mobile devices. Use a current Chrome, Edge, or Safari browser and keep the page open until the export finishes. Source videos under 30 seconds produce shorter outputs.

The optional `/api/metadata` endpoint remains for public BiliBili title/thumbnail previews. It is not used as a media source. Subtitles, logo overlay, AI highlight selection, arbitrary duration, and batch output are not implemented and are not represented as working controls.

## Deployment

The site is static plus the optional metadata function. No `GH_WORKER_TOKEN`, `BILIREELS_ACCESS_CODE`, worker repository, storage bucket, or server-side media processing is needed. Remove the old token-gated API files from the deployment; revoke any worker token created solely for the previous workflow and delete its Vercel environment variables after confirming the new deployment is live.

## Local checks

```bash
node --check app.js
node --input-type=module --check < api/metadata.js
```

The browser workflow was also verified with a local five-second synthetic MP4: it reached 100%, showed a playable preview, and downloaded a valid 720×1280 H.264/AAC MP4 (4.96 seconds). The source file was not uploaded.
