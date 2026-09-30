# BiliReels Video Engine v1
This worker implements the first real URL path:
BiliBili URL -> yt-dlp -> MP4 -> FFmpeg 9:16 segments -> individual MP4 + ZIP.

Set PUBLIC_BASE_URL to the public HTTPS URL of this worker. It is intentionally URL-only: there is no local video upload route.

Current limitations:
- Smart Split AI flag is accepted but not yet semantic AI selection.
- Subtitle transcription/translation and logo burn-in are not yet wired into FFmpeg.
- Job state/files are local to the worker and expire after JOB_TTL_MS. For production, move outputs to S3/R2/Blob and jobs to a persistent queue/database.
