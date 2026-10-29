import { describe, expect, it } from 'vitest';
import { appendParams } from '../src/eva/ws-client.js';

describe('appendParams', () => {
  it('serializa arrays con índices', () => {
    const params = new URLSearchParams();
    appendParams(params, 'courseids', [10, 20]);
    expect(params.getAll('courseids[0]')).toEqual(['10']);
    expect(params.getAll('courseids[1]')).toEqual(['20']);
  });

  it('serializa objetos anidados', () => {
    const params = new URLSearchParams();
    appendParams(params, 'options', { ids: [7], enabled: true });
    expect(params.get('options[ids][0]')).toBe('7');
    expect(params.get('options[enabled]')).toBe('true');
  });

  it('omite valores nulos y conserva ceros y falses', () => {
    const params = new URLSearchParams();
    appendParams(params, 'a', undefined);
    appendParams(params, 'b', null);
    appendParams(params, 'c', 0);
    appendParams(params, 'd', false);
    expect(params.has('a')).toBe(false);
    expect(params.has('b')).toBe(false);
    expect(params.get('c')).toBe('0');
    expect(params.get('d')).toBe('false');
  });
});
