const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/*
 * Small in-memory cache.
 *
 * Vercel may reuse the same function instance between requests,
 * which makes this useful for repeated URLs without requiring
 * an external database.
 */
const metadataCache =
  globalThis.__BILIREELS_METADATA_CACHE ||
  new Map();

globalThis.__BILIREELS_METADATA_CACHE =
  metadataCache;


/* =========================================================
   Response helper
   ========================================================= */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store"
      }
    }
  );
}


/* =========================================================
   Request URL
   ========================================================= */

function getRequestUrl(req) {
  try {
    return new URL(
      req.url,
      "https://bliblireels.vercel.app"
    );
  } catch {
    return null;
  }
}


/* =========================================================
   BiliBili URL validation
   ========================================================= */

function validBiliBili(value) {
  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  const host =
    parsed.hostname
      .toLowerCase()
      .replace(/\.$/, "");

  return (
    host === "b23.tv" ||
    host === "bili.im" ||
    host === "bilibili.com" ||
    host.endsWith(".bilibili.com") ||
    host === "bilibili.tv" ||
    host.endsWith(".bilibili.tv")
  );
}


/* =========================================================
   Resolve short BiliBili URLs
   ========================================================= */

async function resolveShortUrl(inputUrl) {
  let parsed;

  try {
    parsed = new URL(inputUrl);
  } catch {
    return inputUrl;
  }

  const host =
    parsed.hostname
      .toLowerCase()
      .replace(/\.$/, "");

  const isShort =
    host === "b23.tv" ||
    host === "bili.im";

  if (!isShort) {
    return inputUrl;
  }

  try {
    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => controller.abort(),
        8000
      );

    const response =
      await fetch(
        inputUrl,
        {
          method: "GET",

          redirect: "follow",

          headers: {
            "User-Agent":
              "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",

            "Accept":
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          },

          signal:
            controller.signal
        }
      );

    clearTimeout(timeout);

    if (
      response.url &&
      validBiliBili(response.url)
    ) {
      return response.url;
    }

  } catch (error) {

    console.warn(
      "[BiliReels] Short URL resolution failed:",
      error?.message || error
    );
  }

  return inputUrl;
}


/* =========================================================
   Extract BVID / AID
   ========================================================= */

function extractVideoId(url) {

  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const fullUrl =
    decodeURIComponent(
      parsed.href
    );

  /*
   * Standard BV ID.
   *
   * Example:
   * BV1xx411c7mD
   */
  const bvMatch =
    fullUrl.match(
      /BV[0-9A-Za-z]{10}/i
    );

  if (bvMatch) {
    return {
      type: "bvid",
      id: bvMatch[0]
    };
  }


  /*
   * Legacy AV ID.
   *
   * Example:
   * av170001
   */
  const avMatch =
    fullUrl.match(
      /(?:\/|=|^)av(\d+)/i
    );

  if (avMatch) {
    return {
      type: "aid",
      id: avMatch[1]
    };
  }


  /*
   * Some URLs may expose aid directly.
   */
  const aid =
    parsed.searchParams.get(
      "aid"
    );

  if (
    aid &&
    /^\d+$/.test(aid)
  ) {
    return {
      type: "aid",
      id: aid
    };
  }


  /*
   * Some URLs may expose bvid directly.
   */
  const bvid =
    parsed.searchParams.get(
      "bvid"
    );

  if (
    bvid &&
    /^BV[0-9A-Za-z]{10}$/i.test(
      bvid
    )
  ) {
    return {
      type: "bvid",
      id: bvid
    };
  }


  return null;
}


/* =========================================================
   Fetch BiliBili metadata
   ========================================================= */

async function fetchBiliMetadata(videoId) {

  const endpoint =
    new URL(
      "https://api.bilibili.com/x/web-interface/view"
    );

  endpoint.searchParams.set(
    videoId.type,
    videoId.id
  );


  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      10000
    );


  let response;

  try {

    response =
      await fetch(
        endpoint.toString(),
        {
          method: "GET",

          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",

            "Referer":
              "https://www.bilibili.com/",

            "Accept":
              "application/json,text/plain,*/*"
          },

          signal:
            controller.signal
        }
      );

  } finally {

    clearTimeout(timeout);
  }


  if (!response.ok) {

    throw new Error(
      `BiliBili API HTTP ${response.status}`
    );
  }


  let payload;

  try {

    payload =
      await response.json();

  } catch {

    throw new Error(
      "BiliBili API returned invalid JSON."
    );
  }


  if (
    !payload ||
    payload.code !== 0 ||
    !payload.data
  ) {

    const apiMessage =
      payload?.message ||
      "BiliBili could not return video metadata.";

    throw new Error(
      apiMessage
    );
  }


  return payload.data;
}


/* =========================================================
   Normalize metadata
   ========================================================= */

