import * as cheerio from 'cheerio';

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return undefined;
}

export function unixToIso(value: unknown): string | undefined {
  const seconds = asNumber(value);
  if (!seconds || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

export function cleanText(value: string | undefined | null): string {
  return (value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function htmlToText(html: string | undefined | null): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  $('br').replaceWith('\n');
  $('p, div, li, tr, h1, h2, h3, h4, h5, h6').each((_index, element) => {
    const node = $(element);
    node.append('\n');
  });
  return cleanText($.root().text().replace(/\n{2,}/g, '\n'));
}

export function absoluteUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

export function getPathFromUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

export function stripTokenFromUrl(value: string): string {
  try {
    const url = new URL(value);
    url.searchParams.delete('token');
    return url.toString();
  } catch {
    return value.replace(/([?&])token=[^&]*/i, '$1').replace(/[?&]$/, '');
  }
}

export function truncate(value: string, max = 300): string {
  const normalized = cleanText(value);
  return normalized.length > max ? `${normalized.slice(0, Math.max(0, max - 1))}…` : normalized;
}

export function uniqueBy<T>(items: T[], key: (item: T) => string | number | undefined): T[] {
  const seen = new Set<string | number>();
  return items.filter((item) => {
    const value = key(item);
    if (value === undefined) return true;
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
