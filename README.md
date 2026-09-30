# BiliReels URL-only Vercel step

The product flow is URL-only: BiliBili URL -> analyze -> request design -> video engine -> output.

Vercel is the frontend/API orchestration layer. Set `VIDEO_ENGINE_URL` to the deployed video worker.

The repository must not claim that download/processing is complete until the worker and persistent output storage are deployed and tested.
