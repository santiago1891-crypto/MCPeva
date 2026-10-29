import { describe, expect, it } from 'vitest';
import { mapCourse, mapCourseContents, mapModule } from '../src/eva/mappers.js';

const baseUrl = 'https://eva.fing.edu.uy';

describe('mapCourse', () => {
  it('normaliza un curso de Web Services', () => {
    const course = mapCourse(
      {
        id: 1988,
        shortname: 'GP2026',
        fullname: 'Gestión de Proyectos',
        displayname: 'Gestión de Proyectos (2026)',
        categoryid: 12,
        categoryname: 'Tercer semestre',
        summary: '<p>Planificación <strong>ágil</strong>.</p>',
        format: 'onetopic',
        visible: 1,
        startdate: 1767225600,
        overviewfiles: [
          { fileurl: 'https://eva.fing.edu.uy/pluginfile.php/1/image.png?token=abc', mimetype: 'image/png' }
        ],
        enrolledusercount: 42
      },
      baseUrl
    );

    expect(course).toMatchObject({
      id: 1988,
      shortname: 'GP2026',
      fullname: 'Gestión de Proyectos',
      displayName: 'Gestión de Proyectos (2026)',
      categoryId: 12,
      categoryName: 'Tercer semestre',
      summary: 'Planificación ágil.',
      format: 'onetopic',
      visible: true,
      enrolledCount: 42,
      url: `${baseUrl}/course/view.php?id=1988`
    });
    expect(course.summaryHtml).toContain('<strong>ágil</strong>');
    expect(course.imageUrl).not.toContain('token=');
    expect(course.startDate).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('mapModule', () => {
  it('normaliza archivos, fechas y finalización', () => {
    const module = mapModule(
      {
        id: 5002,
        instance: 88,
        modname: 'resource',
        name: 'Apunte',
        description: '<p>Material de la unidad.</p>',
        url: '/mod/resource/view.php?id=5002',
        visible: 1,
        uservisible: 0,
        indent: 1,
        completion: 1,
        completiondata: { state: 1 },
        dates: [{ label: 'Entrega', timestamp: 1767225600 }],
        contents: [
          {
            filename: 'apunte.pdf',
            filepath: '/',
            filesize: 1200,
            mimetype: 'application/pdf',
            fileurl: 'https://eva.fing.edu.uy/webservice/pluginfile.php/1/apunte.pdf?token=abc',
            timemodified: 1767225600
          }
        ]
      },
      1988,
      22,
      1,
      baseUrl
    );

    expect(module).toMatchObject({
      id: 5002,
      instanceId: 88,
      name: 'Apunte',
      modname: 'resource',
      description: 'Material de la unidad.',
      url: `${baseUrl}/mod/resource/view.php?id=5002`,
      visible: true,
      userVisible: false,
      indent: 1,
      completion: { enabled: true, complete: true }
    });
    expect(module.dates?.due).toBe('2026-01-01T00:00:00.000Z');
    expect(module.contents).toHaveLength(1);
    expect(module.contents[0]?.size).toBe(1200);
    expect(module.contents[0]?.url).not.toContain('token=');
  });
});

describe('mapCourseContents', () => {
  it('arma secciones con sus módulos y nombres por defecto', () => {
    const course = mapCourse({ id: 1988, fullname: 'Curso' }, baseUrl);
    const sections = mapCourseContents(
      [
        {
          id: 21,
          section: 0,
          name: 'General',
          summary: '',
          visible: 1,
          modules: [{ id: 5001, modname: 'forum', name: 'Novedades' }]
        },
        { id: 22, section: 1, name: '', uservisible: 0, modules: [] }
      ],
      course,
      baseUrl
    );

    expect(sections).toHaveLength(2);
    expect(sections[0]?.modules[0]?.sectionId).toBe(21);
    expect(sections[1]).toMatchObject({
      id: 22,
      number: 1,
      name: 'Sección 1',
      userVisible: false
    });
  });
});
