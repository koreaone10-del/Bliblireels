function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}

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

function validBiliBili(url) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase();

  return (
    host === "b23.tv" ||
    host === "bili.im" ||
    host === "bilibili.com" ||
    host.endsWith(".bilibili.com") ||
    host === "bilibili.tv" ||
    host.endsWith(".bilibili.tv")
  );
}

export default async function handler(req) {
  const requestUrl = getRequestUrl(req);

  if (!requestUrl) {
    return json(
      {
        error: "Unable to read request URL"
      },
      400
    );
  }

  const url = requestUrl.searchParams.get("url");

  if (!url) {
    return json(
      {
        error: "Missing url"
      },
      400
    );
  }

  if (!validBiliBili(url)) {
    return json(
      {
        error: "Only BiliBili URLs are supported"
      },
      400
    );
  }

  const base =
    (process.env.VIDEO_ENGINE_URL || "")
      .replace(/\/$/, "");

  if (!base) {
    return json(
      {
        error: "VIDEO_ENGINE_URL is not configured"
      },
      503
    );
  }

  try {
    const response = await fetch(
      `${base}/analyze`,
      {
        method: "POST",

        headers: {
          "content-type": "application/json",
          "accept": "application/json"
        },

        body: JSON.stringify({
          url
        })
      }
    );

    const data =
      await response
        .json()
        .catch(() => ({
          error:
            "Video engine returned an invalid response"
        }));

    return json(
      data,
      response.status
    );

  } catch (error) {

    console.error(
      "[BiliReels] Analyze proxy failed:",
      error
    );

    return json(
      {
        error:
          "Video engine unavailable",

        details:
          error?.message ||
          "Unknown error"
      },
      502
    );
  }
}
