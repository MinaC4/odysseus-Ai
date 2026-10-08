// Preserve bare domains and LAN addresses while rejecting executable schemes.
export function normalizeBookmarkUrl(raw: string): string {
  const value = raw.trim();
  if (!value || /\s/.test(value)) throw new Error('Enter a valid web address without spaces.');
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value) && !/^[\w.-]+:\d+(?:\/|$)/.test(value)) throw new Error('Only HTTP and HTTPS links are supported.');
  const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Enter an HTTP or HTTPS address without embedded credentials.');
  return url.href;
}
