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


export default async function handler(req) {

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


  /* GET JOB STATUS */

  if (req.method === 'GET') {

    const jobId =
      new URL(req.url)
        .searchParams
        .get('jobId');


    if (!jobId) {

      return json(
        {
          error: 'Missing jobId'
        },
        400
      );

    }


    try {

      const response =
        await fetch(
          `${base}/jobs/${encodeURIComponent(jobId)}`
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


  /* CREATE JOB */

  if (req.method !== 'POST') {

    return json(
      {
        error: 'Method not allowed'
      },
      405
    );

  }


  try {

    const body =
      await req.json();


    if (!body.sourceUrl) {

      return json(
        {
          error:
            'sourceUrl is required'
        },
        400
      );

    }


    const response =
      await fetch(
        `${base}/jobs`,
        {
          method: 'POST',

          headers: {
            'content-type':
              'application/json'
          },

          body: JSON.stringify(body)
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
