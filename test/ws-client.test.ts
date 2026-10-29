import { describe, expect, it } from 'vitest';
import type { HttpClient } from '../src/eva/http-client.js';
import { appendParams, WsClient } from '../src/eva/ws-client.js';

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

  it('no envía wsformat, que Moodle 4.5 rechaza como parámetro inválido', async () => {
    let body = '';
    const http = {
      baseUrl: 'https://eva.fing.edu.uy',
      request: async (_url: string, options: { body?: URLSearchParams }) => {
        body = options.body?.toString() ?? '';
        return { status: 200, ok: true, url: '', headers: new Headers(), text: '{}' };
      }
    } as unknown as HttpClient;

    await new WsClient(http, 'token').call('core_webservice_get_site_info');

    expect(body).not.toContain('wsformat');
    expect(body).toContain('moodlewsrestformat=json');
  });
});
