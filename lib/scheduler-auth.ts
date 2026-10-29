export const SCHEDULER_PATH = '/api/internal/notifications/run-due';
const encoder = new TextEncoder();

function payload(timestamp: string, nonce: string) {
  return encoder.encode(`ahead-scheduler-v1\nPOST\n${SCHEDULER_PATH}\n${timestamp}\n${nonce}`);
}

async function signingKey(secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

export async function createSchedulerHeaders(secret: string, now = Date.now(), nonce = crypto.randomUUID()) {
  const timestamp = String(now);
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret, ['sign']), payload(timestamp, nonce));
  return {
    'x-ahead-timestamp': timestamp,
    'x-ahead-nonce': nonce,
    'x-ahead-signature': Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
}

export async function verifySchedulerRequest(request: Request, secret: string, now = Date.now()) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== SCHEDULER_PATH || url.search) return null;
  if (encoder.encode(secret).length < 32) return null;
  const timestamp = request.headers.get('x-ahead-timestamp') ?? '';
  const nonce = request.headers.get('x-ahead-nonce') ?? '';
  const signature = request.headers.get('x-ahead-signature') ?? '';
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 90_000) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(nonce)) return null;
  if (!/^[0-9a-f]{64}$/.test(signature)) return null;
  const bytes = Uint8Array.from(signature.match(/.{2}/g)!, (hex) => Number.parseInt(hex, 16));
  const valid = await crypto.subtle.verify('HMAC', await signingKey(secret, ['verify']), bytes, payload(timestamp, nonce));
  if (!valid) return null;
  // Proxies may expose an empty stream for a body-less POST. Reject any content.
  if (request.body) {
    const reader = request.body.getReader();
    try {
      const first = await reader.read();
      if (!first.done) return null;
    } finally {
      await reader.cancel();
    }
  }
  return nonce;
}
