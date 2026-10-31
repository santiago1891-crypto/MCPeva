import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../src/tui/App.js';
import type { EvaService } from '../src/services/eva-service.js';

const ESC = String.fromCharCode(27);

const course = {
  id: 1442,
  shortname: 'GAL1-2S',
  fullname: 'Geometría y Álgebra Lineal 1',
  displayName: 'GAL1-2S Geometría y Álgebra Lineal 1',
  url: 'https://eva.fing.edu.uy/course/view.php?id=1442'
};

const forum = {
  id: 55,
  courseId: 1442,
  cmid: 70000,
  name: 'Foro de dudas',
  type: 'general',
  url: 'https://eva.fing.edu.uy/mod/forum/view.php?id=70000',
  discussionCount: 2
};

const forumModule = {
  id: 70000,
  courseId: 1442,
  sectionId: 11,
  sectionNumber: 25,
  name: 'Foro de dudas',
  modname: 'forum',
  visible: true,
  userVisible: true,
  instanceId: 55,
  contents: []
};

const section = {
  id: 11,
  courseId: 1442,
  number: 25,
  name: 'Foros',
  visible: true,
  userVisible: true,
  modules: [forumModule]
};

const contents = {
  course,
  sections: [section],
  source: 'webservice' as const,
  fetchedAt: '2026-10-30T00:00:00.000Z'
};

const discussions = [
  {
    id: 900,
    forumId: 55,
    name: 'Duda con el práctico 9',
    author: 'Ana',
    createdAt: '2026-10-20T10:00:00Z',
    replyCount: 1,
    url: 'https://eva.fing.edu.uy/mod/forum/discuss.php?d=900'
  },
  {
    id: 901,
    forumId: 55,
    name: 'Material de la clase',
    author: 'Luis',
    createdAt: '2026-10-21T09:00:00Z',
    replyCount: 0,
    url: 'https://eva.fing.edu.uy/mod/forum/discuss.php?d=901'
  }
];

const posts = [
  {
    id: 1,
    discussionId: 900,
    subject: 'Hola',
    author: 'Ana',
    createdAt: '2026-10-20T10:00:00Z',
    messageHtml: '<p>adjunto(s) del enunciado.</p>',
    attachments: [
      {
        filename: 'enunciado.pdf',
        size: 2048,
        mimeType: 'application/pdf',
        url: 'https://eva.fing.edu.uy/pluginfile.php/1/enunciado.pdf'
      }
    ]
  },
  {
    id: 2,
    discussionId: 900,
    parentId: 1,
    subject: 'Re: Hola',
    author: 'Luis',
    createdAt: '2026-10-20T12:00:00Z',
    message: 'ok',
    attachments: []
  }
];

function stubService(): EvaService {
  return {
    getMyCourses: async () => [course],
    getCourseContents: async () => contents,
    getActivity: async () => ({
      module: forumModule,
      title: 'Foro de dudas',
      description: 'Espacio para consultar dudas del curso.',
      files: [],
      links: [],
      metadata: {},
      forum,
      discussions,
      source: 'webservice' as const
    }),
    getForumDiscussions: async () => discussions,
    getDiscussionPosts: async () => posts,
    searchContent: async () => [],
    searchFiles: async () => [],
    downloadFile: async () => ({
      filename: 'enunciado.pdf',
      path: '/tmp/enunciado.pdf',
      size: 2048,
      mimeType: 'application/pdf',
      sourceUrl: 'https://eva.fing.edu.uy/pluginfile.php/1/enunciado.pdf'
    })
  } as unknown as EvaService;
}

async function waitForFrame(lastFrame: () => string | undefined, expected: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((lastFrame() ?? '').includes(expected)) return;
    if (Date.now() > deadline) {
      throw new Error(`No apareció "${expected}" en el frame:\n${lastFrame() ?? ''}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

/**
 * Espera a que un frame se asiente y los handlers de `useInput` de ink
 * (suscritos en un `useEffect`, después de pintar) queden activos.
 * Sin esto, una tecla enviada justo al aparecer la pantalla puede perderse.
 */
async function settle(ms = 60): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Avanza una pantalla: espera la marca exclusiva de la pantalla actual,
 * manda Enter y espera la marca exclusiva de la siguiente.
 * Cada `waitForFrame` usa un texto que solo aparece en su pantalla, porque el
 * pie de ayuda se repite entre pantallas y provocaría avances prematuros.
 */
async function enter(
  lastFrame: () => string | undefined,
  stdin: NodeJS.ReadStream,
  from: string,
  to: string
): Promise<void> {
  await waitForFrame(lastFrame, from);
  await settle();
  stdin.write('\r');
  await waitForFrame(lastFrame, to);
}

/** Marca exclusiva de cada pantalla en la ruta cursos → foro → discusión. */
const EN_CURSOS = '1 curso(s)';
const EN_OUTLINE = 'Enter abrir actividad';
const EN_ACTIVIDAD = 'Enter para abrir';
const EN_FORO = 'Enter para leer los mensajes';
const EN_DISCUSION = 'espacio para expandir';

describe('Foros (TUI)', () => {
  it('entra al foro desde la actividad y lista las discusiones', async () => {
    const { lastFrame, stdin, unmount } = render(<App service={stubService()} userLabel="Test" />);

    await enter(lastFrame, stdin, EN_CURSOS, EN_OUTLINE);
    await enter(lastFrame, stdin, EN_OUTLINE, EN_ACTIVIDAD);
    await enter(lastFrame, stdin, EN_ACTIVIDAD, EN_FORO);

    expect(lastFrame()).toContain('2 discusión(es)');
    expect(lastFrame()).toContain('Duda con el práctico 9');
    expect(lastFrame()).toContain('Material de la clase');

    unmount();
  });

  it('abre una discusión, expande y descarga el adjunto', async () => {
    const { lastFrame, stdin, unmount } = render(<App service={stubService()} userLabel="Test" />);

    await enter(lastFrame, stdin, EN_CURSOS, EN_OUTLINE);
    await enter(lastFrame, stdin, EN_OUTLINE, EN_ACTIVIDAD);
    await enter(lastFrame, stdin, EN_ACTIVIDAD, EN_FORO);
    await enter(lastFrame, stdin, EN_FORO, EN_DISCUSION);

    expect(lastFrame()).toContain('2 mensaje(s)');
    expect(lastFrame()).toContain('Hola');
    expect(lastFrame()).toContain('adjunto(s)');

    // El mensaje raíz está seleccionado: con espacio se expande y listamos el adjunto.
    await settle();
    stdin.write(' ');
    await waitForFrame(lastFrame, '📎 enunciado.pdf');

    // d descarga el adjunto seleccionado.
    await settle();
    stdin.write('d');
    await waitForFrame(lastFrame, 'Descargado: /tmp/enunciado.pdf');

    unmount();
  });

  it('vuelve de la discusión al foro con Esc', async () => {
    const { lastFrame, stdin, unmount } = render(<App service={stubService()} userLabel="Test" />);

    await enter(lastFrame, stdin, EN_CURSOS, EN_OUTLINE);
    await enter(lastFrame, stdin, EN_OUTLINE, EN_ACTIVIDAD);
    await enter(lastFrame, stdin, EN_ACTIVIDAD, EN_FORO);
    await enter(lastFrame, stdin, EN_FORO, EN_DISCUSION);

    await settle();
    stdin.write(ESC);
    await waitForFrame(lastFrame, EN_FORO);

    expect((lastFrame() ?? '').includes(EN_DISCUSION)).toBe(false);
    expect(lastFrame()).toContain('Duda con el práctico 9');

    unmount();
  });
});
