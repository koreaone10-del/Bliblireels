const ENGINE_URL = "https://your-backend-engine-url.onrender.com"; // ضع رابط خادم Render هنا

const analyzeBtn = document.getElementById('analyzeBtn');
const urlInput = document.getElementById('videoUrl');
const videoCard = document.getElementById('videoCard');
const progressSection = document.getElementById('progressSection');

let currentUrl = '';
let pollInFlight = false;

// المرحلة 1: جلب البيانات السريعة
analyzeBtn.addEventListener('click', async () => {
    currentUrl = urlInput.value.trim();
    if (!currentUrl) return;

    analyzeBtn.disabled = true;
    analyzeBtn.innerText = "جاري الاتصال بـ BiliBili..."; // إزالة النسب الوهمية
    
    videoCard.style.display = 'none';
    progressSection.style.display = 'none';

    try {
        const res = await fetch(`${ENGINE_URL}/api/metadata?url=${encodeURIComponent(currentUrl)}`);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        // تعبئة بطاقة الفيديو
        document.getElementById('videoThumbnail').src = data.video.thumbnail;
        document.getElementById('videoTitle').innerText = data.video.title;
        document.getElementById('videoAuthor').innerText = `👤 ${data.video.author.name}`;
        document.getElementById('videoDuration').innerText = `⏱ ${data.video.duration} ثانية`;
        document.getElementById('videoViews').innerText = `👁 ${data.video.stats.views}`;

        videoCard.style.display = 'block';
    } catch (error) {
        alert("حدث خطأ أثناء جلب تفاصيل الفيديو. يرجى التأكد من الرابط.");
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.innerText = "تحليل الرابط";
    }
});

// المرحلة 2: بدء التحميل
document.getElementById('startDownloadBtn').addEventListener('click', async () => {
    videoCard.style.display = 'none';
    progressSection.style.display = 'block';
    
    try {
        const res = await fetch(`${ENGINE_URL}/api/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: currentUrl })
        });
        const data = await res.json();
        
        if (data.jobId) {
            poll(data.jobId);
        }
    } catch (error) {
        alert("فشل في بدء التحميل.");
    }
});

// المرحلة 3: التتبع الحقيقي للتقدم
async function poll(jobId) {
    if (pollInFlight) return;
    pollInFlight = true;

    try {
        const res = await fetch(`${ENGINE_URL}/api/jobs/${jobId}`);
        const job = await res.json();

        updateProgressUI(job);

        if (job.status === 'completed') {
            showResults(job.results);
            pollInFlight = false;
            return; // إنهاء المراقبة
        } else if (job.status === 'failed') {
            document.getElementById('progressStatusText').innerText = "فشلت العملية!";
            pollInFlight = false;
            return;
        }
    } catch (error) {
        console.error("Polling error", error);
    } finally {
        pollInFlight = false;
    }

    // استمرار التتبع كل 1.5 ثانية
    setTimeout(() => poll(jobId), 1500);
}

function updateProgressUI(job) {
    const statusText = document.getElementById('progressStatusText');
    const bar = document.getElementById('progressBarFill');
    const percentText = document.getElementById('progressPercentage');

    if (job.status === 'downloading') {
        statusText.innerText = "جاري تحميل المصدر...";
        bar.style.width = `${job.progress}%`;
        percentText.innerText = `${job.progress}%`;
    } else if (job.status === 'processing') {
        statusText.innerText = "جاري تحويل المقاطع (FFmpeg) وتهيئتها كـ Reels...";
        bar.style.width = "100%";
        bar.classList.add('bg-orange-500'); // تغيير اللون أثناء المعالجة
        percentText.innerText = "100%";
    }
}

function showResults(results) {
    progressSection.style.display = 'none';
    const resultsSection = document.getElementById('resultsSection');
    const list = document.getElementById('reelsList');
    list.innerHTML = '';

    results.forEach(reel => {
        const div = document.createElement('div');
        div.className = "p-4 border rounded shadow-sm flex flex-col items-center bg-white";
        div.innerHTML = `
            <span class="font-bold mb-3">${reel.title}</span>
            <a href="${reel.url}" target="_blank" download class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm w-full text-center">
                تحميل المقطع
            </a>
        `;
        list.appendChild(div);
    });

    resultsSection.style.display = 'block';
}
