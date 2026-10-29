import { CookieStore } from '../auth/cookie-store.js';
import { config } from '../config.js';
import { EvaError, toEvaError } from '../errors.js';
import { logger } from '../logger.js';

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams | Uint8Array;
  timeoutMs?: number;
  retries?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  useCookies?: boolean;
  throwOnError?: boolean;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  url: string;
  headers: Headers;
  text: string;
}

export interface HttpFetchResult {
  response: Response;
  finalUrl: string;
}

export class HttpClient {
  constructor(
    readonly baseUrl: string,
    readonly cookies: CookieStore,
    private readonly defaultHeaders: Record<string, string> = {}
  ) {}

  private async buildHeaders(url: string, options: HttpRequestOptions): Promise<Headers> {
    const headers = new Headers({
      'user-agent': config.userAgent,
      'accept-language': 'es-UY,es;q=0.9,en;q=0.8',
      ...this.defaultHeaders,
      ...(options.headers ?? {})
    });
    if (options.useCookies !== false) {
      const cookie = await this.cookies.header(url);
      if (cookie) headers.set('cookie', cookie);
    }
    return headers;
  }

  private async storeCookies(url: string, response: Response): Promise<void> {
    const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
    const setCookies = getSetCookie ? getSetCookie() : [];
    if (setCookies.length) await this.cookies.applySetCookies(url, setCookies);
  }

  private timeoutSignal(options: HttpRequestOptions): AbortSignal {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? config.requestTimeoutMs);
    return options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  }

  async fetchResponse(rawUrl: string, options: HttpRequestOptions = {}): Promise<HttpFetchResult> {
    let url = new URL(rawUrl, this.baseUrl).toString();
    let method = (options.method ?? 'GET').toUpperCase();
    let body = options.body;
    const maxRedirects = options.maxRedirects ?? 10;
    const follow = options.followRedirects ?? true;
    const retries = options.retries ?? (method === 'GET' || method === 'HEAD' ? 2 : 0);

    for (let redirects = 0; ; redirects += 1) {
      let response: Response;
      let attempt = 0;
      for (;;) {
        try {
          response = await fetch(url, {
            method,
            headers: await this.buildHeaders(url, options),
            body: method === 'GET' || method === 'HEAD' ? undefined : (body as BodyInit | undefined),
            redirect: 'manual',
            signal: this.timeoutSignal(options)
          });
        } catch (error) {
          if (attempt < retries) {
            attempt += 1;
            await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
            continue;
          }
          throw new EvaError('NETWORK_ERROR', `No se pudo conectar con EVA (${url})`, { cause: error });
        }

        if (attempt < retries && [429, 502, 503, 504].includes(response.status)) {
          attempt += 1;
          await response.body?.cancel();
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          continue;
        }
        break;
      }

      await this.storeCookies(url, response);

      const location = response.headers.get('location');
      if (!follow || !location || ![301, 302, 303, 307, 308].includes(response.status)) {
        return { response, finalUrl: url };
      }

      if (redirects >= maxRedirects) {
        await response.body?.cancel();
        throw new EvaError('UPSTREAM_ERROR', `Demasiadas redirecciones al acceder a ${rawUrl}`);
      }

      await response.body?.cancel();
      const nextUrl = new URL(location, url).toString();
      logger.debug('Redirección HTTP', { from: url, to: nextUrl, status: response.status });
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
      }
      url = nextUrl;
    }
  }

  async request(rawUrl: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    const { response, finalUrl } = await this.fetchResponse(rawUrl, options);
    const text = await response.text();
    if (options.throwOnError !== false && !response.ok) {
      throw new EvaError('UPSTREAM_ERROR', `EVA respondió ${response.status} para ${rawUrl}`, {
        status: response.status,
        details: { body: text.slice(0, 500) }
      });
    }
    return { status: response.status, ok: response.ok, url: finalUrl, headers: response.headers, text };
  }

  async requestBuffer(rawUrl: string, options: HttpRequestOptions = {}): Promise<{ status: number; url: string; headers: Headers; buffer: Buffer }> {
    const { response, finalUrl } = await this.fetchResponse(rawUrl, options);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (options.throwOnError !== false && !response.ok) {
      throw new EvaError('UPSTREAM_ERROR', `EVA respondió ${response.status} para ${rawUrl}`, {
        status: response.status,
        details: { body: buffer.toString('utf8').slice(0, 500) }
      });
    }
    return { status: response.status, url: finalUrl, headers: response.headers, buffer };
  }

  async postForm(rawUrl: string, data: Record<string, string | number | boolean | undefined>, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) form.set(key, String(value));
    }
    return this.request(rawUrl, {
      ...options,
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        ...(options.headers ?? {})
      },
      body: form
    });
  }

  async resolveRedirect(rawUrl: string): Promise<{ url: string; status: number; headers: Headers }> {
    const { response, finalUrl } = await this.fetchResponse(rawUrl, {
      method: 'GET',
      followRedirects: false,
      throwOnError: false,
      headers: { range: 'bytes=0-0' }
    });
    await response.body?.cancel();
    const location = response.headers.get('location');
    return {
      url: location ? new URL(location, rawUrl).toString() : finalUrl,
      status: response.status,
      headers: response.headers
    };
  }

  wrapError(error: unknown): EvaError {
    return toEvaError(error);
  }
}
