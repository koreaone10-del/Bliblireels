# BiliReels — Phase 2 Fix / Source Input

This build fixes the two source-input problems reported on the live Netlify site:

- local video selection is initialized safely after DOM load and shows file metadata/preview;
- BiliBili URL analysis now uses a Netlify Function to resolve the BV id and fetch public video metadata server-side.

The UI remains the premium BiliReels interface.

## Important
This build does **not** pretend that remote BiliBili downloading is complete. The function resolves metadata only. Actual remote stream acquisition and FFmpeg processing are the next backend step.

## Deploy
Commit all files to the root of the `main` branch. Netlify will deploy automatically.
