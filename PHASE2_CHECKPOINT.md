# BiliReels — Server Worker Checkpoint (Phase 2)

## نظرة عامة على المنتج

يوفّر BiliReels الآن مسارين مستقلين لإنشاء Reels عمودية:

1. **المسار الأساسي (خادم):** يلصق المستخدم رابط BiliBili عام → يفحص الموقع العنوان والصورة والمدة عبر `/api/metadata` → يضبط الخيارات (المدة، الشعار، الترجمة) → يُدخل رمز الوصول مرة واحدة → يبدأ العامل على GitHub Actions معالجة الفيديو → يراقب الموقع الحالة عبر `/api/status` → يعرض الفيديو النهائي من Upstash Blob.
2. **المسار الاحتياطي (محلي):** يختار المستخدم ملفًا محفوظًا على جهازه → يعالجه المتصفح بـffmpeg.wasm → يُعرض ويُنزَّل محليًا دون أي رفع. محفوظ داخل `<details class="local-fallback">` في الواجهة.

## المكوّنات الرئيسية

### الموقع (Vercel)

- **`api/auth.js`** — يتحقق من `BILIREELS_ACCESS_CODE` ويصدر جلسة HMAC صالحة لساعتين. الرمز السري لا يُرسل بعد هذه النقطة.
- **`api/dispatch.js`** — يتحقق من الجلسة، يتحقق من مدخلات المستخدم (رابط، مدة، شعار، ترجمة)، ثم يستدعي GitHub Actions عبر `workflow_dispatch`. يعيد `requestId` عشوائيًا للاستطلاع.
- **`api/status.js`** — يستعلم عن حالة الـworkflow المطابق لـ`requestId`، ويستخرج رابط الفيديو النهائي (`PUBLIC_URL`) من سجل الـjob عند النجاح.
- **`api/metadata.js`** — يجلب العنوان والصورة والمدة والإحصاءات من BiliBili للمعاينة فقط. **لا يحمّل الفيديو أبدًا**.

### العامل (GitHub Actions — مستودع خاص `BiliReels-Worker`)

- **`.github/workflows/process-reel.yml`** — workflow يدوي (`workflow_dispatch`) بمُدخلات: `request_id`, `source_url`, `duration`, `logo_url`, `generate_subtitles`.
- **`scripts/process_reel.py`** — يتحقق من الرابط، يحمّل أول N ثانية عبر `yt-dlp` (بأفضل جودة تصل إلى 1080p)، يفرض قيود الحجم والمدة، ثم يعالج:
  - تحويل إلى 720×1280 مع خلفية ضبابية (blur-fit) للحفاظ على الإطار الأصلي كاملًا.
  - إضافة الشعار (اختياري) في الزاوية العلوية اليمنى.
  - توليد ترجمة عربية عبر `faster-whisper` (نموذج `base`) وحرقها داخل الفيديو.
  - التحقق من الناتج بـffprobe (الأبعاد، المدة، الحجم).
- **`requirements.txt`** — `yt-dlp` + `faster-whisper`.
- **الرفع النهائي** — إلى Upstash Blob عبر REST API، وطباعة `PUBLIC_URL: <link>` في السجل.

### التخزين (Upstash Blob)

- **Bucket عام:** `bilireels-storage` (يحتاج تفعيل Public Access).
- **الخطة المجانية:** 1 GB تخزين، 10 GB نقل شهريًا، بلا بطاقة بنكية.
- **الرفع:** من داخل GitHub Actions عبر `PUT` مع `Authorization: Bearer $UPSTASH_BLOB_TOKEN`.
- **الرابط الناتج:** `<UPSTASH_BLOB_URL>/<bucket>/<filename>.mp4` — عام وجاهز للبث المباشر.

## متغيرات البيئة المطلوبة

### على Vercel (Production)

