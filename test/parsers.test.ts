import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseActivityPage,
  parseCategoryPage,
  parseCourseList,
  parseCoursePage,
  parseForumPage,
  parseLoginRequired,
  parseSearchResults
} from '../src/eva/web-parsers.js';

const baseUrl = 'https://eva.fing.edu.uy';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

describe('parseCoursePage', () => {
  const parsed = parseCoursePage(fixture('course-page.html'), baseUrl);

  it('detecta el curso y su resumen', () => {
    expect(parsed.course.id).toBe(1988);
    expect(parsed.course.fullname).toBe('Gestión de Proyectos');
    expect(parsed.course.summary).toBe('Resumen general del curso.');
    expect(parsed.course.url).toBe(`${baseUrl}/course/view.php?id=1988`);
  });

  it('lee las pestañas y el desplegable de secciones del formato onetopic', () => {
    expect(parsed.tabs).toEqual([
      { number: 0, name: 'General' },
      { number: 1, name: 'Unidad 1' },
      { number: 2, name: 'Unidad 2' },
      { number: 3, name: 'Material extra' }
    ]);
  });

  it('lee secciones, nombres y resúmenes', () => {
    expect(parsed.sections).toHaveLength(3);
    expect(parsed.sections[1]).toMatchObject({
      id: 22,
      courseId: 1988,
      number: 1,
      name: 'Unidad 1',
      summary: 'Contenidos de la unidad 1.'
    });
    expect(parsed.sections[2]?.modules).toHaveLength(0);
  });

  it('lee actividades con tipo, visibilidad y archivos', () => {
    const general = parsed.sections[0]!;
    expect(general.modules).toHaveLength(1);
    expect(general.modules[0]).toMatchObject({
      id: 5001,
      name: 'Novedades',
      modname: 'forum',
      description: 'Avisos del curso.',
      visible: true,
      userVisible: true
    });

    const unidad = parsed.sections[1]!;
    const apunte = unidad.modules.find((module) => module.id === 5002)!;
    expect(apunte.modname).toBe('resource');
    expect(apunte.url).toBe(`${baseUrl}/mod/resource/view.php?id=5002`);
    expect(apunte.contents).toHaveLength(1);
    expect(apunte.contents[0]?.filename).toBe('apunte.pdf');
    expect(apunte.contents[0]?.url).not.toContain('token=');

    const tarea = unidad.modules.find((module) => module.id === 5003)!;
    expect(tarea.visible).toBe(false);
    expect(tarea.userVisible).toBe(false);
  });
});

describe('parseCourseList', () => {
  it('lee los cursos de los coursebox', () => {
    const courses = parseCourseList(fixture('course-list.html'), baseUrl);
    expect(courses.map((course) => course.id)).toEqual([1988, 2001]);
    expect(courses[0]).toMatchObject({
      fullname: 'Gestión de Proyectos',
      summary: 'Planificación y seguimiento.',
      imageUrl: `${baseUrl}/pluginfile.php/1/courseimage.png`
    });
  });

  it('lee categorías y cursos de la página de categoría', () => {
    const result = parseCategoryPage(fixture('course-list.html'), baseUrl, 0);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]).toMatchObject({
      id: 12,
      name: 'Tercer semestre',
      parentId: 0,
      depth: 1,
      courseCount: 2
    });
    expect(result.courses).toHaveLength(2);
  });

  it('usa la cantidad de cursos como total si no hay texto de resultados', () => {
    expect(parseSearchResults(fixture('course-list.html'), baseUrl).total).toBe(2);
  });
});

describe('parseActivityPage', () => {
  const parsed = parseActivityPage(fixture('activity-page.html'), baseUrl, {
    courseId: 1988,
    sectionId: 22,
    sectionNumber: 1,
    cmid: 5003,
    modname: 'assign',
    name: 'Tarea 1'
  });

  it('lee título, descripción y metadatos', () => {
    expect(parsed.title).toBe('Tarea 1');
    expect(parsed.description).toBe('Resolver el ejercicio y entregar un PDF.');
    expect(parsed.metadata).toEqual({
      Entrega: '10 de noviembre de 2026',
      Puntaje: '10 puntos'
    });
    expect(parsed.source).toBe('web');
  });

  it('lee archivos y enlaces sin repetir la propia actividad', () => {
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]?.filename).toBe('enunciado.pdf');
    expect(parsed.links.some((link) => link.url === 'https://example.com/recurso')).toBe(true);
    expect(parsed.links.some((link) => link.url.includes('/mod/assign/view.php'))).toBe(false);
  });

  it('completa el módulo con los datos de contexto', () => {
    expect(parsed.module).toMatchObject({
      id: 5003,
      courseId: 1988,
      sectionId: 22,
      sectionNumber: 1,
      modname: 'assign',
      name: 'Tarea 1'
    });
  });
});

describe('parseForumPage', () => {
  it('lee discusiones, autores, respuestas y fijadas', () => {
    const discussions = parseForumPage(fixture('forum-page.html'), baseUrl, 300);
    expect(discussions).toHaveLength(2);
    expect(discussions[0]).toMatchObject({
      id: 9001,
      forumId: 300,
      name: 'Presentación del curso',
      author: 'Ana Pérez',
      replyCount: 3,
      pinned: false
    });
    expect(discussions[1]).toMatchObject({ id: 9002, name: 'Aviso importante', pinned: true });
  });
});

describe('parseLoginRequired', () => {
  it('detecta una página de login', () => {
    expect(parseLoginRequired('<body class="notloggedin"><form id="login"></form></body>')).toBe(true);
    expect(parseLoginRequired('<body class="loggedin"><main>Hola</main></body>')).toBe(false);
  });
});
