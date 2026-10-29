import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { EvaUser } from '../domain/types.js';

export interface StoredCookie {
  key: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export interface StoredSession {
  version: 1;
  baseUrl: string;
  token?: string;
  service?: string;
  user?: EvaUser;
  cookies?: StoredCookie[];
  storageState?: unknown;
  savedAt: string;
  lastValidatedAt?: string;
}

export class SessionStore {
  private cached: StoredSession | null | undefined;

  constructor(private readonly file = config.sessionFile) {}

  async load(): Promise<StoredSession | null> {
    if (this.cached !== undefined) return this.cached;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as StoredSession;
      if (parsed.version !== 1) {
        logger.warn('Ignorando archivo de sesión con versión desconocida');
        this.cached = null;
        return null;
      }
      this.cached = parsed;
      return parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') logger.warn('No se pudo leer la sesión guardada', { error: (error as Error).message });
      this.cached = null;
      return null;
    }
  }

  async save(session: Omit<StoredSession, 'version' | 'baseUrl' | 'savedAt'> & { savedAt?: string }): Promise<StoredSession> {
    const value: StoredSession = {
      version: 1,
      baseUrl: config.baseUrl,
      ...session,
      savedAt: session.savedAt ?? new Date().toISOString()
    };
    await fs.mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, this.file);
    try {
      await fs.chmod(this.file, 0o600);
    } catch {
      // Windows no siempre soporta chmod; no es crítico.
    }
    this.cached = value;
    logger.info('Sesión guardada', { file: this.file });
    return value;
  }

  async clear(): Promise<void> {
    await fs.rm(this.file, { force: true });
    this.cached = null;
  }

  async touch(): Promise<void> {
    const current = await this.load();
    if (!current) return;
    current.lastValidatedAt = new Date().toISOString();
    await this.save(current);
  }

  invalidate(): void {
    this.cached = undefined;
  }
}