| المتغير | القيمة | ملاحظة |
|---|---|---|
| `GH_WORKER_TOKEN` | GitHub PAT (fine-grained) | مقصور على `koreaone10-del/BiliReels-Worker`، صلاحيات `Actions: Read and write`, `Contents: Read`. |
| `BILIREELS_ACCESS_CODE` | رمز عشوائي 24+ محرف | يُدخل مرة واحدة في نافذة الموقع. |
| `GH_WORKER_REPO` | `koreaone10-del/BiliReels-Worker` | اختياري (الافتراضي هو هذا). |

### على GitHub (`BiliReels-Worker` — Settings → Secrets → Actions)

| المتغير | القيمة |
|---|---|
| `UPSTASH_BLOB_URL` | مثال: `https://b0ec81a743da.blob.upstash.io` |
| `UPSTASH_BLOB_TOKEN` | التوكن من Upstash |
| `UPSTASH_BUCKET_NAME` | مثال: `bilireels-storage` |

## الحدود والحماية

- **GitHub Actions (خطة مجانية):** 2000 دقيقة/شهر، مهمة واحدة متزامنة، 20 دقيقة مهلة/مهمة، artifact بحد أقصى معيّن. اضبط سقف الإنفاق على `$0` لمنع أي رسوم.
- **Upstash Blob:** 1 GB تخزين، 10 GB نقل شهريًا. روابط عامة بلا انتهاء صلاحية (يمكن حذف الملفات يدويًا لاحقًا إن أردت).
- **الحجم الأقصى للفيديو المُنتَج:** 200 MiB (افتراضي `MAX_OUTPUT_BYTES` في السكربت).
- **المدة:** بين 5 و60 ثانية (`MIN_CLIP_SECONDS`/`MAX_CLIP_SECONDS`).
- **الترجمة:** `faster-whisper` محلي على CPU؛ 30 ثانية صوت ≈ 15–40 ثانية معالجة.
- **الشعار:** HTTPS فقط، حجمه الموصى به ≤ 1 MB.

## ما هو مفعّل الآن

- تحميل من روابط BiliBili العامة (bilibili.com, bilibili.tv, b23.tv, bili.im, bili2233.cn).
- المعاينة الوصفية (العنوان، الصورة، المدة، المؤلف، المشاهدات).
- مدة مخصصة 5–60 ثانية.
- تحويل 9:16 مع خلفية ضبابية.
- شعار اختياري في الزاوية العلوية اليمنى.
- ترجمة عربية تلقائية عبر Whisper (تُحرق داخل الفيديو).
- تنزيل الناتج من رابط Upstash عام.
- معالجة محلية احتياطية (ffmpeg.wasm) عبر ملف محلي.

## ما لم يُفعَّل بعد

- **Smart Split:** تقسيم تلقائي حسب المشاهد أو الكلام.
- **Batch output:** إنشاء عدة Reels في طلب واحد.
- **Presets للجودة:** 480p / 1080p قابلة للاختيار.
- **تحديد نقطة البداية:** حاليًا يبدأ القص من 0s دائمًا.
- **تسجيل دخول BiliBili:** لا كوكيز، لا فيديوهات مقيدة.

## الاعتبارات القانونية

- يقتصر العامل على الروابط **العامة** ولا يستخدم كوكيز أو بيانات دخول أو تجاوز DRM.
- المستخدم مسؤول عن المحتوى الذي يحمّله؛ يجب استخدام الأداة للأغراض الشخصية فقط وبما يتوافق مع شروط BiliBili.
- لا تُدفع أي تكاليف مدفوعة تلقائيًا؛ كل شيء ضمن الخطط المجانية.

## الفحوصات المحلية (للمطور)

```bash
# تحقق من API metadata (يحتاج رابط BiliBili حقيقي)
curl -s "https://bliblireels.vercel.app/api/metadata?url=<URL>"

# تحقق من auth (يحتاج رمز الوصول)
curl -X POST "https://bliblireels.vercel.app/api/auth" \
  -H "Content-Type: application/json" \
  -d '{"code":"<ACCESS_CODE>"}'

# تشغيل workflow من GitHub مباشرة من تبويب Actions
# ثم راقب الحالة عبر:
curl -s "https://bliblireels.vercel.app/api/status?requestId=<ID>" \
  -H "Authorization: Bearer <SESSION_TOKEN>"
