import { randomBytes } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { config } from '../config.js';
import { CookieStore } from './cookie-store.js';
import { SessionStore, type StoredCookie, type StoredSession } from './session-store.js';
import { HttpClient } from '../eva/http-client.js';
import { WsClient } from '../eva/ws-client.js';
import { WebClient } from '../eva/web-client.js';
import { logger } from '../logger.js';
import { EvaError } from '../errors.js';

export interface LoginResult {
  user?: { id?: number; username?: string; fullname?: string };
  token?: boolean;
  webSession: boolean;
  sessionFile: string;
}

function toStoredCookies(cookies: Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite?: 'Strict' | 'Lax' | 'None' }>): StoredCookie[] {
  return cookies.map((cookie) => ({
    key: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    ...(cookie.expires > 0 ? { expires: new Date(cookie.expires * 1000).toISOString() } : {}),
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {})
  }));
}

export function extractMobileToken(locationOrBody: string, passport: string): string | undefined {
  const tokenParam = /[?&]token=([^&\s"'<>]+)/.exec(locationOrBody)?.[1] ?? /moodlemobile:\/\/token=([^\s"'<>]+)/.exec(locationOrBody)?.[1];
  if (!tokenParam) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(tokenParam);
  } catch {
    return undefined;
  }
  try {
    const normalized = decoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = Buffer.from(normalized, 'base64').toString('utf8');
    const [requestPassport, token] = binary.split(':');
    if (requestPassport && token) {
      // Es el payload estructurado de la app móvil: si el passport no coincide,
      // el token no corresponde a esta solicitud y no debe usarse.
      return requestPassport === passport ? token : undefined;
    }
  } catch {
    // Si no es base64, puede ser un token plano.
  }
  return /^[A-Za-z0-9]{16,}$/.test(decoded) ? decoded : undefined;
}

async function launchBrowser(headless: boolean): Promise<Browser> {
  const channels = [...new Set([config.browserChannel, 'chrome', 'msedge'])];
  let lastError: unknown;
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel, headless });
    } catch (error) {
      lastError = error;
      logger.debug('No se pudo iniciar el navegador', { channel, error: (error as Error).message });
    }
  }
  throw new EvaError('AUTH_FAILED', 'No se pudo abrir Chrome/Edge. Instalá uno o configurá EVA_BROWSER_CHANNEL.', { cause: lastError });
}

async function fillSsoIfConfigured(page: Page): Promise<boolean> {
  if (!config.username || !config.password) return false;
  try {
    await page.goto(`${config.baseUrl}/auth/shibboleth/index.php`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const userInput = page.locator('input[name="j_username"], #username').first();
    if (!(await userInput.count())) return false;
    await userInput.fill(config.username);
    await page.locator('input[name="j_password"], #password').first().fill(config.password);
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => undefined),
      page.locator('form button[type="submit"], form input[type="submit"], button[type="submit"]').first().click()
    ]);
    return true;
  } catch (error) {
    logger.warn('No se pudo completar el login automático por SSO; continuá manualmente en la ventana.', {
      error: (error as Error).message
    });
    return false;
  }
}

async function tryMobileToken(context: BrowserContext): Promise<string | undefined> {
  const passport = randomBytes(16).toString('hex');
  const launchUrl = `${config.baseUrl}/admin/tool/mobile/launch.php?service=${encodeURIComponent(config.service)}&passport=${passport}&urlscheme=moodlemobile`;
  try {
    const response = await context.request.get(launchUrl, { maxRedirects: 0, failOnStatusCode: false, timeout: 30_000 });
    const location = response.headers()['location'] ?? '';
    const body = response.status() >= 300 && response.status() < 400 ? '' : await response.text().catch(() => '');
    return extractMobileToken(location || body, passport);
  } catch (error) {
    logger.warn('No se pudo obtener el token móvil de EVA; se usará la sesión web.', {
      error: (error as Error).message
    });
    return undefined;
  }
}

async function validateToken(token: string): Promise<{ id?: number; username?: string; fullname?: string } | undefined> {
  try {
    const http = new HttpClient(config.baseUrl, new CookieStore());
    const ws = new WsClient(http, token, config.service);
    const info = await ws.getSiteInfo();
    return { id: info.userid, username: info.username, fullname: info.fullname };
  } catch (error) {
    logger.warn('El token obtenido no fue aceptado por EVA.', { error: (error as Error).message });
    return undefined;
  }
}

