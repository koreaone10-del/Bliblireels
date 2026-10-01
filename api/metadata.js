export default async function handler(req, res) {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: "الرابط مطلوب" });
    }

    try {
        let finalUrl = url;
        let bvid = null;

        // 1. معالجة الروابط القصيرة من تطبيق الهاتف (b23.tv)
        if (url.includes("b23.tv")) {
            const redirectRes = await fetch(url, { redirect: "manual" });
            // التقاط الرابط الطويل المخفي في الترويسة
            if (redirectRes.status >= 300 && redirectRes.status < 400) {
                finalUrl = redirectRes.headers.get("location") || url;
            }
        }

        // 2. استخراج BVID من الرابط الطويل
        const bvidMatch = finalUrl.match(/(BV[a-zA-Z0-9]+)/);
        if (!bvidMatch) {
            return res.status(400).json({ error: "لم يتم العثور على معرف الفيديو (BVID) في الرابط." });
        }
        bvid = bvidMatch[1];

        // 3. جلب البيانات الوصفية من BiliBili
        const metaRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
        const metaJson = await metaRes.json();

        if (metaJson.code !== 0) {
            return res.status(404).json({ error: "الفيديو غير موجود أو خاص." });
        }

        const videoData = metaJson.data;

        // 4. جلب الرابط المباشر للملف (للتجاوز لاحقاً)
        const cid = videoData.cid;
        const playUrlRes = await fetch(`https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=1`);
        const playUrlJson = await playUrlRes.json();

        let directVideoUrl = null;
        if (playUrlJson.code === 0 && playUrlJson.data && playUrlJson.data.durl && playUrlJson.data.durl.length > 0) {
            directVideoUrl = playUrlJson.data.durl[0].url;
        }

        res.status(200).json({
            ok: true,
            video: {
                bvid: videoData.bvid,
                title: videoData.title,
                thumbnail: videoData.pic,
                duration: videoData.duration,
                author: videoData.owner.name,
                views: videoData.stat.view,
                directUrl: directVideoUrl
            }
        });

    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "حدث خطأ في الخادم أثناء الاتصال بـ BiliBili." });
    }
}
