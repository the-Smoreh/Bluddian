import { cookies } from 'next/headers';
import { audit, destroySession, SESSION_COOKIE } from '@/lib/auth';
import { CSRF_COOKIE, guard, handler, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async (req) => {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);

  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);

  await audit('logout');
  return json({ ok: true });
});
