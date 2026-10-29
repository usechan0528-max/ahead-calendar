import { env } from 'cloudflare:workers';
import { getOwnerId } from '@/app/api/owner';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!await getOwnerId()) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  // Kakao's JavaScript key is intentionally public; restrict its allowed origins in Kakao Developers.
  // Explicit allowlist: never serialize Env or expose any other credential.
  const javascriptKey = env.KAKAO_MAP_JAVASCRIPT_KEY?.trim();
  return Response.json(javascriptKey ? { configured: true, javascriptKey } : { configured: false },
    { headers: { 'Cache-Control': 'private, no-store' } });
}
