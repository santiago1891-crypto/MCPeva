import { describe, expect, it } from 'vitest';
import {
  fileMatchesName,
  normalizeExtensions,
  normalizeSearchText,
  tokenizeSearch
} from '../src/domain/file-search.js';

describe('búsqueda de archivos', () => {
  it('normaliza mayúsculas y acentos', () => {
    expect(normalizeSearchText('Álgebra Lineal.PDF')).toBe('algebra lineal.pdf');
    expect(tokenizeSearch(' Práctico 2 - PDF ')).toEqual(['practico', '2', 'pdf']);
  });

  it('exige que todos los términos aparezcan en el nombre', () => {
    const tokens = tokenizeSearch('parcial 2');
    expect(fileMatchesName('Parcial 2 - soluciones.pdf', tokens, [])).toBe(true);
    expect(fileMatchesName('Parcial 1 - soluciones.pdf', tokens, [])).toBe(false);
    expect(fileMatchesName('Segundo Parcial.pdf', tokenizeSearch('segundo parcial'), [])).toBe(true);
  });

  it('filtra por extensión sin distinguir mayúsculas ni el punto', () => {
    expect(normalizeExtensions(['.PDF', 'docx, pdf'])).toEqual(['pdf', 'docx']);
    expect(fileMatchesName('apunte.PDF', [], ['pdf'])).toBe(true);
    expect(fileMatchesName('apunte.docx', [], ['pdf'])).toBe(false);
  });

  it('usa el MIME como respaldo cuando el nombre no tiene extensión', () => {
    expect(fileMatchesName('descarga', [], ['pdf'], 'application/pdf')).toBe(true);
    expect(fileMatchesName('descarga', [], ['pdf'], 'image/png')).toBe(false);
  });

  it('no coincide si no hay criterios', () => {
    expect(fileMatchesName('cualquier.pdf', [], [])).toBe(false);
  });
});
