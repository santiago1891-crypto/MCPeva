import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { CookieStore } from '../auth/cookie-store.js';
import { SessionStore } from '../auth/session-store.js';
import { TtlCache } from '../cache.js';
import type {
  ContentSearchHit,
  DownloadedFile,
  EvaActivityDetail,
  EvaAssignment,
  EvaCategory,
  EvaCourse,
  EvaCourseContents,
  EvaCourseSearchResult,
  EvaDiscussionSummary,
  EvaFileSearchHit,
  EvaForum,
  EvaGradeReport,
  EvaModule,
  EvaPost,
  EvaSection,
  EvaSite
} from '../domain/types.js';
import { asArray, asNumber, asRecord, asString, truncate } from '../domain/util.js';
import { fileMatchesName, normalizeExtensions, tokenizeSearch } from '../domain/file-search.js';
import { AuthRequiredError, EvaError, NotFoundError } from '../errors.js';
import { logger } from '../logger.js';
import { HttpClient } from '../eva/http-client.js';
import {
  mapAssignment,
  mapCategory,
  mapCourse,
  mapCourseContents,
  mapDiscussion,
  mapForum,
  mapGradeReport,
  mapModule,
  mapPost,
  mapSubmissionStatus
} from '../eva/mappers.js';
import { WsClient } from '../eva/ws-client.js';
import { WebClient } from '../eva/web-client.js';

type Mode = 'webservice' | 'web' | 'none';

export class EvaService {
  private readonly cache = new TtlCache(config.cacheTtlMs);
  private readonly sessions = new SessionStore();
  private readonly cookies = new CookieStore();
  private http!: HttpClient;
  private web!: WebClient;
  private ws?: WsClient;
  private mode: Mode = 'none';
  private initialized?: Promise<void>;
  private siteUser?: { id?: number; username?: string; fullname?: string };

  async init(): Promise<this> {
    this.initialized ??= this.initialize();
    await this.initialized;
    return this;
  }

  private async initialize(): Promise<void> {
    const session = await this.sessions.load();
    await this.cookies.load(session?.cookies);
    this.http = new HttpClient(config.baseUrl, this.cookies);
    this.web = new WebClient(this.http, config.baseUrl);

    const token = config.token ?? session?.token;
    if (token) {
      this.ws = new WsClient(this.http, token, config.service);
      try {
        const info = await this.ws.getSiteInfo();
        this.mode = 'webservice';
        this.siteUser = { id: info.userid, username: info.username, fullname: info.fullname };
        logger.info('Conectado a EVA por Web Services', { user: info.username, release: info.release });
      } catch (error) {
        logger.warn('El token de EVA no es válido; se intentará usar la sesión web', {
          error: (error as Error).message
        });
        this.ws = undefined;
      }
    }

    if (this.mode !== 'webservice' && !(await this.cookies.isEmpty())) {
      try {
        this.siteUser = await this.web.getUserInfo();
        this.mode = 'web';
        logger.info('Conectado a EVA por sesión web');
      } catch (error) {
        logger.warn('La sesión web guardada no es válida', { error: (error as Error).message });
      }
    }
  }

  get source(): Mode {
    return this.mode;
  }

  private async requireAuth(): Promise<void> {
    await this.init();
    if (this.mode === 'none') {
      throw new AuthRequiredError();
    }
  }

  private async tryWs<T>(functionName: string, fn: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    if (!this.ws) return fallback();
    if (!this.ws.canCall(functionName)) {
      logger.debug('Función WS no disponible en el servicio; usando web', { functionName });
      return fallback();
    }
    try {
      return await fn();
    } catch (error) {
      if (error instanceof EvaError && error.code === 'TOKEN_INVALID') {
        logger.warn('El token de EVA expiró; usando la sesión web', { functionName });
        this.ws = undefined;
        if (this.mode === 'webservice') this.mode = (await this.cookies.isEmpty()) ? 'none' : 'web';
        return fallback();
      }
      logger.warn('Falló la llamada a Web Services; se intenta la web', {
        functionName,
        error: (error as Error).message
      });
      return fallback();
    }
  }

