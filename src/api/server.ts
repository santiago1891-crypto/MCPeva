import { createReadStream } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { config } from '../config.js';
import { EvaError, toEvaError, NotFoundError } from '../errors.js';
import { logger } from '../logger.js';
import type { EvaService } from '../services/eva-service.js';
import type { EvaSection } from '../domain/types.js';

function parseId(value: unknown, name: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new EvaError('INVALID_INPUT', `${name} debe ser un número entero positivo.`);
  return id;
}

function parseOptionalId(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return parseId(value, name);
}

function parseSectionRef(value: unknown): number {
  const reference = Number(value);
  if (!Number.isInteger(reference) || reference < 0) {
    throw new EvaError('INVALID_INPUT', 'section debe ser un número entero mayor o igual a 0.');
  }
  return reference;
}

function parseCsvIds(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const ids = value.split(',').map((item) => Number(item.trim()));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new EvaError('INVALID_INPUT', 'courseIds debe ser una lista de IDs separada por comas.');
  }
  return ids;
}

function summarizeSection(section: EvaSection): Omit<EvaSection, 'modules'> & { moduleCount: number } {
  const { modules, ...rest } = section;
  return { ...rest, moduleCount: modules.length };
}

export async function buildApi(service: EvaService): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });

  await app.register(cors, { origin: true });

  app.addHook('onRequest', async (request, reply) => {
    if (!config.apiKey) return;
    if (request.url === '/health') return;
    const header = request.headers['x-api-key'];
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (header !== config.apiKey && bearer !== config.apiKey) {
      await reply.status(401).send({ error: { code: 'AUTH_REQUIRED', message: 'API key inválida o ausente.' } });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const evaError = toEvaError(error);
    const status =
      evaError.code === 'AUTH_REQUIRED' || evaError.code === 'AUTH_FAILED' || evaError.code === 'TOKEN_INVALID'
        ? 401
        : evaError.code === 'NOT_FOUND'
          ? 404
          : evaError.code === 'INVALID_INPUT'
            ? 400
            : evaError.code === 'NOT_ALLOWED'
              ? 403
              : evaError.code === 'DOWNLOAD_TOO_LARGE'
                ? 413
                : 502;
    if (!(evaError instanceof EvaError) || status >= 500) logger.error('Error en API', { error: evaError.message });
    return reply.status(status).send(evaError.toJSON());
  });

  app.get('/health', async () => ({ ok: true, name: 'mcp-eva', version: '0.1.0', time: new Date().toISOString() }));

  app.get('/api/status', async () => service.status(true));

  app.get('/api/courses', async (request) => {
    const query = request.query as Record<string, unknown>;
    const q = typeof query.q === 'string' ? query.q.trim() : '';
    const categoryId = parseOptionalId(query.categoryId, 'categoryId');
    if (q) return service.searchCourses(q, Number(query.limit) || 30);
    if (categoryId !== undefined) {
      const result = await service.browseCategory(categoryId);
      return { courses: result.courses, categories: result.categories, count: result.courses.length };
    }
    const courses = await service.getMyCourses();
    return { courses, count: courses.length };
  });

  app.get('/api/courses/:id', async (request) => {
    const { id } = request.params as { id: string };
    return service.getCourse(parseId(id, 'id'));
  });

  app.get('/api/courses/:id/contents', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    const contents = await service.getCourseContents(parseId(id, 'id'));
    if (query.includeModules === 'false') {
      return { ...contents, sections: contents.sections.map(summarizeSection) };
    }
    return contents;
  });

  app.get('/api/courses/:id/sections', async (request) => {
    const { id } = request.params as { id: string };
    const sections = await service.listSections(parseId(id, 'id'));
    return { sections, count: sections.length };
  });

  app.get('/api/courses/:id/sections/:section', async (request) => {
    const { id, section } = request.params as { id: string; section: string };
    const query = request.query as Record<string, unknown>;
    const by = query.by === 'id' ? 'id' : 'number';
    return service.getSection(parseId(id, 'id'), parseSectionRef(section), by);
  });

  app.get('/api/courses/:id/assignments', async (request) => {
    const { id } = request.params as { id: string };
    const assignments = await service.listAssignments(parseId(id, 'id'));
    return { assignments, count: assignments.length };
  });

  app.get('/api/courses/:id/assignments/:cmid', async (request) => {
    const { id, cmid } = request.params as { id: string; cmid: string };
    return service.getAssignment(parseId(id, 'id'), parseId(cmid, 'cmid'));
  });

  app.get('/api/courses/:id/forums', async (request) => {
    const { id } = request.params as { id: string };
    const forums = await service.listForums(parseId(id, 'id'));
    return { forums, count: forums.length };
  });

  app.get('/api/courses/:id/forums/:forumId/discussions', async (request) => {
    const { id, forumId } = request.params as { id: string; forumId: string };
    const query = request.query as Record<string, unknown>;
    const courseId = parseId(id, 'id');
    const cmid = parseOptionalId(query.cmid, 'cmid');
    if (!cmid) throw new EvaError('INVALID_INPUT', 'Falta el parámetro cmid.');
    const discussions = await service.getForumDiscussions(
      parseId(forumId, 'forumId'),
      cmid,
      courseId,
      Number(query.page) || 0,
      Number(query.perPage) || 20
    );
    return { discussions, count: discussions.length };
  });

  app.get('/api/discussions/:id/posts', async (request) => {
    const { id } = request.params as { id: string };
    const posts = await service.getDiscussionPosts(parseId(id, 'id'));
    return { posts, count: posts.length };
  });

  app.get('/api/courses/:id/grades', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    return service.getGrades(parseId(id, 'id'), parseOptionalId(query.userId, 'userId'));
  });

  app.get('/api/activities/:cmid', async (request) => {
    const { cmid } = request.params as { cmid: string };
    const query = request.query as Record<string, unknown>;
    return service.getActivity(
      parseId(cmid, 'cmid'),
      parseOptionalId(query.courseId, 'courseId'),
      typeof query.modname === 'string' ? query.modname : undefined,
      typeof query.name === 'string' ? query.name : undefined
    );
  });

  app.get('/api/categories', async (request) => {
    const query = request.query as Record<string, unknown>;
    const parentId = parseOptionalId(query.parentId, 'parentId') ?? 0;
    const categories = await service.getCategories(parentId);
    return { categories, count: categories.length };
  });

  app.get('/api/categories/:id/browse', async (request) => {
    const { id } = request.params as { id: string };
    return service.browseCategory(parseId(id, 'id'));
  });

  app.get('/api/search/courses', async (request) => {
    const query = request.query as Record<string, unknown>;
    if (typeof query.q !== 'string' || !query.q.trim()) throw new EvaError('INVALID_INPUT', 'Falta el parámetro q.');
    return service.searchCourses(query.q.trim(), Number(query.limit) || 30);
  });

  app.get('/api/search/content', async (request) => {
    const query = request.query as Record<string, unknown>;
    if (typeof query.q !== 'string' || !query.q.trim()) throw new EvaError('INVALID_INPUT', 'Falta el parámetro q.');
    const hits = await service.searchContent(
      query.q.trim(),
      parseCsvIds(query.courseIds),
      Math.min(Number(query.limit) || 60, 200)
    );
    return { hits, count: hits.length };
  });

  app.get('/api/search/files', async (request) => {
    const query = request.query as Record<string, unknown>;
    const q = typeof query.q === 'string' ? query.q.trim() : '';
    const extensions =
      typeof query.ext === 'string'
        ? query.ext.split(',')
        : typeof query.extensions === 'string'
          ? query.extensions.split(',')
          : undefined;
    const files = await service.searchFiles(q, {
      extensions,
      courseIds: parseCsvIds(query.courseIds),
      limit: Math.min(Number(query.limit) || 60, 200)
    });
    return { files, count: files.length };
  });

  app.post('/api/files/download', async (request) => {
    const body = request.body as Record<string, unknown> | undefined;
    const url = typeof body?.url === 'string' ? body.url : undefined;
    if (!url) throw new EvaError('INVALID_INPUT', 'Falta el campo url.');
    const filename = typeof body?.filename === 'string' ? body.filename : undefined;
    return service.downloadFile(url, filename);
  });

  app.get('/api/download', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    if (typeof query.url !== 'string') throw new EvaError('INVALID_INPUT', 'Falta el parámetro url.');
    const file = await service.downloadFile(query.url, typeof query.filename === 'string' ? query.filename : undefined);
    reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    reply.header('content-length', String(file.size));
    return reply.type(file.mimeType ?? 'application/octet-stream').send(createReadStream(file.path));
  });

  app.setNotFoundHandler((_request, reply) => {
    const error = new NotFoundError('Ruta no encontrada.');
    return reply.status(404).send(error.toJSON());
  });

  return app;
}

export async function startApi(service: EvaService, port = config.apiPort, host = config.apiHost): Promise<FastifyInstance> {
  const app = await buildApi(service);
  await app.listen({ port, host });
  logger.info('API REST de EVA escuchando', { url: `http://${host}:${port}` });
  return app;
}
