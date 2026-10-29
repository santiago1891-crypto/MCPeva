import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ quiet: true });

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'si', 'sí', 'on'].includes(value.trim().toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pathFromEnv(value: string | undefined, fallback: string): string {
  if (!value || value.trim() === '') return fallback;
  return resolve(value.replace(/^~(?=$|[\\/])/, homedir()));
}

const baseUrl = (process.env.EVA_BASE_URL ?? 'https://eva.fing.edu.uy').replace(/\/+$/, '');
const dataDir = pathFromEnv(process.env.EVA_DATA_DIR, join(homedir(), '.mcp-eva'));

export const config = {
  baseUrl,
  siteHost: new URL(baseUrl).host,
  dataDir,
  sessionFile: pathFromEnv(process.env.EVA_SESSION_FILE, join(dataDir, 'session.json')),
  downloadsDir: pathFromEnv(process.env.EVA_DOWNLOADS_DIR, join(dataDir, 'downloads')),
  token: process.env.EVA_TOKEN?.trim() || undefined,
  service: process.env.EVA_WS_SERVICE?.trim() || 'moodle_mobile_app',
  requestTimeoutMs: int(process.env.EVA_REQUEST_TIMEOUT_MS, 30_000),
  loginTimeoutMs: int(process.env.EVA_LOGIN_TIMEOUT_MS, 300_000),
  cacheTtlMs: int(process.env.EVA_CACHE_TTL_MS, 120_000),
  maxDownloadBytes: int(process.env.EVA_MAX_DOWNLOAD_BYTES, 200 * 1024 * 1024),
  apiHost: process.env.EVA_API_HOST?.trim() || '127.0.0.1',
  apiPort: int(process.env.EVA_API_PORT, 8787),
  apiKey: process.env.EVA_API_KEY?.trim() || undefined,
  browserChannel: process.env.EVA_BROWSER_CHANNEL?.trim() || 'msedge',
  browserHeadless: bool(process.env.EVA_BROWSER_HEADLESS, false),
  username: process.env.EVA_USERNAME?.trim() || undefined,
  password: process.env.EVA_PASSWORD || undefined,
  readOnly: bool(process.env.EVA_READ_ONLY, true),
  logLevel: (process.env.EVA_LOG_LEVEL?.trim() || 'info') as 'debug' | 'info' | 'warn' | 'error',
  userAgent:
    process.env.EVA_USER_AGENT?.trim() ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
} as const;

export type Config = typeof config;