  async status(force = false): Promise<EvaSite> {
    await this.init();
    if (!force) {
      const cached = this.cache.get<EvaSite>('site-status');
      if (cached) return cached;
    }
    let site: EvaSite;
    if (this.mode === 'webservice' && this.ws) {
      const info = await this.ws.getSiteInfo(force);
      site = {
        name: info.sitename,
        url: info.siteurl,
        release: info.release,
        version: info.version,
        auth: 'webservice',
        user: { id: info.userid, username: info.username, fullname: info.fullname, email: info.useremail },
        features: { webservice: true, webSession: !(await this.cookies.isEmpty()), canDownloadFiles: true }
      };
    } else if (this.mode === 'web') {
      site = {
        name: 'EVA FING',
        url: config.baseUrl,
        auth: 'web',
        user: this.siteUser,
        features: { webservice: false, webSession: true, canDownloadFiles: true }
      };
    } else {
      site = {
        name: 'EVA FING',
        url: config.baseUrl,
        auth: 'none',
        features: { webservice: false, webSession: false, canDownloadFiles: false }
      };
    }
    this.cache.set('site-status', site, 60_000);
    return site;
  }

  async getMyCourses(): Promise<EvaCourse[]> {
    await this.requireAuth();
    return this.cache.getOrSet('my-courses', async () => {
      return this.tryWs(
        'core_enrol_get_users_courses',
        async () => {
          const info = await this.ws!.getSiteInfo();
          if (!info.userid) throw new EvaError('UPSTREAM_ERROR', 'El Web Service no informó el usuario autenticado.');
          const raw = await this.ws!.getMyCourses(info.userid);
          return asArray<unknown>(raw).map((course) => mapCourse(course, config.baseUrl));
        },
        () => this.web.getMyCourses()
      );
    }, 60_000);
  }

  async getCourse(courseId: number): Promise<EvaCourse> {
    await this.requireAuth();
    return this.cache.getOrSet(`course:${courseId}`, async () => {
      return this.tryWs(
        'core_course_get_courses_by_field',
        async () => {
          const raw = await this.ws!.getCourseById(courseId);
          if (!raw) throw new NotFoundError(`No se encontró el curso ${courseId}`);
          return mapCourse(raw, config.baseUrl);
        },
        () => this.web.getCourse(courseId)
      );
    }, 300_000);
  }

  async getCourseContents(courseId: number): Promise<EvaCourseContents> {
    await this.requireAuth();
    return this.cache.getOrSet(`contents:${courseId}`, async () => {
      const course = await this.getCourse(courseId);
      return this.tryWs(
        'core_course_get_contents',
        async () => {
          const raw = await this.ws!.getCourseContents(courseId);
          return {
            course,
            sections: mapCourseContents(raw, course, config.baseUrl),
            source: 'webservice' as const,
            fetchedAt: new Date().toISOString()
          };
        },
        async () => {
          const contents = await this.web.getCourseContents(courseId);
          return { ...contents, course: { ...course, ...contents.course } };
        }
      );
    }, 180_000);
  }

  async listSections(courseId: number): Promise<EvaSection[]> {
    const contents = await this.getCourseContents(courseId);
    return contents.sections;
  }

  async getSection(courseId: number, reference: number, by: 'number' | 'id' = 'number'): Promise<EvaSection> {
    const sections = await this.listSections(courseId);
    const section = sections.find((item) => (by === 'number' ? item.number === reference : item.id === reference));
    if (!section) throw new NotFoundError(`No se encontró la sección ${reference} en el curso ${courseId}`);
    return section;
  }

  private findModule(contents: EvaCourseContents, cmid: number): { module: EvaModule; section: EvaSection } | undefined {
    for (const section of contents.sections) {
      const module = section.modules.find((item) => item.id === cmid);
      if (module) return { module, section };
    }
    return undefined;
  }

