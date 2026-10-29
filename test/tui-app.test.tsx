import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../src/tui/App.js';
import type { EvaService } from '../src/services/eva-service.js';

const course = {
  id: 1442,
  shortname: 'GAL1-2S',
  fullname: 'Geometría y Álgebra Lineal 1',
  displayName: 'GAL1-2S Geometría y Álgebra Lineal 1',
  url: 'https://eva.fing.edu.uy/course/view.php?id=1442'
};

const section = {
  id: 10,
  courseId: 1442,
  number: 24,
  name: 'Prácticos',
  visible: true,
  userVisible: true,
  modules: [
    {
      id: 69936,
      courseId: 1442,
      sectionId: 10,
      sectionNumber: 24,
      name: 'Práctico 9: Combinaciones lineales',
      modname: 'resource',
      visible: true,
      userVisible: true,
      contents: [
        {
          filename: 'practico9.pdf',
          size: 515344,
          mimeType: 'application/pdf',
          url: 'https://eva.fing.edu.uy/webservice/pluginfile.php/72305/practico9.pdf'
        }
      ]
    }
  ]
};

const contents = {
  course,
  sections: [section],
  source: 'webservice' as const,
  fetchedAt: '2026-10-29T00:00:00.000Z'
};

function stubService(): EvaService {
  return {
    getMyCourses: async () => [course],
    getCourseContents: async () => contents,
    getActivity: async () => ({
      module: section.modules[0],
      title: 'Práctico 9: Combinaciones lineales',
      description: 'Combinaciones lineales, generadores e independencia lineal.',
      files: section.modules[0].contents,
      links: [],
      metadata: {},
      source: 'webservice' as const
    }),
    searchContent: async () => [],
    searchFiles: async () => [],
    downloadFile: async () => ({
      filename: 'practico9.pdf',
      path: '/tmp/practico9.pdf',
      size: 515344,
      mimeType: 'application/pdf',
      sourceUrl: 'https://eva.fing.edu.uy/webservice/pluginfile.php/72305/practico9.pdf'
    })
  } as unknown as EvaService;
}

async function waitForFrame(lastFrame: () => string | undefined, expected: string, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((lastFrame() ?? '').includes(expected)) return;
    if (Date.now() > deadline) {
      throw new Error(`No apareció "${expected}" en el frame:\n${lastFrame() ?? ''}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Espera a que un frame nuevo se asiente y los handlers de `useInput` de ink
 * (que se suscriben en un `useEffect`, después de pintar) queden activos.
 * Sin esto, una tecla enviada justo al aparecer la pantalla puede perderse.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe('App (TUI)', () => {
  it('navega de cursos a la actividad y descarga el archivo', async () => {
    const { lastFrame, stdin, unmount } = render(<App service={stubService()} userLabel="Test · Web Services" />);

    await waitForFrame(lastFrame, 'Geometría y Álgebra Lineal 1');
    expect(lastFrame()).toContain('Enter abrir curso');

    await settle();
    stdin.write('\r');
    await waitForFrame(lastFrame, '[resource] Práctico 9');
    expect(lastFrame()).toContain('Enter abrir actividad');

    await settle();
    stdin.write('\r');
    await waitForFrame(lastFrame, 'practico9.pdf');
    expect(lastFrame()).toContain('d descargar');

    await settle();
    stdin.write('d');
    await waitForFrame(lastFrame, 'Descargado: /tmp/practico9.pdf');

    unmount();
  });

  it('vuelve de la actividad con Esc', async () => {
    const { lastFrame, stdin, unmount } = render(<App service={stubService()} userLabel="Test · Web Services" />);

    await waitForFrame(lastFrame, 'Geometría y Álgebra Lineal 1');
    stdin.write('\r');
    await waitForFrame(lastFrame, '[resource] Práctico 9');

    stdin.write('\u001B');
    await settle();
    await waitForFrame(lastFrame, '1 curso(s)');

    expect((lastFrame() ?? '').includes('practico9.pdf')).toBe(false);
    unmount();
  });
});
