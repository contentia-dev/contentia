/**
 * Whether a media collection's `accept` list admits an asset. An entry is written as in the HTML
 * `accept` attribute: a MIME type (`image/png`), a wildcard for a whole type (`image/*`, or `*\/*`
 * for any), or a file extension (`.png`), which matches when any of the asset's `names` (its
 * filename, its key) ends in it. Case doesn't matter, and neither do MIME type parameters
 * (`; charset=utf-8`). An empty list admits anything.
 */
export function isAccepted(
  accept: readonly string[],
  asset: { readonly mimeType: string, readonly names: readonly string[] },
): boolean {
  if (accept.length === 0) return true;
  const mimeType = asset.mimeType.split(';')[0]!.trim().toLowerCase();
  const names = asset.names.map(name => name.toLowerCase());
  return accept.some(entry => {
    const wanted = entry.trim().toLowerCase();
    if (wanted.startsWith('.')) return names.some(name => name.endsWith(wanted));
    if (wanted === '*/*') return true;
    if (wanted.endsWith('/*')) return mimeType.startsWith(wanted.slice(0, -1));
    return mimeType === wanted;
  });
}