  async getActivity(cmid: number, courseId?: number, modname?: string, name?: string): Promise<EvaActivityDetail> {
    await this.requireAuth();
    return this.cache.getOrSet(`activity:${cmid}`, async () => {
      let module: EvaModule | undefined;
      let section: EvaSection | undefined;
      let resolvedCourseId = courseId;

      if (this.mode === 'webservice' && this.ws) {
        try {
          const raw = await this.ws.getCourseModule(cmid);
          const cm = asRecord(raw.cm);
          resolvedCourseId = resolvedCourseId ?? asNumber(cm.course);
          const mod = asString(cm.modname) ?? asString(cm.module) ?? modname ?? 'unknown';
          module = mapModule(cm, resolvedCourseId ?? 0, 0, 0, config.baseUrl);
          module.id = cmid;
          module.modname = mod;
          if (!module.name || module.name.startsWith('Actividad ')) module.name = asString(cm.name) ?? name ?? module.name;
          if (!module.url) module.url = `${config.baseUrl}/mod/${mod}/view.php?id=${cmid}`;
        } catch (error) {
          logger.debug('No se pudo obtener el módulo por WS', { cmid, error: (error as Error).message });
        }
      }

      if (resolvedCourseId) {
        try {
          const contents = await this.getCourseContents(resolvedCourseId);
          const found = this.findModule(contents, cmid);
          if (found) {
            section = found.section;
            module = found.module;
          }
        } catch (error) {
          logger.debug('No se pudo ubicar el módulo en el curso', { cmid, error: (error as Error).message });
        }
      }

      const mod = module?.modname ?? modname ?? 'unknown';
      let detail: EvaActivityDetail | undefined;
      try {
        detail = await this.web.getActivity(cmid, {
          courseId: resolvedCourseId ?? 0,
          sectionId: section?.id ?? 0,
          sectionNumber: section?.number ?? 0,
          modname: mod,
          name: module?.name ?? name ?? ''
        });
      } catch (error) {
        if (error instanceof AuthRequiredError && this.mode === 'none') throw error;
        logger.debug('No se pudo leer la página de la actividad', { cmid, error: (error as Error).message });
      }

      if (!module && detail) module = detail.module;
      if (!module) throw new NotFoundError(`No se encontró la actividad ${cmid}`);

      const description = detail?.description ?? module.description;
      const descriptionHtml = detail?.descriptionHtml ?? module.descriptionHtml;
      const result: EvaActivityDetail = {
        module,
        title: detail?.title ?? module.name,
        ...(description ? { description } : {}),
        ...(descriptionHtml ? { descriptionHtml } : {}),
        files: detail?.files?.length ? detail.files : module.contents,
        links: detail?.links ?? [],
        metadata: detail?.metadata ?? {},
        source: this.mode === 'none' ? 'web' : this.mode
      };

      if (mod === 'assign' && resolvedCourseId) {
        try {
          const assignment = await this.getAssignment(resolvedCourseId, cmid);
          result.assignment = assignment;
        } catch {
          // La información de la tarea es opcional.
        }
      } else if (mod === 'forum' && resolvedCourseId) {
        try {
          const forums = await this.listForums(resolvedCourseId);
          const forum = forums.find((item) => item.cmid === cmid);
          if (forum) {
            result.forum = forum;
            const discussions = await this.getForumDiscussions(forum.id, forum.cmid, resolvedCourseId);
            result.discussions = discussions;
          }
        } catch {
          // La información del foro es opcional.
        }
      }

      return result;
    }, 120_000);
  }

  async listAssignments(courseId: number): Promise<EvaAssignment[]> {
    await this.requireAuth();
    return this.cache.getOrSet(`assignments:${courseId}`, async () => {
      return this.tryWs(
        'mod_assign_get_assignments',
        async () => {
          const raw = await this.ws!.getAssignments([courseId]);
          const courses = asArray<Record<string, unknown>>(raw.courses);
          const course = courses.find((item) => asNumber(item.id) === courseId) ?? courses[0];
          return asArray<Record<string, unknown>>(course?.assignments).map((item) => mapAssignment(item, courseId, config.baseUrl));
        },
        async () => {
          const contents = await this.getCourseContents(courseId);
          return contents.sections
            .flatMap((section) => section.modules)
            .filter((module) => module.modname === 'assign')
            .map((module): EvaAssignment => ({
              id: module.instanceId ?? 0,
              courseId,
              cmid: module.id,
              name: module.name,
              ...(module.description ? { intro: module.description } : {}),
              ...(module.dates?.due ? { dueDate: module.dates.due } : {}),
              url: module.url ?? `${config.baseUrl}/mod/assign/view.php?id=${module.id}`
            }));
        }
      );
    }, 120_000);
  }

  async getAssignment(courseId: number, cmidOrId: number): Promise<EvaAssignment> {
    const assignments = await this.listAssignments(courseId);
    const assignment = assignments.find((item) => item.cmid === cmidOrId || item.id === cmidOrId);
    if (!assignment) throw new NotFoundError(`No se encontró la tarea ${cmidOrId} en el curso ${courseId}`);
    if (this.mode !== 'webservice' || !this.ws || !assignment.id) return assignment;
    if (!this.ws.canCall('mod_assign_get_submission_status')) return assignment;
    try {
      const info = await this.ws.getSiteInfo();
      const status = await this.ws.getAssignmentSubmissionStatus(assignment.id, info.userid);
      return { ...assignment, submission: mapSubmissionStatus(status) };
    } catch (error) {
      logger.debug('No se pudo obtener el estado de la entrega', { assignment: assignment.id, error: (error as Error).message });
      return assignment;
    }
  }

