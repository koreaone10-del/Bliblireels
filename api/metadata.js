export default async function handler(req, res) {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: "الرابط مطلوب" });
    }

    try {
        let finalUrl = url;

        // 1. تتبع وفك تشفير الروابط المختصرة (bili.im و b23.tv)
        if (url.includes("bili.im") || url.includes("b23.tv") || url.includes("bili2233.cn")) {
            const redirectRes = await fetch(url, {
                redirect: "manual",
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            // التقاط الرابط الطويل من الترويسة
            if (redirectRes.status >= 300 && redirectRes.status < 400) {
                finalUrl = redirectRes.headers.get("location") || url;
            }
        }

        // 2. تحديد نوع المنصة
        const isGlobalTv = finalUrl.includes("bilibili.tv");
        
        let title = "فيديو BiliBili";
        let thumbnail = "";
        let duration = 0;
        let views = 0;
        let author = "صانع محتوى";
        let directUrl = null;

        if (isGlobalTv) {
            // المعالجة الخاصة بـ Bilibili.tv (النسخة العالمية)
            // استخراج البيانات الوصفية مباشرة من HTML الصفحة لتجاوز حظر الـ API
            const pageRes = await fetch(finalUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
            });
            const html = await pageRes.text();

            // استخراج العنوان والصورة المصغرة باستخدام Regex
            const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
            const imgMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
            
            // محاولة البحث عن أي مسار تشغيل مباشر بصيغة mp4 مخفي في السكريبت
            const videoMatch = html.match(/src="([^"]+\.mp4[^"]*)"/i);

            if (titleMatch) title = titleMatch[1].replace(/ - Bilibili TV/i, '').trim();
            if (imgMatch) thumbnail = imgMatch[1];
            if (videoMatch) directUrl = videoMatch[1].replace(/\\u002F/g, '/');

        } else {
            // المعالجة الخاصة بـ Bilibili.com (النسخة الصينية)
            const bvidMatch = finalUrl.match(/(BV[a-zA-Z0-9]+)/);
            if (!bvidMatch) {
                throw new Error("لم يتم العثور على معرف الفيديو الصحيح في الرابط.");
            }
            const bvid = bvidMatch[1];

            const metaRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
            const metaJson = await metaRes.json();

            if (metaJson.code === 0) {
                title = metaJson.data.title;
                thumbnail = metaJson.data.pic;
                duration = metaJson.data.duration;
                author = metaJson.data.owner.name;
                views = metaJson.data.stat.view;

                // جلب الرابط المباشر
                const cid = metaJson.data.cid;
                const playUrlRes = await fetch(`https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=1`);
                const playUrlJson = await playUrlRes.json();
                
                if (playUrlJson.code === 0 && playUrlJson.data && playUrlJson.data.durl && playUrlJson.data.durl.length > 0) {
                    directUrl = playUrlJson.data.durl[0].url;
                }
            } else {
                throw new Error("الفيديو غير متاح أو مقيد من المصدر.");
            }
        }

        // إرسال البيانات النهائية للواجهة الأمامية
        res.status(200).json({
            ok: true,
            video: {
                title,
                thumbnail,
                duration,
                author,
                views,
                directUrl: directUrl || finalUrl // إذا لم نعثر على رابط MP4 مباشر، نرسل الرابط الأصلي
            }
        });

    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: error.message || "حدث خطأ أثناء تحليل الرابط المرجو المحاولة مجدداً." });
    }
}
