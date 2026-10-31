import type { EvaDiscussionSummary, EvaPost } from '../domain/types.js';

/**
 * Convierte el HTML de un mensaje de foro en texto plano legible para la terminal.
 * Colapsa los bloques a saltos de línea y quita las etiquetas residuales.
 */
export function htmlToText(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Formatea una discusión para una línea de lista: autor, fecha y cantidad de respuestas. */
export function formatDiscussion(discussion: EvaDiscussionSummary): string {
  const bits: string[] = [];
  if (discussion.pinned) bits.push('📌');
  if (discussion.author) bits.push(discussion.author);
  const date = formatDate(discussion.createdAt);
  if (date) bits.push(date);
  if (typeof discussion.replyCount === 'number') bits.push(`${discussion.replyCount} resp.`);
  if (discussion.unread) bits.push(`${discussion.unread} sin leer`);
  return bits.length ? `${discussion.name} — ${bits.join(' · ')}` : discussion.name;
}

/** Formatea el encabezado de un mensaje: asunto, autor y fecha. */
export function formatPostHeader(post: EvaPost, depth = 0): string {
  const author = post.author ?? 'sin autor';
  const date = formatDate(post.createdAt) ?? '';
  const indent = depth > 0 ? '  '.repeat(depth) : '';
  const edited = post.modifiedAt && post.createdAt && post.modifiedAt !== post.createdAt ? ' (editado)' : '';
  return `${indent}${post.subject} — ${author}${date ? ` · ${date}` : ''}${edited}`;
}

/** Formatea una fecha ISO corta a `dd/mm/aaaa` (o la devuelve tal cual si no se puede parsear). */
export function formatDate(value: string | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${parsed.getFullYear()}`;
}

/** Ordena los posts por su posición en el hilo (raíz primero, respuestas agrupadas). */
export function orderPosts(posts: EvaPost[]): EvaPost[] {
  const byId = new Map(posts.map((post) => [post.id, post]));
  const children = new Map<number, EvaPost[]>();
  const roots: EvaPost[] = [];
  for (const post of posts) {
    const parent = post.parentId && byId.has(post.parentId) ? post.parentId : undefined;
    if (parent === undefined) {
      roots.push(post);
      continue;
    }
    const bucket = children.get(parent) ?? [];
    bucket.push(post);
    children.set(parent, bucket);
  }
  const ordered: EvaPost[] = [];
  const seen = new Set<number>();
  const walk = (node: EvaPost): void => {
    ordered.push(node);
    seen.add(node.id);
    const kids = children.get(node.id);
    if (kids) {
      for (const kid of kids) {
        if (!seen.has(kid.id)) walk(kid);
      }
    }
  };
  // Arrancamos por los nodos sin padre conocido; si el orden por id dejó alguno
  // suelto, lo cubrimos al final para no perder mensajes.
  for (const root of roots) {
    if (!seen.has(root.id)) walk(root);
  }
  for (const post of posts) {
    if (!seen.has(post.id)) walk(post);
  }
  return ordered;
}

/** Devuelve la profundidad de un post dentro del hilo (para sangrado). */
export function postDepth(post: EvaPost, all: EvaPost[]): number {
  const byId = new Map(all.map((item) => [item.id, item]));
  let depth = 0;
  let current = post;
  while (current.parentId && byId.has(current.parentId) && depth < 20) {
    depth += 1;
    current = byId.get(current.parentId)!;
  }
  return depth;
}
