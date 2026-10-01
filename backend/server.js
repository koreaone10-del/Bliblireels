import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { extractBiliId, getMetadata } from './services/bilibili.js';

const app = express();
app.use(cors());
app.use(express.json());

// تخزين المهام في الذاكرة (يمكن لاحقاً نقله إلى Redis)
const jobs = new Map();

// 1. مسار جلب المعلومات السريع (بدون yt-dlp)
app.get('/api/metadata', async (req, res) => {
    try {
        const { url } = req.query;
        const bvid = extractBiliId(url);
        if (!bvid) return res.status(400).json({ error: "INVALID_URL" });
        
        const metadata = await getMetadata(bvid);
        res.json(metadata);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. مسار بدء مهمة التحميل (يستجيب فوراً)
app.post('/api/download', (req, res) => {
    const { url } = req.body;
    const jobId = 'job_' + Date.now();
    
    jobs.set(jobId, { 
        id: jobId, 
        status: 'queued', 
        progress: 0 
    });

    // تشغيل التحميل في الخلفية دون جعل المستخدم ينتظر
    processVideoJob(jobId, url);

    res.json({ jobId });
});

// 3. مسار تتبع التقدم الحقيقي (Polling)
app.get('/api/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
    res.json(job);
});

async function processVideoJob(jobId, url) {
    const job = jobs.get(jobId);
    job.status = 'downloading';
    
    // محاكاة استدعاء yt-dlp مع قراءة التقدم الحقيقي
    // في الإنتاج الفعلي، ستقوم بتمرير url إلى yt-dlp وقراءة stdout
    let progress = 0;
    const downloadInterval = setInterval(() => {
        progress += 10;
        job.progress = progress;
        job.status = `downloading`;
        
        if (progress >= 100) {
            clearInterval(downloadInterval);
            job.status = 'processing';
            
            // محاكاة FFmpeg للتقسيم إلى Reels
            setTimeout(() => {
                job.status = 'completed';
                job.results = [
                    { title: "Reel 1", url: "https://your-server/files/reel1.mp4" },
                    { title: "Reel 2", url: "https://your-server/files/reel2.mp4" }
                ];
            }, 3000);
        }
    }, 1000);
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`BiliReels Engine running on port ${PORT}`));