  async listForums(courseId: number): Promise<EvaForum[]> {
    await this.requireAuth();
    return this.cache.getOrSet(`forums:${courseId}`, async () => {
      return this.tryWs(
        'mod_forum_get_forums_by_courses',
        async () => {
          const raw = await this.ws!.getForums([courseId]);
          return asArray<unknown>(raw).map((forum) => mapForum(forum, courseId, config.baseUrl));
        },
        async () => {
          const contents = await this.getCourseContents(courseId);
          return contents.sections
            .flatMap((section) => section.modules)
            .filter((module) => module.modname === 'forum')
            .map((module): EvaForum => ({
              id: module.instanceId ?? 0,
              courseId,
              cmid: module.id,
              name: module.name,
              ...(module.description ? { intro: module.description } : {}),
              url: module.url ?? `${config.baseUrl}/mod/forum/view.php?id=${module.id}`
            }));
        }
      );
    }, 120_000);
  }

  async getForumDiscussions(forumId: number, cmid: number, courseId: number, page = 0, perPage = 20): Promise<EvaDiscussionSummary[]> {
    await this.requireAuth();
    return this.cache.getOrSet(`discussions:${forumId}:${page}:${perPage}`, async () => {
      return this.tryWs(
        'mod_forum_get_forum_discussions',
        async () => {
          const raw = await this.ws!.getForumDiscussions(forumId, page, perPage);
          return asArray<Record<string, unknown>>(raw.discussions).map((discussion) => mapDiscussion(discussion, forumId, config.baseUrl));
        },
        async () => {
          const forum = await this.web.getForum(forumId, cmid, courseId);
          return forum.discussions;
        }
      );
    }, 60_000);
  }

  async getDiscussionPosts(discussionId: number): Promise<EvaPost[]> {
    await this.requireAuth();
    return this.cache.getOrSet(`posts:${discussionId}`, async () => {
      return this.tryWs(
        'mod_forum_get_forum_discussion_posts',
        async () => {
          const raw = await this.ws!.getDiscussionPosts(discussionId);
          return asArray<Record<string, unknown>>(raw.posts).map((post) => mapPost(post, config.baseUrl));
        },
        () => this.web.getDiscussion(discussionId)
      );
    }, 60_000);
  }

  async getGrades(courseId: number, userId?: number): Promise<EvaGradeReport> {
    await this.requireAuth();
    if (this.mode !== 'webservice' || !this.ws || !this.ws.canCall('gradereport_user_get_grade_items')) {
      throw new EvaError('NOT_ALLOWED', 'Las calificaciones requieren un token de Web Services de EVA. Ejecutá "npm run login" o configurá EVA_TOKEN.');
    }
    return this.cache.getOrSet(`grades:${courseId}:${userId ?? 'me'}`, async () => {
      const info = await this.ws!.getSiteInfo();
      const raw = await this.ws!.getGradeItems(courseId, userId ?? info.userid);
      return mapGradeReport(raw, courseId);
    }, 120_000);
  }

  async getCategories(parentId = 0): Promise<EvaCategory[]> {
    await this.requireAuth();
    return this.cache.getOrSet(`categories:${parentId}`, async () => {
      return this.tryWs(
        'core_course_get_categories',
        async () => {
          const raw = await this.ws!.getCategories(parentId);
          return asArray<unknown>(raw).map((category) => mapCategory(category, config.baseUrl));
        },
        async () => (await this.web.getCategory(parentId)).categories
      );
    }, 600_000);
  }

  async browseCategory(parentId = 0): Promise<{ categories: EvaCategory[]; courses: EvaCourse[] }> {
    await this.requireAuth();
    return this.cache.getOrSet(`browse-category:${parentId}`, async () => {
      if (this.mode === 'webservice' && this.ws) {
        try {
          const categories = await this.getCategories(parentId);
          return { categories, courses: [] };
        } catch {
          // Si el WS no puede listar cursos de la categoría, usamos la web.
        }
      }
      return this.web.getCategory(parentId);
    }, 300_000);
  }

  async searchCourses(query: string, limit = 30): Promise<EvaCourseSearchResult> {
    await this.requireAuth();
    return this.cache.getOrSet(`search-courses:${query}:${limit}`, async () => {
      return this.tryWs(
        'core_course_search_courses',
        async () => {
          const raw = await this.ws!.searchCourses(query, 0, limit);
          const courses = asArray<unknown>(raw.courses).map((course) => mapCourse(course, config.baseUrl));
          return { query, total: asNumber(raw.total) ?? courses.length, courses, source: 'webservice' as const };
        },
        () => this.web.searchCourses(query)
      );
    }, 300_000);
  }

