const analyzeBtn = document.getElementById('analyzeBtn');
const urlInput = document.getElementById('videoUrl');
const videoCard = document.getElementById('videoCard');
const progressSection = document.getElementById('progressSection');
const startDownloadBtn = document.getElementById('startDownloadBtn');

let currentVideoData = null;

// المرحلة 1: جلب البيانات وعرضها
analyzeBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) return;

    analyzeBtn.disabled = true;
    analyzeBtn.innerText = "جاري الاتصال...";
    
    videoCard.style.display = 'none';
    if(progressSection) progressSection.style.display = 'none';

    try {
        // الاتصال بدالة Vercel الداخلية مباشرة
        const res = await fetch(`/api/metadata?url=${encodeURIComponent(url)}`);
        const data = await res.json();

        if (!res.ok || data.error) {
            throw new Error(data.error || "فشل في جلب البيانات.");
        }

        currentVideoData = data.video;

        // تعبئة بطاقة الفيديو
        document.getElementById('videoThumbnail').src = currentVideoData.thumbnail;
        document.getElementById('videoTitle').innerText = currentVideoData.title;
        document.getElementById('videoAuthor').innerText = `👤 ${currentVideoData.author}`;
        
        // تحويل الثواني إلى دقائق
        const minutes = Math.floor(currentVideoData.duration / 60);
        const seconds = currentVideoData.duration % 60;
        document.getElementById('videoDuration').innerText = `⏱ ${minutes}:${seconds < 10 ? '0'+seconds : seconds}`;
        
        document.getElementById('videoViews').innerText = `👁 ${currentVideoData.views}`;

        videoCard.style.display = 'block';
        
        // إظهار قسم الإعدادات إذا كان مخفياً
        const workspace = document.getElementById('workspace');
        if(workspace) workspace.style.display = 'block';

    } catch (error) {
        alert(error.message);
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.innerText = "تحليل";
    }
});

// المرحلة 2: التحميل المباشر
if (startDownloadBtn) {
    startDownloadBtn.addEventListener('click', () => {
        if (!currentVideoData || !currentVideoData.directUrl) {
            alert("رابط التحميل غير متوفر لهذا الفيديو.");
            return;
        }

        const originalText = startDownloadBtn.innerHTML;
        startDownloadBtn.innerHTML = "جاري التحضير... ⏳";
        startDownloadBtn.disabled = true;

        // توجيه المتصفح إلى دالة التحميل الخاصة بنا لتجاوز الحماية
        const downloadProxyUrl = `/api/download?url=${encodeURIComponent(currentVideoData.directUrl)}&title=${encodeURIComponent(currentVideoData.title)}`;
        
        // إنشاء رابط مخفي والضغط عليه لبدء التحميل الفعلي
        const a = document.createElement('a');
        a.href = downloadProxyUrl;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // إعادة الزر لحالته بعد ثوانٍ قليلة
        setTimeout(() => {
            startDownloadBtn.innerHTML = originalText;
            startDownloadBtn.disabled = false;
        }, 3000);
    });
}
