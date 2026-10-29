import { env } from 'cloudflare:workers';

export async function readCategoryColors(ownerId: string) {
  const result = await env.DB.prepare('SELECT category, color FROM event_category_colors WHERE owner_id = ?').bind(ownerId).all<{ category: string; color: string }>();
  return Object.fromEntries(result.results.map(row => [row.category, row.color]));
}

export async function saveCategoryColor(ownerId: string, category: string, color: string | null) {
  if (color === null) {
    await env.DB.prepare('DELETE FROM event_category_colors WHERE owner_id = ? AND category = ?').bind(ownerId, category).run();
  } else {
    await env.DB.prepare('INSERT INTO event_category_colors (owner_id, category, color) VALUES (?, ?, ?) ON CONFLICT(owner_id, category) DO UPDATE SET color = excluded.color').bind(ownerId, category, color).run();
  }
}
