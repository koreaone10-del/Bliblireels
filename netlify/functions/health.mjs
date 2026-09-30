export default async () => {
  return new Response(JSON.stringify({
    ok: true,
    service: 'BiliReels API',
    phase: 2,
    engine: 'client-side ffmpeg.wasm'
  }), {
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
};
