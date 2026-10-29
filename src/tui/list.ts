export interface ListWindow {
  start: number;
  end: number;
}

/**
 * Devuelve el fragmento de la lista que cabe en pantalla, centrado en el cursor.
 */
export function listWindow(length: number, cursor: number, size: number): ListWindow {
  if (length <= 0 || size <= 0) return { start: 0, end: 0 };
  if (length <= size) return { start: 0, end: length };
  const maxStart = length - size;
  const start = Math.min(Math.max(cursor - Math.floor(size / 2), 0), maxStart);
  return { start, end: start + size };
}

export function clamp(value: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(value, 0), length - 1);
}

export function fitText(value: string, width: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (width <= 0) return '';
  if (clean.length <= width) return clean;
  if (width <= 1) return clean.slice(0, width);
  return `${clean.slice(0, width - 1)}…`;
}

export function wrapText(value: string, width: number, maxLines = Number.POSITIVE_INFINITY): string[] {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || width <= 0) return [];
  const words = text.split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = '';
    let rest = word;
    while (rest.length > width) {
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    current = rest;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
