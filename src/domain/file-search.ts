export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function tokenizeSearch(value: string | undefined): string[] {
  return normalizeSearchText(value ?? '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function normalizeExtensions(values: string[] | undefined): string[] {
  if (!values?.length) return [];
  const result = new Set<string>();
  for (const value of values) {
    for (const part of value.split(',')) {
      const extension = part.trim().toLowerCase().replace(/^\./, '');
      if (extension) result.add(extension);
    }
  }
  return [...result];
}

function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return match?.[1]?.toLowerCase() ?? '';
}

function extensionOfMime(mimeType: string | undefined): string {
  if (!mimeType) return '';
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.split('+')[0]?.trim().toLowerCase();
  return subtype ?? '';
}

export function fileMatchesName(
  filename: string,
  tokens: string[],
  extensions: string[],
  mimeType?: string
): boolean {
  if (!tokens.length && !extensions.length) return false;
  const normalized = normalizeSearchText(filename);
  if (tokens.length && !tokens.every((token) => normalized.includes(token))) return false;
  if (extensions.length) {
    const extension = extensionOf(filename);
    const mimeExtension = extensionOfMime(mimeType);
    if (!extensions.includes(extension) && !extensions.includes(mimeExtension)) return false;
  }
  return true;
}