function normalizeMetadata(
  info,
  originalUrl,
  resolvedUrl,
  videoId
) {

  const owner =
    info.owner || {};

  const stat =
    info.stat || {};

  const pages =
    Array.isArray(info.pages)
      ? info.pages
      : [];


  const duration =
    Number(
      info.duration
    ) || 0;


  const response = {

    /*
     * IDs
     */
    id:
      info.bvid ||
      (
        videoId.type === "aid"
          ? videoId.id
          : null
      ),

    bvid:
      info.bvid ||
      null,

    aid:
      info.aid ||
      null,


    /*
     * Main metadata
     */
    title:
      info.title ||
      "BiliBili Video",

    description:
      info.desc ||
      "",

    duration,

    thumbnail:
      info.pic ||
      null,


    /*
     * Author
     */
    author:
      owner.name ||
      "",

    authorId:
      owner.mid ||
      null,

    authorAvatar:
      owner.face ||
      null,


    /*
     * Classification
     */
    category:
      info.tname ||
      "",


    /*
     * Statistics
     */
    views:
      Number(
        stat.view
      ) || 0,

    likes:
      Number(
        stat.like
      ) || 0,

    comments:
      Number(
        stat.reply
      ) || 0,


    /*
     * Multi-part information
     */
    videos:
      Number(
        info.videos
      ) || 1,

    pages:
      pages.map(
        (page) => ({
          cid:
            page.cid ||
            null,

          page:
            page.page ||
            1,

          part:
            page.part ||
            "",

          duration:
            Number(
              page.duration
            ) || 0
        })
      ),


    /*
     * URLs
     */
    webpageUrl:
      resolvedUrl,

    sourceUrl:
      resolvedUrl,

    originalUrl,


    /*
     * Engine information
     *
     * The processing backend still receives
     * the original source URL.
     */
    extractor:
      "bilibili-api",

    extractorKey:
      "bilibili-api",


    /*
     * Internal information useful for
     * the next processing phases.
     */
    metadataSource:
      "bilibili",

    analyzedAt:
      new Date().toISOString()
  };


  return response;
}


/* =========================================================
   Cache
   ========================================================= */

function getCached(key) {

  const item =
    metadataCache.get(
      key
    );

  if (!item) {
    return null;
  }


  if (
    Date.now() -
      item.createdAt >
    CACHE_TTL
  ) {

    metadataCache.delete(
      key
    );

    return null;
  }


  return item.data;
}


function setCached(
  key,
  data
) {

  metadataCache.set(
    key,
    {
      createdAt:
        Date.now(),

      data
    }
  );


  /*
   * Keep the cache small.
   */
  if (
    metadataCache.size >
    100
  ) {

    const oldest =
      metadataCache.keys()
        .next()
        .value;

    if (oldest) {
      metadataCache.delete(
        oldest
      );
    }
  }
}


/* =========================================================
   Analyze
   ========================================================= */

export default async function handler(req) {

  const started =
    Date.now();


  if (
    req.method &&
    req.method !== "GET"
  ) {

    return json(
      {
        error:
          "Method not allowed"
      },
      405
    );
  }


  const requestUrl =
    getRequestUrl(req);


  if (!requestUrl) {

    return json(
      {
        error:
          "Unable to read request URL"
      },
      400
    );
  }


  const originalUrl =
    requestUrl.searchParams
      .get("url");


  if (!originalUrl) {

    return json(
      {
        error:
          "Missing url"
      },
      400
    );
  }


  if (
    !validBiliBili(
      originalUrl
    )
  ) {

    return json(
      {
        error:
          "Only BiliBili URLs are supported"
      },
      400
    );
  }


  try {

    console.log(
      "[BiliReels] FAST ANALYZE:",
      originalUrl
    );


    /*
     * Resolve b23.tv / bili.im.
     *
     * Normal BiliBili URLs skip this completely.
     */
    const resolvedUrl =
      await resolveShortUrl(
        originalUrl
      );


    console.log(
      "[BiliReels] Resolved:",
      resolvedUrl
    );


    /*
     * Extract BV / AV.
     */
    const videoId =
      extractVideoId(
        resolvedUrl
      );


    if (!videoId) {

      return json(
        {
          error:
            "Could not detect a BiliBili video ID (BV/AV) from this URL.",

          code:
            "VIDEO_ID_NOT_FOUND",

          originalUrl,

          resolvedUrl
        },
        422
      );
    }


    /*
     * Cache key.
     */
    const cacheKey =
      `${videoId.type}:${videoId.id.toLowerCase()}`;


    /*
     * Cache HIT.
     */
    const cached =
      getCached(
        cacheKey
      );


    if (cached) {

      console.log(
        `[BiliReels] CACHE HIT in ${Date.now() - started}ms`,
        cacheKey
      );


      return json(
        {
          ...cached,

          cached:
            true,

          analyzeMs:
            Date.now() - started
        },
        200
      );
    }


    /*
     * Real BiliBili metadata request.
     *
     * IMPORTANT:
     *
     * NO yt-dlp here.
     * NO video download here.
     */
    const info =
      await fetchBiliMetadata(
        videoId
      );


    const metadata =
      normalizeMetadata(
        info,
        originalUrl,
        resolvedUrl,
        videoId
      );


    /*
     * Save metadata.
     */
    setCached(
      cacheKey,
      metadata
    );


    console.log(
      `[BiliReels] FAST ANALYZE OK in ${Date.now() - started}ms`,
      {
        bvid:
          metadata.bvid,

        title:
          metadata.title
      }
    );


    return json(
      {
        ...metadata,

        cached:
          false,

        analyzeMs:
          Date.now() - started
      },
      200
    );


  } catch (error) {

    console.error(
      "[BiliReels] FAST ANALYZE failed:",
      error
    );


    const message =
      error?.name ===
      "AbortError"

        ? "BiliBili metadata request timed out."

        : (
            error?.message ||
            "Unable to analyze BiliBili video."
          );


    return json(
      {
        error:
          message,

        code:
          "METADATA_FAILED",

        originalUrl
      },
      502
    );
  }
}
