# BiliReels — Phase 2 checkpoint (2026-10-04)

## المسار المقصود

1. `/api/metadata` للمعاينة فقط.
2. `/api/auth` يصدر جلسة HMAC من رمز وصول خاص.
3. `/api/dispatch` يرسل الرابط والخيارات إلى Render عبر `WORKER_URL` مع سر الخادم.
4. Render يتحقق من نطاق BiliBili، ينزّل أول `duration + 5` ثوانٍ بواسطة `yt-dlp==2026.08.19`، ويخزن ملفًا وسيطًا في Upstash Blob.
5. `/api/status` يستعلم بالتوازي عن Render وGitHub؛ بعد اكتمال التنزيل يحجز التحويل مرة واحدة ثم يشغّل workflow في مستودع GitHub الخاص.
6. GitHub Actions يصنع MP4 720×1280، يرفعه إلى Upstash، ويزيل object الخام باسم الطلب عبر `@upstash/blob@0.0.9`. إذا تعذر التنظيف فهو تحذير لا يفشل الناتج.
7. الواجهة تعرض مرحلة Render ثم GitHub Actions، ولا تحسب نسبة تقديرية. الحد الأقصى للاستطلاع 35 دقيقة.

## ملفات التغيير الرئيسية

- الموقع: `api/dispatch.js`, `api/status.js`, `app.js`, `index.html`, `vercel.json`, `README.md`.
- العامل: `server.py`, `requirements.txt`, `requirements-actions.txt`, `.github/workflows/process-reel.yml`, `scripts/delete_raw_blob.mjs`, `README.md`.

## إعداد البيئة اللازم

**Vercel:** `BILIREELS_ACCESS_CODE`، `WORKER_URL`، `DOWNLOADER_SECRET` (مطابق لـRender `WORKER_SECRET`)، `GH_WORKER_TOKEN` بصلاحية Actions Read/Write، و`GH_WORKER_REPO` اختياري.

**Render:** `UPSTASH_BLOB_URL`, `UPSTASH_BLOB_TOKEN`, `UPSTASH_BUCKET_NAME`; يتم توليد `WORKER_SECRET` عبر `render.yaml` ثم نسخ قيمته يدويًا إلى Vercel.

**GitHub Actions في المستودع الخاص:** أسرار Upstash الثلاثة نفسها. يجب تفعيل Actions والـworkflow `process-reel.yml`.

## القيود الواقعية

- Render يحتفظ بحالة المهمة في الذاكرة، لذلك أبقِ صفحة المعالجة مفتوحة؛ قد يتأخر أول اتصال بعد خمول الخطة المجانية.
- وسيط المصدر عام مؤقتًا حتى يبدأ workflow؛ إذا لم يبدأ workflow أصلًا، يبقى ذلك الـobject حتى تنظيف يدوي. الناتج النهائي عام كي يكون قابلًا للتنزيل.
- الحد: 5–60 ثانية، الافتراضي 30؛ وسيط 250 MiB؛ مهمة Actions مدتها 30 دقيقة؛ لا cookies أو DRM أو محتوى يتطلب تسجيل دخول.
- Whisper يُثبت فقط إذا طلب المستخدم الترجمة لتقليل استهلاك دقائق التشغيل.

## فحوص محلية منفذة

- `node --check` لملفات الواجهة وAPI.
- اختبارات وهمية لدورة dispatch/status: إنشاء تشغيل GitHub، تتبع حالة التنفيذ، استخراج رابط MP4 من ZIP logs، ورفض الوصول غير المخوّل.
- `py_compile` وFastAPI TestClient: المصادقة، نطاق المصدر، حدود المدة، واستجابة status/claim.
- ملف workflow تم تحليله بـPyYAML.
- `yt-dlp==2026.08.19 --skip-download` استخرج عنوان رابط المستخدم نفسه؛ لم يتم تنزيل الفيديو.

**الحالة:** الأكواد محليًا مصححة ومختبرة؛ لم يُدفع هذا التغيير بعد في هذه الدورة، ولم يجرِ تشغيل أول Reel حقيقي عبر العاملين.
