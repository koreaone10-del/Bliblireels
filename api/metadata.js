const REQUEST_TIMEOUT_MS = 9000;
const MAX_REDIRECTS = 5;
const ROOT_DOMAINS = ['bilibili.com', 'bilibili.tv', 'b23.tv', 'bili.im', 'bili2233.cn'];
const SHORT_DOMAINS = ['b23.tv', 'bili.im', 'bili2233.cn'];

function isDomain(hostname, domains) {
    const host = hostname.toLowerCase();
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function createError(message, statusCode = 502) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function decodeHtml(value = '') {
    return value
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
        .replace(/&#x([\da-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)));
}

function readAttribute(tag, name) {
    const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const match = tag.match(pattern);
    return match ? decodeHtml(match[1] ?? match[2] ?? match[3] ?? '') : '';
}

function readMeta(html, wantedName) {
    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
        const tag = match[0];
        const name = readAttribute(tag, 'property') || readAttribute(tag, 'name') || readAttribute(tag, 'itemprop');
        if (name.toLowerCase() === wantedName.toLowerCase()) return readAttribute(tag, 'content');
    }
    return '';
}

function cleanTitle(value) {
    return decodeHtml(value || '')
        .replace(/\s*[|–—-]\s*(?:bilibili(?:\s*tv)?|哔哩哔哩)\s*$/i, '')
        .trim();
}

async function followShortLink(startUrl, deadline, headers) {
    let currentUrl = new URL(startUrl);
    for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw createError('انتهت مهلة حل الرابط المختصر.', 504);
        const response = await fetch(currentUrl, {
            method: 'GET',
            headers,
            redirect: 'manual',
            signal: AbortSignal.timeout(remaining)
        });

        if (![301, 302, 303, 307, 308].includes(response.status)) {
            if (!response.ok) throw createError(`تعذر فتح الرابط المختصر (HTTP ${response.status}).`, 502);
            return { response, url: currentUrl };
        }

        const location = response.headers.get('location');
        if (!location) throw createError('أعاد الرابط المختصر تحويلًا بلا وجهة.', 502);
        const nextUrl = new URL(location, currentUrl);
        if (!['http:', 'https:'].includes(nextUrl.protocol) || !isDomain(nextUrl.hostname, ROOT_DOMAINS)) {
            throw createError('رفض BiliReels تحويل الرابط إلى نطاق غير تابع لـ BiliBili.', 400);
        }
        nextUrl.protocol = 'https:';
        currentUrl = nextUrl;
    }
    throw createError('تجاوز الرابط المختصر عدد التحويلات المسموح به.', 400);
}

function extractVideoId(url) {
    const bvid = url.href.match(/\b(BV[a-zA-Z0-9]+)\b/);
    if (bvid) return { bvid: bvid[1] };

    const avMatch = url.pathname.match(/\/video\/av(\d+)/i);
    const aid = avMatch?.[1] || url.searchParams.get('aid')?.match(/^\d+$/)?.[0];
    if (aid) return { aid };

    const globalMatch = url.pathname.match(/\/video\/(\d+)(?:\/|$)/);
    if (globalMatch && url.hostname.toLowerCase().endsWith('bilibili.tv')) return { globalId: globalMatch[1] };
    return null;
}

