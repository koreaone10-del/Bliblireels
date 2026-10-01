export function extractBiliId(url) {
    // استخراج BV ID من الروابط
    const bvMatch = url.match(/(BV[a-zA-Z0-9]+)/);
    return bvMatch ? bvMatch[1] : null;
}

export async function getMetadata(bvid) {
    try {
        const res = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
        const json = await res.json();
        
        if (json.code !== 0) {
            throw new Error("VIDEO_NOT_FOUND");
        }

        // توحيد شكل البيانات لحماية الواجهة الأمامية من أي تغييرات في API
        return {
            ok: true,
            platform: "bilibili",
            video: {
                bvid: json.data.bvid,
                cid: json.data.cid,
                title: json.data.title,
                thumbnail: json.data.pic,
                duration: json.data.duration,
                author: {
                    name: json.data.owner.name,
                },
                stats: {
                    views: json.data.stat.view,
                    likes: json.data.stat.like
                },
                pages: json.data.pages || []
            }
        };
    } catch (error) {
        throw new Error("BILIBILI_API_ERROR");
    }
}
