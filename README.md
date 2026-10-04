# BiliReels

معاينة BiliBili تعمل عبر `/api/metadata`. تحويل رابط BiliBili إلى Reel يمر بمرحلتين خارج Vercel: Render ينزّل أول مدة المقطع المطلوبة (+ هامش keyframe) إلى Upstash، ثم GitHub Actions يقصه إلى MP4 عمودي 720×1280 ويرفع النتيجة.

## التدفق

1. رمز الوصول يبادل عبر `/api/auth` جلسة HMAC قصيرة العمر؛ لا يُرسل رمز الوصول إلى العامل.
2. `/api/dispatch` يتحقق من الرابط والمدة ثم يرسل طلب تنزيل إلى Render عبر `WORKER_URL`، مستخدمًا `DOWNLOADER_SECRET` من الخادم فقط.
3. Render يقبل نطاقات BiliBili المحددة، ينزّل أول 5–65 ثانية وفق الاختيار، ويرفع ملفًا مؤقتًا إلى Upstash Blob.
4. `/api/status` يقرأ حالة Render وGitHub Actions بالتوازي. عند اكتمال التنزيل يحجز مرحلة المعالجة مرة واحدة ويشغّل workflow الخاص `process-reel.yml`.
5. GitHub Actions ينتج H.264/AAC MP4 عموديًا، ويرفع النتيجة، ثم يحذف ملف المصدر المؤقت باستخدام `@upstash/blob` SDK. فشل التنظيف يظهر كتحذير ولا يفشل الفيديو الناتج.
6. رابط MP4 النهائي عام وقابل للتنزيل لمن يملكه؛ لا تُرفع ملفات الجهاز في وضع المعالجة المحلية.

تحتفظ خدمة Render بحالة المهمة في الذاكرة، لذا أبقِ الصفحة مفتوحة حتى يكتمل التشغيل. قد يتأخر أول طلب بعد خمول Render بسبب إيقاظ الخدمة المجانية؛ وإذا أعيد تشغيل الخدمة وفُقدت حالة مهمة، تتوقف الواجهة برسالة واضحة بدل انتظار لا نهائي. يفشل التشغيل بوضوح إذا انتهت حصة GitHub Actions أو لم تتوفر صلاحيات workflow.

## متغيرات البيئة

### Vercel

- `BILIREELS_ACCESS_CODE`: رمز وصول طويل (16 محرفًا على الأقل).
- `WORKER_URL`: عنوان خدمة Render مثل `https://bilireels-worker.onrender.com`.
- `DOWNLOADER_SECRET`: نفس القيمة التي ولّدها Render لمتغير `WORKER_SECRET`.
- `GH_WORKER_TOKEN`: Fine-grained token يملك `Actions: Read and write` على المستودع الخاص للعامل.
- `GH_WORKER_REPO`: اختياري؛ الافتراضي `koreaone10-del/BiliReels-Worker`.

### Render

يضبط `render.yaml` متغيرات `UPSTASH_BLOB_URL` و`UPSTASH_BLOB_TOKEN` و`UPSTASH_BUCKET_NAME` يدويًا، ويولّد `WORKER_SECRET`. انسخ قيمة السر إلى Vercel مرة واحدة؛ لا تضعها في JavaScript أو المستودع.

### GitHub Actions — مستودع العامل الخاص

أضف GitHub Actions secrets التالية: `UPSTASH_BLOB_URL`, `UPSTASH_BLOB_TOKEN`, `UPSTASH_BUCKET_NAME`. يجب أن يسمح token الخاص بالـbucket بالقراءة والكتابة والحذف، لأن workflow ينظف الملف الوسيط بعد المعالجة. لا يُستخدم كوكي BiliBili ولا يتجاوز worker DRM أو تسجيل الدخول.

## التخزين والخصوصية

يُرفع المصدر الخام مؤقتًا إلى bucket عام لأن GitHub runner يحتاج قراءته؛ خطوة تنظيف مضمونة (`if: always()`) تحذف كائن `raw_<request-id>_<timestamp>.mp4` عند بدء workflow أو فشله. إذا لم يبدأ workflow أصلًا، يبقى الكائن الخام في Upstash حتى تنظيف يدوي. الناتج النهائي عام بالتصميم حتى يستطيع المتصفح تنزيله. لا تستخدم الخدمة للمواد التي تحتاج سرية أو حقوق وصول خاصة.

## المدة والتكلفة

النسخة الحالية تحد المقطع إلى 5–60 ثانية، الافتراضي 30 ثانية، وحجم المصدر الوسيط إلى 250 MiB. يثبت `yt-dlp` على `2026.08.19`. تُستخدم فقط الطبقات المجانية لكل من Vercel وRender وGitHub Actions وUpstash؛ لكل مزود حدود خمول/حصة وقد يتوقف التشغيل عند بلوغها. Whisper يُثبت فقط عند تفعيل الترجمة لتقليل دقائق Actions.

## فحوص محلية

```bash
node --check app.js
node --input-type=module --check < api/auth.js
node --input-type=module --check < api/dispatch.js
node --input-type=module --check < api/status.js
node --input-type=module --check < api/metadata.js
python3 -m py_compile ../BiliReels-Worker/server.py ../BiliReels-Worker/scripts/process_reel.py
```