export default async function handler(req, res) {
    if (req.method && req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ ok: false, error: 'طريقة الطلب غير مدعومة.' });
    }

    const rawUrl = req.query?.url;
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
        return res.status(400).json({ ok: false, error: 'ألصق رابط BiliBili أولًا.' });
    }
    if (rawUrl.length > 4096) {
        return res.status(400).json({ ok: false, error: 'الرابط أطول من الحد المسموح.' });
    }

    let inputUrl;
    try {
        inputUrl = new URL(rawUrl.trim());
    } catch {
        return res.status(400).json({ ok: false, error: 'صيغة الرابط غير صحيحة.' });
    }

    if (!['http:', 'https:'].includes(inputUrl.protocol) || inputUrl.username || inputUrl.password || !isDomain(inputUrl.hostname, ROOT_DOMAINS)) {
        return res.status(400).json({ ok: false, error: 'الرابط غير مدعوم. استخدم نطاقًا رسميًا من BiliBili.' });
    }
    inputUrl.protocol = 'https:';

    const deadline = Date.now() + REQUEST_TIMEOUT_MS;
    const headers = {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.7'
    };

    try {
        let finalUrl = inputUrl;
        let pageResponse = null;
        if (isDomain(inputUrl.hostname, SHORT_DOMAINS)) {
            const resolved = await followShortLink(inputUrl, deadline, headers);
            finalUrl = resolved.url;
            pageResponse = resolved.response;
        }

        const isGlobalTv = isDomain(finalUrl.hostname, ['bilibili.tv']);
        let video;

        if (isGlobalTv) {
            if (!pageResponse) {
                const resolvedPage = await followShortLink(finalUrl, deadline, headers);
                finalUrl = resolvedPage.url;
                pageResponse = resolvedPage.response;
            }
            if (!pageResponse.ok) throw createError(`تعذر فتح صفحة الفيديو (HTTP ${pageResponse.status}).`, pageResponse.status === 404 ? 404 : 502);

            const html = await pageResponse.text();
            const title = cleanTitle(readMeta(html, 'og:title') || readMeta(html, 'twitter:title'));
            const thumbnail = readMeta(html, 'og:image') || readMeta(html, 'twitter:image');
            const author = readMeta(html, 'author') || readMeta(html, 'og:video:director') || null;
            const durationValue = Number(readMeta(html, 'video:duration') || readMeta(html, 'duration'));
            const viewsValue = Number(readMeta(html, 'interactionCount'));

            if (!title && !thumbnail) {
                throw createError('وصلت صفحة BiliBili.tv لكن تعذر استخراج العنوان أو الصورة.', 502);
            }
            const ids = extractVideoId(finalUrl);
            video = {
                platform: 'bilibili.tv',
                videoId: ids?.globalId || null,
                title: title || 'فيديو BiliBili.tv',
                thumbnail: thumbnail || null,
                duration: Number.isFinite(durationValue) && durationValue > 0 ? durationValue : null,
                author,
                views: Number.isFinite(viewsValue) && viewsValue > 0 ? viewsValue : null,
                pages: [],
                directUrl: null
            };
        } else {
            const videoId = extractVideoId(finalUrl);
            if (!videoId || videoId.globalId) {
                throw createError('لم يتم العثور على BV أو AV صالح في رابط BiliBili.com.', 400);
            }

            const endpoint = new URL('https://api.bilibili.com/x/web-interface/view');
            if (videoId.bvid) endpoint.searchParams.set('bvid', videoId.bvid);
            else endpoint.searchParams.set('aid', videoId.aid);

            const remaining = deadline - Date.now();
            if (remaining <= 0) throw createError('انتهت مهلة الاتصال بـ BiliBili.', 504);
            const metaResponse = await fetch(endpoint, {
                headers: { ...headers, Referer: 'https://www.bilibili.com/' },
                signal: AbortSignal.timeout(remaining)
            });
            if (!metaResponse.ok) throw createError(`تعذر الوصول إلى BiliBili API (HTTP ${metaResponse.status}).`, 502);

            const metaJson = await metaResponse.json();
            if (metaJson.code !== 0 || !metaJson.data) {
                throw createError(metaJson.message || 'الفيديو غير متاح أو مقيّد من المصدر.', metaJson.code === -404 ? 404 : 502);
            }

            const data = metaJson.data;
            const pages = Array.isArray(data.pages) ? data.pages.map((page) => ({
                page: page.page,
                cid: page.cid,
                part: page.part,
                duration: page.duration
            })) : [];
            video = {
                platform: 'bilibili.com',
                bvid: data.bvid || videoId.bvid || null,
                aid: data.aid || Number(videoId.aid) || null,
                cid: data.cid || pages[0]?.cid || null,
                title: data.title || 'فيديو BiliBili',
                thumbnail: data.pic || null,
                description: data.desc || '',
                duration: data.duration || null,
                author: data.owner?.name || null,
                views: data.stat?.view ?? null,
                stats: {
                    views: data.stat?.view ?? null,
                    likes: data.stat?.like ?? null,
                    comments: data.stat?.reply ?? null,
                    favorites: data.stat?.favorite ?? null,
                    shares: data.stat?.share ?? null
                },
                pages,
                directUrl: null
            };
        }

        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
        return res.status(200).json({ ok: true, video, resolvedUrl: finalUrl.href });
    } catch (error) {
        console.error('BiliReels metadata error:', error);
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        const statusCode = timedOut ? 504 : error?.statusCode || 502;
        const message = timedOut ? 'انتهت مهلة الاتصال بـ BiliBili. أعد المحاولة.' : error?.message || 'تعذر جلب بيانات الفيديو.';
        return res.status(statusCode).json({ ok: false, error: message });
    }
}
