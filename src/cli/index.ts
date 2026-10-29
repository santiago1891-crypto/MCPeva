#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { toEvaError } from '../errors.js';
import { loginInteractive, saveToken } from '../auth/login.js';
import { SessionStore } from '../auth/session-store.js';
import { EvaService } from '../services/eva-service.js';
import { startApi } from '../api/server.js';
import { startMcpHttp, startMcpStdio } from '../mcp/transport.js';
import { runTui } from '../tui/index.js';
import type { EvaCourse, EvaCourseContents, EvaSection } from '../domain/types.js';

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Map<string, string | boolean>;
}

const VERSION = '0.1.0';

const HELP = `mcp-eva ${VERSION} — backend y servidor MCP para EVA FING

Uso:
  eva <comando> [opciones]

Comandos:
  login                 Abre el navegador para iniciar sesión en EVA y guarda la sesión.
  token [TOKEN]         Guarda un token de Web Services de Moodle (si se omite, lo pide).
  logout                Borra la sesión guardada.
  status                Muestra el usuario y el modo de conexión.
  courses               Lista tus cursos inscriptos.
  contents <cursoId>    Muestra las secciones y actividades de un curso.
  search <texto>        Busca cursos en la plataforma.
  content <texto>       Busca dentro de tus cursos (secciones, actividades, archivos).
  files <texto>         Busca archivos por nombre y/o extensión en tus cursos.
  download <url>        Descarga un archivo de EVA al directorio local.
  tui                   Interfaz interactiva para navegar cursos, actividades y archivos.
  api                   Inicia la API REST.
  mcp                   Inicia el servidor MCP por stdio.
  help                  Muestra esta ayuda.

Opciones generales:
  --json                Imprime el resultado como JSON.
  -h, --help            Muestra la ayuda del comando.

Opciones por comando:
  login                 --headless (requiere credenciales en .env)
  courses               --query <texto>  --limit <n>
  search                --limit <n>
  content               --courses <id,id>  --limit <n>
  files                 --ext <pdf,docx>  --courses <id,id>  --limit <n>
  download              --name <archivo>
  api                   --port <n>  --host <host>
  mcp                   --http  --port <n>  --host <host>

Ejemplos:
  npm run login
  npm run status
  npx tsx src/cli/index.ts courses --json
  npx tsx src/cli/index.ts contents 1234
  npx tsx src/cli/index.ts files parcial --ext pdf
  npm run tui
  npx tsx src/cli/index.ts mcp
`;

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { command, positional, flags };
}

function flag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function has(args: ParsedArgs, name: string): boolean {
  const value = args.flags.get(name);
  return value === true || (typeof value === 'string' && value !== 'false');
}

