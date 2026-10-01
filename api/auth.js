import { configuredAccessCode, constantTimeEqual, isSameOrigin, isSessionValid, makeSession, readJsonBody, setSessionCookie } from '../lib/access.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');

  const accessCode = configuredAccessCode();
  if (!accessCode) {
    return res.status(503).json({ ok: false, configured: false, error: 'يلزم إعداد BILIREELS_ACCESS_CODE (24 محرفًا أو أكثر) في Vercel قبل تشغيل العامل.' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, authenticated: isSessionValid(req, accessCode) });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'طريقة الطلب غير مدعومة.' });
  }
  if (!isSameOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'رُفض طلب الوصول من مصدر غير موثوق.' });
  }

  const body = readJsonBody(req);
  const submitted = typeof body.code === 'string' ? body.code : '';
  if (!constantTimeEqual(submitted, accessCode)) {
    return res.status(401).json({ ok: false, error: 'رمز الوصول غير صحيح.' });
  }

  const session = makeSession(accessCode);
  setSessionCookie(res, session.value);
  return res.status(200).json({ ok: true, authenticated: true, expiresAt: new Date(session.expires * 1000).toISOString() });
}