export async function loginInteractive(options: { headless?: boolean } = {}): Promise<LoginResult> {
  const headless = options.headless ?? config.browserHeadless;
  if (headless && (!config.username || !config.password)) {
    throw new EvaError('INVALID_INPUT', 'El login sin ventana requiere EVA_USERNAME y EVA_PASSWORD en el archivo .env.');
  }

  const store = new SessionStore();
  const browser = await launchBrowser(headless);
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      locale: 'es-UY',
      timezoneId: 'America/Montevideo',
      viewport: { width: 1280, height: 900 }
    });
    const page = await context.newPage();

    logger.info('Abriendo EVA para iniciar sesión');
    await page.goto(`${config.baseUrl}/login/index.php`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    if (config.username && config.password) {
      const ssoStarted = await fillSsoIfConfigured(page);
      if (!ssoStarted) {
        logger.info('Intentando login local de EVA');
        await page.goto(`${config.baseUrl}/login/index.php`, { waitUntil: 'domcontentloaded' });
        await page.locator('#showldaplogin').click().catch(() => undefined);
        await page.locator('#username').fill(config.username);
        await page.locator('#password').fill(config.password);
        await Promise.all([
          page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => undefined),
          page.locator('#loginbtn').click()
        ]);
      }
    } else {
      process.stderr.write(
        '\n>>> Iniciá sesión en la ventana de EVA (estudiante por UdelaR o usuario local).\n' +
          '>>> Cuando termines, el proceso guardará la sesión automáticamente.\n\n'
      );
    }

    await page.waitForFunction(
      () => {
        const body = document.body;
        return Boolean(
          body &&
            !body.classList.contains('notloggedin') &&
            document.querySelector('#user-menu-toggle, .usermenu .dropdown-toggle, a[href*="/login/logout.php"], #page-my-index')
        );
      },
      undefined,
      { timeout: config.loginTimeoutMs }
    );

    const cookies = toStoredCookies(await context.cookies(config.baseUrl));
    const cookieStore = new CookieStore();
    await cookieStore.load(cookies);
    const http = new HttpClient(config.baseUrl, cookieStore);
    const web = new WebClient(http, config.baseUrl);
    const userInfo: { id?: number; fullname?: string; username?: string } = await web
      .getUserInfo()
      .catch(() => ({}));

    const token = await tryMobileToken(context);
    const tokenUser = token ? await validateToken(token) : undefined;
    const user = {
      ...(userInfo.id ? { id: userInfo.id } : {}),
      ...(userInfo.fullname ? { fullname: userInfo.fullname } : {}),
      ...(userInfo.username ? { username: userInfo.username } : {}),
      ...(tokenUser?.id && !userInfo.id ? { id: tokenUser.id } : {}),
      ...(tokenUser?.username && !userInfo.username ? { username: tokenUser.username } : {}),
      ...(tokenUser?.fullname && !userInfo.fullname ? { fullname: tokenUser.fullname } : {})
    };

    let webSession = false;
    try {
      await web.getUserInfo();
      webSession = true;
    } catch {
      webSession = false;
    }

    if (!token && !webSession) {
      throw new EvaError('AUTH_FAILED', 'No se pudo validar la sesión de EVA después del login.');
    }

    const storageState = await context.storageState();
    const saved: Omit<StoredSession, 'version' | 'baseUrl' | 'savedAt'> = {
      ...(token && tokenUser ? { token, service: config.service } : {}),
      ...(Object.keys(user).length ? { user } : {}),
      cookies,
      storageState,
      lastValidatedAt: new Date().toISOString()
    };
    await store.save(saved);

    logger.info('Login completado', { token: Boolean(token), webSession });
    return {
      user: Object.keys(user).length ? user : undefined,
      ...(token ? { token: true } : {}),
      webSession,
      sessionFile: config.sessionFile
    };
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export async function saveToken(token: string): Promise<LoginResult> {
  const user = await validateToken(token);
  if (!user) throw new EvaError('TOKEN_INVALID', 'El token no fue aceptado por EVA.');
  const store = new SessionStore();
  await store.save({ token, service: config.service, user, lastValidatedAt: new Date().toISOString() });
  return { user, token: true, webSession: false, sessionFile: config.sessionFile };
}
