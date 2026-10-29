import { describe, expect, it } from 'vitest';
import { extractMobileToken } from '../src/auth/login.js';

describe('extractMobileToken', () => {
  const passport = 'abc123def456';

  function mobileToken(payload: string): string {
    return Buffer.from(payload, 'utf8').toString('base64');
  }

  it('extrae el token del redirect de la app móvil', () => {
    const encoded = mobileToken(`${passport}:tok_ABC123:signature`);
    expect(extractMobileToken(`moodlemobile://token=${encoded}`, passport)).toBe('tok_ABC123');
  });

  it('acepta el token codificado en la URL', () => {
    const encoded = mobileToken(`${passport}:tok_ABC123:signature`);
    expect(extractMobileToken(`https://eva.fing.edu.uy/?token=${encodeURIComponent(encoded)}`, passport)).toBe(
      'tok_ABC123'
    );
  });

  it('ignora tokens de otro passport', () => {
    const encoded = mobileToken(`otroPassport:tok_ABC123:signature`);
    expect(extractMobileToken(`moodlemobile://token=${encoded}`, passport)).toBeUndefined();
  });

  it('acepta un token plano como respaldo', () => {
    const plain = '0123456789abcdef0123456789abcdef';
    expect(extractMobileToken(`moodlemobile://token=${plain}`, passport)).toBe(plain);
  });

  it('devuelve undefined si no hay token', () => {
    expect(extractMobileToken('moodlemobile://token=', passport)).toBeUndefined();
    expect(extractMobileToken('', passport)).toBeUndefined();
  });
});
