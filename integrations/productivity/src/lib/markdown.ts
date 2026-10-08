export function slugifyHeading(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*`_~]/g, '')
    .replace(/[^a-z0-9\u0600-\u06FF\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'section';
}

export interface TocEntry {
  level: number;
  text: string;
  slug: string;
}

export function extractToc(md: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const slugCounts: Record<string, number> = {};
  const lines = md.split('\n');
  for (const line of lines) {
    const m = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const hashes = m[1];
    const level = hashes.length;
    const rawText = m[2].trim();
    if (!rawText) continue;
    const plain = rawText.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`_~]/g, '').trim();
    const base = slugifyHeading(plain);
    const count = slugCounts[base] ?? 0;
    slugCounts[base] = count + 1;
    const slug = count === 0 ? base : `${base}-${count}`;
    entries.push({ level, text: plain, slug });
  }
  return entries;
}

export function renderMarkdown(md: string): string {
  if (!md) return '';
  let html = md;

  // Code blocks (fenced)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre><code class="lang-${lang}">${escaped}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Headers — with anchor ids for TOC navigation
  const slugCounts: Record<string, number> = {};
  const getSlug = (text: string) => {
    const base = slugifyHeading(text);
    const count = slugCounts[base] ?? 0;
    slugCounts[base] = count + 1;
    return count === 0 ? base : `${base}-${count}`;
  };
  html = html.replace(/^### (.+?)\s*#*\s*$/gm, (_m: string, text: string) => {
    const slug = getSlug(text.trim());
    return `<h3 id="${slug}">${text.trim()}</h3>`;
  });
  html = html.replace(/^## (.+?)\s*#*\s*$/gm, (_m: string, text: string) => {
    const slug = getSlug(text.trim());
    return `<h2 id="${slug}">${text.trim()}</h2>`;
  });
  html = html.replace(/^# (.+?)\s*#*\s*$/gm, (_m: string, text: string) => {
    const slug = getSlug(text.trim());
    return `<h1 id="${slug}">${text.trim()}</h1>`;
  });

  // Bold + italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Blockquote
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // HR
  html = html.replace(/^---$/gm, '<hr/>');

  // Unordered list
  html = html.replace(/^(?:- (.+)(?:\n|$))+/gm, (match) => {
    const items = match.trim().split('\n').map(l => l.replace(/^- /, '').trim());
    return '<ul>' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
  });

  // Ordered list
  html = html.replace(/^(?:\d+\. (.+)(?:\n|$))+/gm, (match) => {
    const items = match.trim().split('\n').map(l => l.replace(/^\d+\. /, '').trim());
    return '<ol>' + items.map(i => `<li>${i}</li>`).join('') + '</ol>';
  });

  // Paragraphs
  html = html.split(/\n\n+/).map(block => {
    if (block.startsWith('<')) return block;
    return `<p>${block.replace(/\n/g, '<br/>')}</p>`;
  }).join('\n');

  return html;
}
