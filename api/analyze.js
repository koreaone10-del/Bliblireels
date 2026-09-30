function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      }
    }
  );
}


function validBiliBili(url) {

  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const host =
    parsed.hostname.toLowerCase();

  return (
    host === 'b23.tv' ||
    host.endsWith('bilibili.com')
  );
}


export default async function handler(req) {

  const url =
    new URL(req.url)
      .searchParams
      .get('url');


  if (!url) {
    return json(
      { error: 'Missing url' },
      400
    );
  }


  if (!validBiliBili(url)) {
    return json(
      {
        error:
          'Only BiliBili URLs are supported'
      },
      400
    );
  }


  const base =
    (process.env.VIDEO_ENGINE_URL || '')
      .replace(/\/$/, '');


  if (!base) {

    return json(
      {
        error:
          'VIDEO_ENGINE_URL is not configured'
      },
      503
    );

  }


  try {

    const response =
      await fetch(
        `${base}/analyze`,
        {
          method: 'POST',

          headers: {
            'content-type':
              'application/json'
          },

          body: JSON.stringify({
            url
          })
        }
      );


    const data =
      await response
        .json()
        .catch(() => ({}));


    return json(
      data,
      response.status
    );


  } catch {

    return json(
      {
        error:
          'Video engine unavailable'
      },
      502
    );

  }

}
