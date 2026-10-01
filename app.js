// جلب عناصر الواجهة
const analyzeForm = document.getElementById('analyzeForm');
const analyzeBtn = document.getElementById('analyzeBtn');
const urlInput = document.getElementById('videoUrl');
const videoCard = document.getElementById('videoCard');
const progressSection = document.getElementById('progressSection');
const startDownloadBtn = document.getElementById('startDownloadBtn');

let currentVideoData = null;

// التغيير الجذري: الاستماع لحدث إرسال النموذج (submit) بدلاً من نقرة الزر لمنع تحديث الصفحة
analyzeForm.addEventListener('submit', async (e) => {
    e.preventDefault(); // 🟢 هذا السطر يمنع الصفحة من إعادة التحميل ويحل المشكلة!

    const url = urlInput.value.trim();
    if (!url) return;

    analyzeBtn.disabled = true;
    analyzeBtn.innerText = "جاري الاتصال...";
    
    // إخفاء الأقسام السابقة إن وجدت
    videoCard.style.display = 'none';
    if(progressSection) progressSection.style.display = 'none';

    try {
        const res = await fetch(`/api/metadata?url=${encodeURIComponent(url)}`);
        
        // التحقق من أخطاء السيرفر غير المتوقعة (مثل خطأ 500 في Vercel)
        if (!res.ok) {
            const errorText = await res.text();
            console.error("Vercel Server Error:", errorText);
            throw new Error("حدث خطأ في الخادم أثناء تحليل الرابط.");
        }

        const data = await res.json();

        // عرض رسائل الخطأ القادمة من الباك إند
        if (data.error) {
            throw new Error(data.error);
        }

        currentVideoData = data.video;

        // تعبئة بطاقة الفيديو (مع وضع قيم افتراضية لروابط Bilibili.tv التي قد لا توفر كل البيانات)
        document.getElementById('videoThumbnail').src = currentVideoData.thumbnail || '';
        document.getElementById('videoTitle').innerText = currentVideoData.title || 'فيديو BiliBili';
        document.getElementById('videoAuthor').innerText = `👤 ${currentVideoData.author || 'غير معروف'}`;
        
        const duration = currentVideoData.duration || 0;
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        document.getElementById('videoDuration').innerText = `⏱ ${minutes}:${seconds < 10 ? '0'+seconds : seconds}`;
        
        document.getElementById('videoViews').innerText = `👁 ${currentVideoData.views || 0}`;

        // إظهار البطاقة
        videoCard.style.display = 'block';
        
        // إظهار قسم الإعدادات
        const workspace = document.getElementById('workspace');
        if(workspace) workspace.style.display = 'block';

    } catch (error) {
        console.error("Catch Error:", error);
        alert(error.message || "حدث خطأ غير متوقع، يرجى التحقق من الرابط والمحاولة مجدداً.");
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.innerText = "تحليل";
    }
});

// المرحلة 2: التحميل المباشر
if (startDownloadBtn) {
    startDownloadBtn.addEventListener('click', () => {
        if (!currentVideoData || !currentVideoData.directUrl) {
            alert("عذراً، رابط التحميل المباشر غير متوفر لهذا الفيديو. جرب رابطاً آخر.");
            return;
        }

        const originalText = startDownloadBtn.innerHTML;
        startDownloadBtn.innerHTML = "جاري التحضير للتحميل... ⏳";
        startDownloadBtn.disabled = true;

        // توجيه الطلب إلى Vercel لتجاوز الحماية
        const downloadProxyUrl = `/api/download?url=${encodeURIComponent(currentVideoData.directUrl)}&title=${encodeURIComponent(currentVideoData.title || 'BiliReel')}`;
        
        // بدء التحميل بشكل صامت
        const a = document.createElement('a');
        a.href = downloadProxyUrl;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // إعادة الزر لحالته بعد 3 ثوانٍ
        setTimeout(() => {
            startDownloadBtn.innerHTML = originalText;
            startDownloadBtn.disabled = false;
        }, 3000);
    });
}
