import { describe, expect, it } from 'vitest';
import type { EvaDiscussionSummary, EvaPost } from '../src/domain/types.js';
import {
  formatDate,
  formatDiscussion,
  formatPostHeader,
  htmlToText,
  orderPosts,
  postDepth
} from '../src/tui/foros.js';

describe('htmlToText', () => {
  it('quita etiquetas y colapsa bloques en saltos de línea', () => {
    expect(htmlToText('<p>Hola</p><p>Mundo</p>')).toBe('Hola\nMundo');
  });

  it('convierte <br> y listas en saltos y viñetas', () => {
    expect(htmlToText('uno<br>dos')).toBe('uno\ndos');
    expect(htmlToText('<ul><li>a</li><li>b</li></ul>')).toBe('• a\n• b');
  });

  it('decodifica entidades comunes', () => {
    expect(htmlToText('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;&nbsp;f')).toBe('a & b <c> "d" \'e\' f');
  });

  it('devuelve vacío si no hay HTML', () => {
    expect(htmlToText(undefined)).toBe('');
    expect(htmlToText('')).toBe('');
  });
});

describe('formatDate', () => {
  it('formatea fechas ISO a dd/mm/aaaa', () => {
    expect(formatDate('2026-10-30T12:00:00Z')).toMatch(/^\d{2}\/\d{2}\/2026$/);
  });

  it('devuelve vacío sin fecha y el valor crudo si no se parsea', () => {
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('no-es-fecha')).toBe('no-es-fecha');
  });
});

describe('formatDiscussion', () => {
  const base: EvaDiscussionSummary = {
    id: 1,
    forumId: 10,
    name: 'Duda con el práctico',
    author: 'Ana',
    createdAt: '2026-10-01T10:00:00Z',
    replyCount: 3,
    url: 'https://eva.fing.edu.uy/mod/forum/discuss.php?d=1'
  };

  it('incluye autor, fecha y respuestas', () => {
    const text = formatDiscussion(base);
    expect(text).toContain('Duda con el práctico');
    expect(text).toContain('Ana');
    expect(text).toContain('3 resp.');
  });

  it('marca fijadas y no leídas', () => {
    const text = formatDiscussion({ ...base, pinned: true, unread: 2 });
    expect(text).toContain('📌');
    expect(text).toContain('2 sin leer');
  });
});

describe('formatPostHeader', () => {
  it('arma asunto, autor y fecha', () => {
    const post: EvaPost = {
      id: 1,
      discussionId: 10,
      subject: 'Re: Duda',
      author: 'Ana',
      createdAt: '2026-10-01T10:00:00Z',
      attachments: []
    };
    const header = formatPostHeader(post);
    expect(header).toContain('Re: Duda');
    expect(header).toContain('Ana');
  });

  it('sangra según profundidad', () => {
    const post: EvaPost = { id: 1, discussionId: 10, subject: 'hola', attachments: [] };
    expect(formatPostHeader(post, 2)).toMatch(/^ {4}hola/);
  });
});

describe('orderPosts y postDepth', () => {
  const posts: EvaPost[] = [
    { id: 3, discussionId: 1, parentId: 1, subject: 'hija', attachments: [] },
    { id: 1, discussionId: 1, subject: 'raíz', attachments: [] },
    { id: 2, discussionId: 1, parentId: 1, subject: 'respuesta', attachments: [] },
    { id: 4, discussionId: 1, parentId: 2, subject: 'sub-respuesta', attachments: [] }
  ];

  it('ordena raíces primero y agrupa respuestas', () => {
    const ordered = orderPosts(posts);
    expect(ordered.map((post) => post.id)).toEqual([1, 3, 2, 4]);
  });

  it('calcula la profundidad de cada mensaje', () => {
    const ordered = orderPosts(posts);
    const byId = new Map(ordered.map((post) => [post.id, post]));
    expect(postDepth(byId.get(1)!, ordered)).toBe(0);
    expect(postDepth(byId.get(2)!, ordered)).toBe(1);
    expect(postDepth(byId.get(4)!, ordered)).toBe(2);
  });

  it('conserva los mensajes con parentId colgante al final', () => {
    const orphan: EvaPost = { id: 99, discussionId: 1, parentId: 500, subject: 'huérfano', attachments: [] };
    const ordered = orderPosts([...posts, orphan]);
    expect(ordered[ordered.length - 1]!.id).toBe(99);
    expect(ordered).toHaveLength(5);
  });
});
