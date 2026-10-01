# BiliReels — Phase 2 checkpoint

## Confirmed baseline

- Production metadata preview was confirmed working for the user's `bilibili.tv` example: the page already returned the title and thumbnail. The defect in the preceding repair was the preview state remaining hidden, not a missing title response.
- Current source baseline reviewed from GitHub `main` at `7f29686be56b6a7a1cfd7d004e08a654f61f3466`.
- `yt-dlp 2026.08.19` successfully extracted the title and selected `BiliIntl` for the exact public example URL without downloading media.

## Phase 2 implemented in source

- A private GitHub Actions worker runs on the standard `ubuntu-latest` runner only.
- It requests one public source and creates one first-30-second Reel, 720×1280, vertical blur-fit, MP4 H.264/AAC.
- Vercel APIs authenticate an owner access code, dispatch/poll the GitHub job, check a private one-day artifact, stream the artifact to the browser for MP4 preview, and provide a signed ZIP download.
- The UI shows the actual worker stage, not an invented percent, and disables controls not implemented yet.
- Free guards: 15-minute job timeout, one concurrent job, 100 starts/month, 75 MiB output cap and short artifact retention.

## Local verification

- FFmpeg fixture transcode passed and yielded a valid 720×1280 MP4.
- ZIP preview parser successfully extracted and identified the MP4 using a synthetic archive.
- Auth, dispatch, stage polling, completion, private download redirect and preview streaming passed mocked API tests.
- JavaScript/Python syntax and HTML ID uniqueness checks passed.

## Activation status

The private worker repository is live at `koreaone10-del/BiliReels-Worker` on `main` (commit `59a0dc83e6d89097ed5401cde1dac93c065527c1`); GitHub reports its workflow as active. The Vercel source changes still need pushing to the existing web repository `main`. Production secrets (`GH_WORKER_TOKEN`, `BILIREELS_ACCESS_CODE`) must be added and the resulting Vercel deployment verified before a live processing run. No secrets are stored in either repository.

## Not yet implemented

Subtitles, logo overlay, 60-second/custom Reel durations, 480p/1080p, content-aware smart splitting and multi-Reel ZIP export remain future stages. Their controls are disabled rather than falsely presented as working.
