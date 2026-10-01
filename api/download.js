export default async function handler(req, res) {
    const { url, title } = req.query;

    if (!url) {
        return res.status(400).json({ error: "رابط المصدر مطلوب" });
    }

    try {
        // الاتصال بسيرفر BiliBili مع ترويسة Referer لتجاوز الحماية
        const videoResponse = await fetch(decodeURIComponent(url), {
            headers: {
                'Referer': 'https://www.bilibili.com',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        if (!videoResponse.ok) {
            throw new Error("فشل الوصول إلى ملف الفيديو");
        }

        const safeTitle = title ? decodeURIComponent(title).replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_') : 'BiliReel';

        // إجبار المتصفح على تحميل الملف كفيديو MP4
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);

        // تمرير البيانات مباشرة للمستخدم (Streaming) دون تجاوز وقت Vercel
        const buffer = await videoResponse.arrayBuffer();
        res.send(Buffer.from(buffer));

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