function numberFlag(args: ParsedArgs, name: string, fallback: number): number {
  const value = flag(args, name);
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function print(value: unknown, json: boolean): void {
  if (json) {
    stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function line(text = ''): void {
  stdout.write(`${text}\n`);
}

function courseLabel(course: EvaCourse): string {
  return `${course.fullname} (id ${course.id}${course.shortname ? `, ${course.shortname}` : ''})`;
}

function sectionLabel(section: EvaSection): string {
  return `[${section.number}] ${section.name || '(sin nombre)'} — ${section.modules.length} actividad(es)`;
}

function printCourses(courses: EvaCourse[]): void {
  if (!courses.length) {
    line('No se encontraron cursos.');
    return;
  }
  for (const course of courses) {
    line(courseLabel(course));
    if (course.categoryName) line(`    Categoría: ${course.categoryName}`);
    line(`    ${course.url}`);
  }
  line();
  line(`${courses.length} curso(s).`);
}

function printContents(contents: EvaCourseContents): void {
  line(courseLabel(contents.course));
  line(`${contents.sections.length} sección(es) · fuente: ${contents.source}`);
  for (const section of contents.sections) {
    line();
    line(sectionLabel(section));
    for (const module of section.modules) {
      const hint = module.modname ? ` · ${module.modname}` : '';
      line(`    - ${module.name || '(sin nombre)'} (cmid ${module.id}${hint})`);
      if (module.dates?.due) line(`      Entrega: ${module.dates.due}`);
      if (module.url) line(`      ${module.url}`);
    }
  }
}

async function prompt(message: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(message)).trim();
  } finally {
    rl.close();
  }
}

async function commandStatus(args: ParsedArgs): Promise<void> {
  const service = await new EvaService().init();
  const status = await service.status(true);
  if (has(args, 'json')) {
    print(status, true);
    return;
  }
  line(`Sitio:   ${status.name} (${status.url})`);
  line(`Modo:    ${status.auth === 'webservice' ? 'Web Services' : status.auth === 'web' ? 'Sesión web' : 'Sin autenticar'}`);
  if (status.release) line(`Moodle:  ${status.release} ${status.version ? `(version ${status.version})` : ''}`.trim());
  if (status.user) {
    const name = status.user.fullname ?? status.user.username ?? 'desconocido';
    line(`Usuario: ${name}${status.user.id ? ` (id ${status.user.id})` : ''}`);
  } else {
    line('Usuario: (no autenticado)');
    line();
    line('Ejecutá "npm run login" para iniciar sesión.');
  }
  line(
    `Capacidades: Web Services ${status.features.webservice ? 'sí' : 'no'} · sesión web ${status.features.webSession ? 'sí' : 'no'}`
  );
}

async function commandLogin(args: ParsedArgs): Promise<void> {
  const result = await loginInteractive({ headless: has(args, 'headless') });
  if (has(args, 'json')) {
    print(result, true);
    return;
  }
  line('Sesión de EVA guardada.');
  if (result.user) line(`Usuario: ${result.user.fullname ?? result.user.username ?? result.user.id ?? 'desconocido'}`);
  line(`Token de Web Services: ${result.token ? 'sí' : 'no'}`);
  line(`Sesión web: ${result.webSession ? 'sí' : 'no'}`);
  line(`Archivo: ${result.sessionFile}`);
}

async function commandToken(args: ParsedArgs): Promise<void> {
  let token = args.positional[0] ?? '';
  if (!token) {
    token = await prompt('Token de Web Services de EVA: ');
  }
  if (!token) {
    throw new Error('No se ingresó un token.');
  }
  const result = await saveToken(token);
  if (has(args, 'json')) {
    print(result, true);
    return;
  }
  line('Token guardado y validado.');
  if (result.user) line(`Usuario: ${result.user.fullname ?? result.user.username ?? result.user.id ?? 'desconocido'}`);
  line(`Archivo: ${result.sessionFile}`);
}

async function commandLogout(args: ParsedArgs): Promise<void> {
  const store = new SessionStore();
  await store.clear();
  if (has(args, 'json')) {
    print({ ok: true, sessionFile: config.sessionFile }, true);
    return;
  }
  line(`Sesión eliminada de ${config.sessionFile}`);
}

async function commandCourses(args: ParsedArgs): Promise<void> {
  const service = await new EvaService().init();
  const query = flag(args, 'query');
  if (query) {
    const result = await service.searchCourses(query, numberFlag(args, 'limit', 30));
    if (has(args, 'json')) {
      print(result, true);
      return;
    }
    printCourses(result.courses);
    return;
  }
  const courses = await service.getMyCourses();
  if (has(args, 'json')) {
    print({ courses, count: courses.length }, true);
    return;
  }
  printCourses(courses);
}

async function commandContents(args: ParsedArgs): Promise<void> {
  const courseId = Number(args.positional[0]);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    throw new Error('Indicá un ID de curso válido: eva contents <cursoId>');
  }
  const service = await new EvaService().init();
  const contents = await service.getCourseContents(courseId);
  if (has(args, 'json')) {
    print(contents, true);
    return;
  }
  printContents(contents);
}

async function commandSearch(args: ParsedArgs): Promise<void> {
  const query = args.positional.join(' ').trim();
  if (!query) throw new Error('Indicá un texto a buscar: eva search <texto>');
  const service = await new EvaService().init();
  const result = await service.searchCourses(query, numberFlag(args, 'limit', 30));
  if (has(args, 'json')) {
    print(result, true);
    return;
  }
  if (!result.courses.length) {
    line(`Sin resultados para "${query}".`);
    return;
  }
  printCourses(result.courses);
}

