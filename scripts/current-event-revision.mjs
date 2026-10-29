// Existing feature tests simulate opening the latest editor before saving.
// Conflict tests must send their own captured revision (or bypass this helper).
export async function withCurrentEventRevision(db, url, method, owner, body) {
  const match = /^\/api\/events\/(\d+)$/.exec(url);
  if (method !== 'PATCH' || !match || !owner || !body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'revision')) return body;
  const event = await db.prepare('SELECT notification_revision FROM events WHERE id = ? AND owner_id = ?').bind(Number(match[1]), owner).first();
  return event ? { ...body, revision: event.notification_revision } : body;
}