  async searchContent(query: string, courseIds?: number[], limit = 60): Promise<ContentSearchHit[]> {
    await this.requireAuth();
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const courses = courseIds?.length
      ? await Promise.all(courseIds.slice(0, 30).map(async (id) => this.getCourse(id).catch(() => undefined)))
      : (await this.getMyCourses()).slice(0, 30);
    const selected = courses.filter((course): course is EvaCourse => Boolean(course));
    const hits: ContentSearchHit[] = [];
    const queue = [...selected];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (;;) {
        const course = queue.shift();
        if (!course) return;
        try {
          const contents = await this.getCourseContents(course.id);
          const match = (value: string | undefined): boolean => Boolean(value?.toLowerCase().includes(needle));
          if (match(course.fullname) || match(course.summary)) {
            hits.push({
              courseId: course.id,
              courseName: course.fullname,
              kind: 'course',
              snippet: truncate(course.summary ?? course.fullname, 240),
              url: course.url
            });
          }
          for (const section of contents.sections) {
            if (match(section.name) || match(section.summary)) {
              hits.push({
                courseId: course.id,
                courseName: course.fullname,
                sectionId: section.id,
                sectionName: section.name,
                kind: 'section',
                snippet: truncate(section.summary ?? section.name, 240),
                url: `${course.url}&section=${section.number}`
              });
            }
            for (const module of section.modules) {
              if (!match(module.name) && !match(module.description)) continue;
              hits.push({
                courseId: course.id,
                courseName: course.fullname,
                sectionId: section.id,
                sectionName: section.name,
                moduleId: module.id,
                moduleName: module.name,
                modname: module.modname,
                kind: 'module',
                snippet: truncate(module.description ?? module.name, 240),
                ...(module.url ? { url: module.url } : {})
              });
            }
          }
        } catch (error) {
          logger.debug('No se pudo indexar el curso para búsqueda', { courseId: course.id, error: (error as Error).message });
        }
        if (hits.length >= limit) return;
      }
    });
    await Promise.all(workers);
    return hits.slice(0, limit);
  }

  async searchFiles(
    query: string,
    options: { courseIds?: number[]; extensions?: string[]; limit?: number } = {}
  ): Promise<EvaFileSearchHit[]> {
    await this.requireAuth();
    const tokens = tokenizeSearch(query);
    const extensions = normalizeExtensions(options.extensions);
    if (!tokens.length && !extensions.length) {
      throw new EvaError('INVALID_INPUT', 'Indicá un texto o una extensión de archivo (por ejemplo, pdf).');
    }
    const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
    const courses = options.courseIds?.length
      ? await Promise.all(options.courseIds.slice(0, 30).map(async (id) => this.getCourse(id).catch(() => undefined)))
      : (await this.getMyCourses()).slice(0, 30);
    const selected = courses.filter((course): course is EvaCourse => Boolean(course));
    const hits: EvaFileSearchHit[] = [];
    const seen = new Set<string>();
    const queue = [...selected];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (;;) {
        const course = queue.shift();
        if (!course || hits.length >= limit) return;
        try {
          const contents = await this.getCourseContents(course.id);
          for (const section of contents.sections) {
            for (const module of section.modules) {
              for (const file of module.contents) {
                if (hits.length >= limit) return;
                if (!fileMatchesName(file.filename, tokens, extensions, file.mimeType)) continue;
                if (seen.has(file.url)) continue;
                seen.add(file.url);
                hits.push({
                  filename: file.filename,
                  ...(file.filepath ? { filepath: file.filepath } : {}),
                  ...(file.size !== undefined ? { size: file.size } : {}),
                  ...(file.mimeType ? { mimeType: file.mimeType } : {}),
                  url: file.url,
                  ...(file.modifiedAt ? { modifiedAt: file.modifiedAt } : {}),
                  courseId: course.id,
                  courseName: course.fullname,
                  sectionId: section.id,
                  sectionName: section.name,
                  sectionNumber: section.number,
                  moduleId: module.id,
                  moduleName: module.name,
                  modname: module.modname
                });
              }
            }
          }
        } catch (error) {
          logger.debug('No se pudo indexar los archivos del curso', {
            courseId: course.id,
            error: (error as Error).message
          });
        }
      }
    });
    await Promise.all(workers);
    return hits.slice(0, limit);
  }

  private fileUrlWithAuth(url: string): string {
    if (!this.ws || !url.includes('/webservice/pluginfile.php')) return url;
    if (/[?&]token=/.test(url)) return url;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.ws.token)}`;
  }

  async downloadFile(fileUrl: string, filename?: string): Promise<DownloadedFile> {
    await this.requireAuth();
    let url: URL;
    try {
      url = new URL(fileUrl, config.baseUrl);
    } catch {
      throw new EvaError('INVALID_INPUT', 'La URL del archivo no es válida.');
    }
    if (url.host !== config.siteHost) {
      throw new EvaError('NOT_ALLOWED', `Solo se pueden descargar archivos alojados en ${config.siteHost}.`);
    }

    if (/\/mod\/(resource|url)\/view\.php/.test(url.pathname)) {
      const resolved = await this.http.resolveRedirect(url.toString());
      url = new URL(resolved.url, config.baseUrl);
    }

    const target = this.fileUrlWithAuth(url.toString());
    const { response, finalUrl } = await this.http.fetchResponse(target, {
      headers: { accept: '*/*' },
      followRedirects: true
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new EvaError('UPSTREAM_ERROR', `No se pudo descargar el archivo (HTTP ${response.status}).`, {
        status: response.status
      });
    }
    if (new URL(finalUrl).pathname.startsWith('/login/')) {
      await response.body?.cancel();
      throw new AuthRequiredError();
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/html') && !/pluginfile\.php/.test(new URL(finalUrl).pathname)) {
      await response.body?.cancel();
      throw new EvaError('NOT_ALLOWED', 'La URL no parece apuntar a un archivo descargable.');
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength && contentLength > config.maxDownloadBytes) {
      await response.body?.cancel();
      throw new EvaError('DOWNLOAD_TOO_LARGE', `El archivo supera el límite de ${config.maxDownloadBytes} bytes.`);
    }

    const safeName = this.filenameFromResponse(response.headers.get('content-disposition'), filename ?? basename(decodeURIComponent(new URL(finalUrl).pathname))) ?? 'archivo';
    await fs.mkdir(config.downloadsDir, { recursive: true });
    const finalPath = await this.uniquePath(config.downloadsDir, safeName);
    const relativePath = relative(resolve(config.downloadsDir), resolve(finalPath));
    if (relativePath.startsWith('..')) throw new EvaError('NOT_ALLOWED', 'Nombre de archivo inválido.');

    const source = response.body;
    if (!source) {
      throw new EvaError('UPSTREAM_ERROR', 'La respuesta no contiene datos.');
    }

    let written = 0;
    const output = createWriteStream(finalPath);
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        written += chunk.length;
        if (written > config.maxDownloadBytes) {
          callback(new EvaError('DOWNLOAD_TOO_LARGE', `El archivo supera el límite de ${config.maxDownloadBytes} bytes.`));
          return;
        }
        callback(null, chunk);
      }
    });

    try {
      await pipeline(Readable.fromWeb(source as unknown as import('node:stream/web').ReadableStream), counter, output);
    } catch (error) {
      output.destroy();
      await fs.rm(finalPath, { force: true });
      throw error;
    }

    return {
      filename: basename(finalPath),
      path: finalPath,
      size: written,
      ...(response.headers.get('content-type') ? { mimeType: response.headers.get('content-type') ?? undefined } : {}),
      sourceUrl: finalUrl
    };
  }

  private filenameFromResponse(disposition: string | null, fallback: string): string {
    if (disposition) {
      const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
      if (utf8?.[1]) return this.sanitizeFilename(decodeURIComponent(utf8[1]));
      const quoted = /filename="?([^";]+)"?/i.exec(disposition);
      if (quoted?.[1]) return this.sanitizeFilename(quoted[1]);
    }
    return this.sanitizeFilename(fallback);
  }

  private sanitizeFilename(value: string): string {
    const cleaned = value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^\.+/, '')
      .trim();
    return (cleaned || 'archivo').slice(0, 180);
  }

  private async uniquePath(directory: string, filename: string): Promise<string> {
    const extension = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
    const base = extension ? filename.slice(0, -extension.length) : filename;
    let candidate = join(directory, filename);
    let index = 1;
    while (true) {
      try {
        await fs.access(candidate);
        candidate = join(directory, `${base} (${index})${extension}`);
        index += 1;
      } catch {
        return candidate;
      }
    }
  }
}
