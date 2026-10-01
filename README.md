# BiliReels — Vercel + private free worker

BiliReels keeps the current lightweight URL preview on Vercel and delegates the CPU-heavy FFmpeg work to a short-lived, private GitHub Actions runner.

## What is implemented

- Analyze public BiliBili / BiliBili.tv URLs and show source metadata and thumbnail.
- Create **one** Reel from the first 30 seconds, in a 9:16 `720×1280` H.264/AAC MP4.
- Use a blurred-fit background so the full original frame remains visible; preserve source audio when present.
- Show the real GitHub Actions stage; no invented percentage.
- Preview the MP4 in the browser and download the original private artifact ZIP.
- Worker runs only on GitHub's standard `ubuntu-latest` runner. No paid runner, third-party video API, or public file bucket is used.

Subtitles, logo overlay, 60-second/custom durations, 480p/1080p and smart split are intentionally disabled until their own processing implementations are added.

## Architecture

```text
Browser
  └─ Vercel: static UI + /api/metadata + /api/auth + /api/jobs
       └─ fine-grained GitHub token (server only)
            └─ private repository: koreaone10-del/BiliReels-Worker
                 └─ GitHub Actions: yt-dlp + FFmpeg → short-lived private artifact
```

The GitHub token and access code must never be committed, put in `app.js`, or sent in chat.

## One-time setup

1. The private worker repository `koreaone10-del/BiliReels-Worker` is already provisioned on `main`; verify it remains private and its workflow is enabled.
2. In GitHub, create a fine-grained token scoped only to that private worker repository, with **Actions: read and write** and **Contents: read**. Keep it private.
3. In the Vercel project `bliblireels`, add these **Production** environment variables:
   - `GH_WORKER_TOKEN` — the fine-grained token; mark it sensitive/encrypted.
   - `BILIREELS_ACCESS_CODE` — generate a long random value locally (at least 24 characters); the same value is entered in the site's processing dialog.
   - `GH_WORKER_REPO` — optional; default is `koreaone10-del/BiliReels-Worker`.
4. Set GitHub Actions spending to stop at `$0` overage. The private repo uses the included account-wide Free allowance; usage is not guaranteed if the account has already spent the shared allowance.
5. Redeploy the latest Vercel production deployment after setting environment variables.

Do not send either secret in a message or commit it to this repository. Keep these variables Production-only unless you deliberately want Preview deployments to run jobs too.

## Free-use guardrails

- Maximum one queued/running job at a time and **100 launches per month** (up to 15 runner-minutes each; the hard timeout is 15 minutes).
- Output capped at 75 MiB; Actions artifact retention is one day.
- The backend refuses new jobs if too many unexpired artifacts remain.
- Private repo is required because run metadata may contain the source URL and artifacts must not be public.
- These caps reduce risk but cannot see other workloads using the same GitHub account quota. Keep overage spending disabled.

## Source restrictions

Only public supported BiliBili pages are accepted. Some videos are unavailable by region, rights settings or upstream changes. The worker does not use cookies, account credentials, DRM circumvention or access-control/geo bypass. Process only media you have permission to use.

## Local checks

```bash
node --check app.js
node --input-type=module --check < api/auth.js
node --input-type=module --check < api/jobs.js
node --input-type=module --check < lib/access.js
node --input-type=module --check < zip-preview.js
```

The worker test uses a synthetic local clip and never downloads the user's source video.
