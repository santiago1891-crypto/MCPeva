import { Cookie, CookieJar } from 'tough-cookie';
import type { StoredCookie } from './session-store.js';

export class CookieStore {
  private readonly jar = new CookieJar();

  async applySetCookies(url: string, setCookieHeaders: string[]): Promise<void> {
    for (const header of setCookieHeaders) {
      try {
        await this.jar.setCookie(header, url, { ignoreError: true });
      } catch {
        // Moodle a veces manda cookies con atributos que tough-cookie rechaza; las ignoramos.
      }
    }
  }

  async header(url: string): Promise<string> {
    return this.jar.getCookieString(url);
  }

  async load(cookies: StoredCookie[] | undefined): Promise<void> {
    if (!cookies?.length) return;
    for (const item of cookies) {
      try {
        const cookie = Cookie.fromJSON(item);
        if (cookie) await this.jar.setCookie(cookie, `${cookie.secure ? 'https' : 'http'}://${cookie.domain?.replace(/^\./, '') ?? 'localhost'}${cookie.path ?? '/'}`, {
          ignoreError: true
        });
      } catch {
        // Ignoramos cookies inválidas para no romper la sesión completa.
      }
    }
  }

  async export(): Promise<StoredCookie[]> {
    const serialized = this.jar.serializeSync();
    return (serialized?.cookies ?? []) as StoredCookie[];
  }

  async isEmpty(): Promise<boolean> {
    const serialized = this.jar.serializeSync();
    return !serialized?.cookies?.length;
  }

  clear(): void {
    void this.jar.removeAllCookies();
  }
}
