// Netlify Function: lightweight resolver/proxy metadata layer.
// IMPORTANT: video bytes must NOT pass through Netlify Functions because Netlify
// Functions have a 6 MB buffered / 20 MB streamed response limit.

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type'
    }});
  }

  const api = (process.env.VIDEO_API_URL || '').replace(/\/$/, '');
  if (!api) return json({ ok:false, error:'VIDEO_API_URL is not configured on Netlify.' }, 503);

  const url = new URL(request.url).searchParams.get('url')?.trim();
  if (!url) return json({ ok:false, error:'Missing url.' }, 400);

  try {
    const upstream = await fetch(`${api}/resolve?url=${encodeURIComponent(url)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(25000)
    });
    const text = await upstream.text();
    let data; try { data = JSON.parse(text); } catch { data = { ok:false, error:text || 'Invalid backend response.' }; }
    if (!upstream.ok || !data.ok) return json({ ok:false, error:data.error || 'Backend resolver failed.' }, upstream.status || 502);

    // Never trust a backend-provided absolute URL blindly; rebuild the stream URL
    // against the configured backend origin.
    const streamUrl = `${api}/stream?url=${encodeURIComponent(url)}`;
    return json({ ok:true, ...data, streamUrl });
  } catch (error) {
    return json({ ok:false, error:error?.message || 'Backend unavailable.' }, 502);
  }
};
