import { describe, expect, it } from 'vitest';
import type { EvaCourseContents, EvaModule, EvaSection } from '../src/domain/types.js';
import { clamp, fitText, formatBytes, listWindow, wrapText } from '../src/tui/list.js';
import { flattenOutline, moduleTag } from '../src/tui/outline.js';

describe('listWindow', () => {
  it('muestra la lista completa si entra en pantalla', () => {
    expect(listWindow(3, 1, 10)).toEqual({ start: 0, end: 3 });
  });

  it('centra la ventana en el cursor', () => {
    expect(listWindow(10, 5, 4)).toEqual({ start: 3, end: 7 });
  });

  it('no se pasa del final ni del principio', () => {
    expect(listWindow(10, 0, 4)).toEqual({ start: 0, end: 4 });
    expect(listWindow(10, 9, 4)).toEqual({ start: 6, end: 10 });
  });

  it('maneja listas vacías', () => {
    expect(listWindow(0, 0, 5)).toEqual({ start: 0, end: 0 });
  });
});

describe('clamp', () => {
  it('limita el índice al tamaño de la lista', () => {
    expect(clamp(3, 5)).toBe(3);
    expect(clamp(-2, 5)).toBe(0);
    expect(clamp(9, 5)).toBe(4);
    expect(clamp(0, 0)).toBe(0);
  });
});

describe('fitText', () => {
  it('trunca con puntos suspensivos', () => {
    expect(fitText('Práctico 9', 20)).toBe('Práctico 9');
    expect(fitText('Práctico 9: Combinaciones lineales', 12)).toBe('Práctico 9:…');
  });
});

describe('wrapText', () => {
  it('corta por ancho y respeta el máximo de líneas', () => {
    const lines = wrapText('uno dos tres cuatro cinco', 9, 2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('uno dos');
    expect(lines[1]).toBe('tres');
  });
});

describe('formatBytes', () => {
  it('formatea tamaños legibles', () => {
    expect(formatBytes(515344)).toBe('503 KB');
    expect(formatBytes(undefined)).toBe('');
  });
});

describe('flattenOutline', () => {
  const module: EvaModule = {
    id: 69936,
    courseId: 1442,
    sectionId: 10,
    sectionNumber: 1,
    name: 'Práctico 9',
    modname: 'resource',
    visible: true,
    userVisible: true,
    contents: []
  };
  const section: EvaSection = {
    id: 10,
    courseId: 1442,
    number: 1,
    name: 'Prácticos',
    visible: true,
    userVisible: true,
    modules: [module]
  };
  const emptySection: EvaSection = {
    id: 11,
    courseId: 1442,
    number: 2,
    name: 'Foros',
    visible: true,
    userVisible: true,
    modules: []
  };
  const contents: EvaCourseContents = {
    course: {
      id: 1442,
      shortname: 'GAL1-2S',
      fullname: 'Geometría y Álgebra Lineal 1',
      displayName: 'GAL1-2S',
      url: 'https://eva.fing.edu.uy/course/view.php?id=1442'
    },
    sections: [section, emptySection],
    source: 'webservice',
    fetchedAt: '2026-10-29T00:00:00.000Z'
  };

  it('apila secciones y actividades en orden', () => {
    const entries = flattenOutline(contents);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ type: 'section', section: { id: 10 } });
    expect(entries[1]).toMatchObject({ type: 'module', module: { id: 69936 } });
    expect(entries[2]).toMatchObject({ type: 'section', section: { id: 11 } });
  });

  it('etiqueta el tipo de actividad', () => {
    expect(moduleTag('resource')).toBe('[resource]');
    expect(moduleTag('')).toBe('[actividad]');
  });
});
