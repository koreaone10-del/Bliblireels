# BiliReels — Video → Reels Studio

واجهة أولية مستقبلية وخفيفة لمشروع BiliReels.

## ما تم بناؤه
- Landing page responsive / mobile-first
- إدخال رابط وتحليل واجهة المصدر
- اختيار الجودة
- Auto Subtitle + اختيار اللغة (واجهة)
- رفع Logo بصيغ PNG/JPG/WEBP/SVG
- التحكم بالحجم والشفافية
- Smart Split بأطوال 60/90/120 ثانية
- شاشة Output وترقيم الـReels
- تصميم جاهز لربط Backend لاحقاً

## الخطوة التالية
ربط الواجهة بـAPI حقيقي لمعالجة المحتوى المصرح به:
1. Source adapter
2. Job queue
3. FFmpeg worker
4. Speech-to-text / translation
5. Subtitle burn-in
6. Branding
7. Reel generation
8. Object storage + signed download URLs

> الواجهة الحالية Demo ولا تقوم بتنزيل محتوى من Bilibili أو تجاوز أي حماية أو حقوق ملكية.
