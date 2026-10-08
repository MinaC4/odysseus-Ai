export interface ImportableQuickLink {
  title: string;
  url: string;
  type: string;
  icon: string | null;
  category: string;
  description: string | null;
  tags: string[];
  favorite: boolean;
}

export function parseQuickLauncherUrl(value: string): URL | null {
  try {
    const parsed = new URL(value.trim());
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password ? parsed : null;
  } catch { return null; }
}

export function validateQuickLauncherImport(input: unknown, maxItems = 250): ImportableQuickLink[] {
  if (!Array.isArray(input)) throw new Error('Choose a JSON array exported from Quick Launcher.');
  if (input.length > maxItems) throw new Error(`Import is limited to ${maxItems} shortcuts at a time.`);
  return input.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Item ${index + 1} is not a shortcut object.`);
    const item = raw as Record<string, unknown>;
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 100) throw new Error(`Item ${index + 1} needs a title of 1–100 characters.`);
    const url = typeof item.url === 'string' ? parseQuickLauncherUrl(item.url) : null;
    if (!url) throw new Error(`Item ${index + 1} needs a valid HTTP(S) URL without embedded credentials.`);
    const allowedCategories = ['ai', 'coding-architecture', 'dev', 'research', 'automation', 'other'];
    if (typeof item.category === 'string' && item.category.trim() && !allowedCategories.includes(item.category.trim())) {
      throw new Error(`Item ${index + 1} uses unsupported category “${item.category.trim()}”. Use one of: ${allowedCategories.join(', ')}.`);
    }
    const tags = Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean).slice(0, 20) : [];
    return {
      title: item.title.trim(), url: url.href, type: item.type === 'internal' ? 'internal' : 'external',
      icon: typeof item.icon === 'string' ? item.icon.trim().slice(0, 20) || null : null,
      category: typeof item.category === 'string' && item.category.trim() ? item.category.trim().slice(0, 80) : 'other',
      description: typeof item.description === 'string' ? item.description.trim().slice(0, 2000) || null : null,
      tags, favorite: item.favorite === true,
    };
  });
}

export function reorderQuickLinks<T extends { id: string; sort_order: number; created_at: string }>(items: T[], sourceId: string, targetId: string): T[] | null {
  if (sourceId === targetId) return null;
  const ordered = [...items].sort((a, b) => a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at));
  const sourceIndex = ordered.findIndex((item) => item.id === sourceId);
  const targetIndex = ordered.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return null;
  const [moved] = ordered.splice(sourceIndex, 1);
  ordered.splice(targetIndex, 0, moved);
  return ordered.map((item, index) => ({ ...item, sort_order: index }));
}