async function commandContentSearch(args: ParsedArgs): Promise<void> {
  const query = args.positional.join(' ').trim();
  if (!query) throw new Error('Indicá un texto a buscar: eva content <texto>');
  const courseIds = (flag(args, 'courses') ?? '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
  const service = await new EvaService().init();
  const hits = await service.searchContent(
    query,
    courseIds.length ? courseIds : undefined,
    numberFlag(args, 'limit', 60)
  );
  if (has(args, 'json')) {
    print({ hits, count: hits.length }, true);
    return;
  }
  if (!hits.length) {
    line(`Sin coincidencias para "${query}".`);
    return;
  }
  for (const hit of hits) {
    const where = [hit.courseName, hit.sectionName].filter(Boolean).join(' › ');
    line(`[${hit.kind}] ${where}`);
    if (hit.moduleName) line(`    ${hit.moduleName}`);
    line(`    ${hit.snippet}`);
    if (hit.url) line(`    ${hit.url}`);
  }
  line();
  line(`${hits.length} coincidencia(s).`);
}

async function commandFiles(args: ParsedArgs): Promise<void> {
  const query = args.positional.join(' ').trim();
  const extensions = (flag(args, 'ext') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!query && !extensions.length) {
    throw new Error('Indicá un texto o una extensión: eva files <texto> --ext pdf');
  }
  const courseIds = (flag(args, 'courses') ?? '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
  const service = await new EvaService().init();
  const files = await service.searchFiles(query, {
    ...(extensions.length ? { extensions } : {}),
    ...(courseIds.length ? { courseIds } : {}),
    limit: numberFlag(args, 'limit', 60)
  });
  if (has(args, 'json')) {
    print({ files, count: files.length }, true);
    return;
  }
  if (!files.length) {
    line(`No se encontraron archivos${query ? ` para "${query}"` : ''}.`);
    return;
  }
  for (const file of files) {
    line(file.filename);
    const where = [file.courseName, file.sectionName, file.moduleName].filter(Boolean).join(' › ');
    line(`    ${where}`);
    const details = [
      file.size !== undefined ? `${file.size} bytes` : undefined,
      file.mimeType
    ].filter(Boolean);
    if (details.length) line(`    ${details.join(' · ')}`);
    line(`    ${file.url}`);
  }
  line();
  line(`${files.length} archivo(s).`);
}

async function commandDownload(args: ParsedArgs): Promise<void> {
  const url = args.positional[0];
  if (!url) throw new Error('Indicá la URL del archivo: eva download <url>');
  const service = await new EvaService().init();
  const file = await service.downloadFile(url, flag(args, 'name'));
  if (has(args, 'json')) {
    print(file, true);
    return;
  }
  line(`Descargado: ${file.path}`);
  line(`Tamaño: ${file.size} bytes${file.mimeType ? ` · ${file.mimeType}` : ''}`);
}

async function commandApi(args: ParsedArgs): Promise<void> {
  const service = await new EvaService().init();
  const app = await startApi(service, numberFlag(args, 'port', config.apiPort), flag(args, 'host') ?? config.apiHost);
  const close = async () => {
    await app.close().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

async function commandMcp(args: ParsedArgs): Promise<void> {
  const service = await new EvaService().init();
  if (has(args, 'http')) {
    const server = await startMcpHttp(
      service,
      numberFlag(args, 'port', config.apiPort + 1),
      flag(args, 'host') ?? config.apiHost
    );
    const close = () => {
      server.close(() => process.exit(0));
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    return;
  }
  await startMcpStdio(service);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help' || args.command === '--help' || args.command === '-h' || has(args, 'help')) {
    stdout.write(HELP);
    return;
  }
  if (args.command === 'version' || args.command === '--version' || args.command === '-v') {
    stdout.write(`${VERSION}\n`);
    return;
  }

  switch (args.command) {
    case 'login':
      await commandLogin(args);
      return;
    case 'token':
      await commandToken(args);
      return;
    case 'logout':
      await commandLogout(args);
      return;
    case 'status':
      await commandStatus(args);
      return;
    case 'courses':
      await commandCourses(args);
      return;
    case 'contents':
    case 'sections':
      await commandContents(args);
      return;
    case 'search':
      await commandSearch(args);
      return;
    case 'content':
      await commandContentSearch(args);
      return;
    case 'files':
      await commandFiles(args);
      return;
    case 'download':
      await commandDownload(args);
      return;
    case 'tui':
      await runTui();
      return;
    case 'api':
      await commandApi(args);
      return;
    case 'mcp':
      await commandMcp(args);
      return;
    default:
      stdout.write(`Comando desconocido: ${args.command}\n\n${HELP}`);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  const evaError = toEvaError(error);
  if (process.argv.includes('--json')) {
    stdout.write(`${JSON.stringify(evaError.toJSON(), null, 2)}\n`);
  } else {
    logger.error('Error', { code: evaError.code, message: evaError.message });
    stdout.write(`Error: ${evaError.message}\n`);
  }
  process.exitCode = 1;
});
