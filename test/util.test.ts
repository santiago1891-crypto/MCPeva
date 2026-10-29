import { describe, expect, it } from 'vitest';
import { cleanText, htmlToText, stripTokenFromUrl, truncate, uniqueBy } from '../src/domain/util.js';

describe('utilidades de dominio', () => {
  it('convierte HTML a texto limpio', () => {
    expect(htmlToText('<p>Hola <strong>mundo</strong></p><script>x()</script>')).toBe('Hola mundo');
    expect(cleanText('  a\u00a0 b \n c ')).toBe('a b c');
  });

  it('quita el token de una URL sin tocar otros parámetros', () => {
    expect(stripTokenFromUrl('https://eva.fing.edu.uy/pluginfile.php/1/a.pdf?token=abc&forcedownload=1')).toBe(
      'https://eva.fing.edu.uy/pluginfile.php/1/a.pdf?forcedownload=1'
    );
    expect(stripTokenFromUrl('https://eva.fing.edu.uy/pluginfile.php/1/a.pdf?token=abc')).toBe(
      'https://eva.fing.edu.uy/pluginfile.php/1/a.pdf'
    );
  });

  it('trunca y elimina duplicados', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(uniqueBy([{ id: 1 }, { id: 1 }, { id: 2 }], (item) => item.id)).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
