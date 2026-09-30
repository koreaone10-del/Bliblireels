# BiliReels — Phase 2 Checkpoint

## Current live issue fixed
1. Selecting a local video from Android did not reliably initialize the preview.
2. The BiliBili source field was only a placeholder and did not call a backend.

## Fix included
- Robust `app.js` boot using DOMContentLoaded.
- Local video `change` handler, drag/drop, object URL preview, metadata/error handling.
- BiliBili URL validation.
- Netlify Function: `netlify/functions/bilibili.js`.
- Function resolves BV id and calls BiliBili public view metadata endpoint.
- `netlify.toml` configured for Netlify Functions.

## Not completed yet
- Actual remote BiliBili stream download.
- Remote FFmpeg processing.
- Automatic subtitles.
- AI smart highlight detection.
- ZIP export.

## Next checkpoint
Test on the live Netlify site:
- choose a 10–20 second MP4 from Android and confirm preview + metadata;
- paste a normal BiliBili BV URL and confirm title/duration appear.

After those tests, implement remote stream acquisition + real FFmpeg processing without breaking the premium UI.
