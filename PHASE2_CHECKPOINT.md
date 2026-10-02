# BiliReels — Local processing checkpoint

## Product behavior

- The visitor selects a video file stored on their device; the file is not uploaded to BiliReels.
- The browser captures up to the first 30 seconds, fits the complete frame in a blurred 9:16 background, and exports 720×1280 H.264/AAC MP4.
- The result is previewed and downloaded locally. A shorter source remains shorter than 30 seconds.
- The optional BiliBili URL feature displays metadata only; a page URL is not treated as a media file.
- No GitHub Actions dispatch, worker token, site access code, or Vercel processing secret is required.

## Dependencies and limits

- The site serves pinned ffmpeg.wasm 0.12.15 UMD/worker files from `vendor/ffmpeg/` on the same origin; it fetches the pinned core 0.12.10 JavaScript/WASM from jsDelivr on first export. The core is approximately 31 MB.
- Processing speed and memory use depend on the visitor's device; older or low-memory mobile browsers may fail. The site must show clear errors and real capture progress rather than promise a fixed processing time.
- AI highlight selection, subtitles, branding, arbitrary duration, and batch output remain unimplemented.

## Verification

- A local synthetic five-second MP4 was selected in the browser, processed through the interface, previewed, and downloaded. The downloaded file decodes as H.264/AAC at 720×1280 for 4.96 seconds; FFmpeg decoding completed without errors.
- The browser requested no legacy `/api/jobs`, `/api/download`, or `/api/auth` route during processing; only the optional metadata function remains.

## Previous server worker

The private GitHub Actions worker repository is left untouched for possible future reuse, but the website no longer calls it. Old token-gated web API files are removed from the active deployment.

## References

- FFmpeg.wasm usage documentation (pinned core and blob-URL loading): https://ffmpegwasm.netlify.app/docs/getting-started/usage/
- Upstream discussion of same-origin worker requirements for CDN-loaded FFmpeg 0.12 assets: https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/856
