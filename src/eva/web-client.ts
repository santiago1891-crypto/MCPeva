import type { HttpClient } from './http-client.js';
import { EvaError } from '../errors.js';
import { AuthRequiredError } from '../errors.js';
import type {
  EvaActivityDetail,
  EvaCategory,
  EvaCourse,
  EvaCourseContents,
  EvaCourseSearchResult,
  EvaDiscussionSummary,
  EvaForum,
  EvaPost
} from '../domain/types.js';
import {
  parseActivityPage,
  parseCategoryPage,
  parseCourseList,
  parseCoursePage,
  parseDiscussionPage,
  parseForumPage,
  parseLoginRequired,
  parseSearchResults,
  parseUserInfo
} from './web-parsers.js';

export interface WebPage {
  html: string;
  url: string;
  status: number;
}

export class WebClient {
  private sesskeyCache?: string;

  constructor(
    readonly http: HttpClient,
    readonly baseUrl: string
  ) {}

  private async read(path: string): Promise<WebPage> {
    const page = await this.http.request(path, { headers: { accept: 'text/html,application/xhtml+xml' } });
    if (new URL(page.url).pathname.startsWith('/login/') || parseLoginRequired(page.text)) {
      throw new AuthRequiredError('La sesión web de EVA expiró o no es válida. Volvé a ejecutar "npm run login".');
    }
    return { html: page.text, url: page.url, status: page.status };
  }

  async get(path: string): Promise<WebPage> {
    return this.read(path);
  }

  getSesskeyFromHtml(html: string): string | undefined {
    const configMatch = /"sesskey"\s*:\s*"([^"]+)"/.exec(html);
    if (configMatch?.[1]) return configMatch[1];
    const inputMatch = /name=["']sesskey["']\s+value=["']([^"']+)["']/i.exec(html);
    return inputMatch?.[1];
  }

  async sesskey(force = false): Promise<string> {
    if (this.sesskeyCache && !force) return this.sesskeyCache;
    const page = await this.http.request(`${this.baseUrl}/my/`, { headers: { accept: 'text/html' } });
    const sesskey = this.getSesskeyFromHtml(page.text);
    if (!sesskey) throw new AuthRequiredError('No se pudo obtener el sesskey de EVA. La sesión no es válida.');
    this.sesskeyCache = sesskey;
    return sesskey;
  }

  async ajax<T = unknown>(methodName: string, args: Record<string, unknown> = {}): Promise<T> {
    const sesskey = await this.sesskey();
    const response = await this.http.request(`${this.baseUrl}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify([{ index: 0, methodname: methodName, args }])
    });
    let payload: unknown;
    try {
      payload = JSON.parse(response.text);
    } catch {
      throw new EvaError('UPSTREAM_ERROR', 'Respuesta inválida de AJAX de Moodle', { details: response.text.slice(0, 300) });
    }
    if (!Array.isArray(payload) || !payload[0]) {
      throw new EvaError('UPSTREAM_ERROR', 'Formato inesperado de AJAX de Moodle');
    }
    const first = payload[0] as { error?: unknown; data?: unknown };
    if (first.error) {
      const message = typeof first.error === 'object' && first.error && 'message' in first.error ? String((first.error as { message: unknown }).message) : 'Error de AJAX';
      throw new EvaError('UPSTREAM_ERROR', message, { details: first.error });
    }
    return first.data as T;
  }

  async getMyCourses(): Promise<EvaCourse[]> {
    const options = { includeNavigation: true };
    const page = await this.read(`${this.baseUrl}/my/courses.php`);
    const courses = parseCourseList(page.html, this.baseUrl, undefined, options);
    if (courses.length) return courses;
    const dashboard = await this.read(`${this.baseUrl}/my/`);
    return parseCourseList(dashboard.html, this.baseUrl, undefined, options);
  }

  async getCourse(courseId: number): Promise<EvaCourse> {
    const page = await this.read(`${this.baseUrl}/course/view.php?id=${courseId}`);
    return parseCoursePage(page.html, this.baseUrl, courseId).course;
  }

  async getCourseContents(courseId: number): Promise<EvaCourseContents> {
    const page = await this.read(`${this.baseUrl}/course/view.php?id=${courseId}`);
    const parsed = parseCoursePage(page.html, this.baseUrl, courseId);
    const isOneTopic = /format-onetopic/.test(page.html) && parsed.tabs.length > 1;
    let sections = parsed.sections;

    if (isOneTopic) {
      const collected = new Map<number, (typeof sections)[number]>();
      for (const tab of parsed.tabs.slice(0, 80)) {
        try {
          const sectionPage =
            tab.number === parsed.sections[0]?.number
              ? page
              : await this.read(`${this.baseUrl}/course/view.php?id=${courseId}&section=${tab.number}`);
          const sectionParsed = parseCoursePage(sectionPage.html, this.baseUrl, courseId);
          const candidate = sectionParsed.sections.find((section) => section.number === tab.number);
          if (!candidate) {
            // La sección no se renderizó (por ejemplo, está vacía u oculta).
            // Conservamos la entrada del índice para no perder la navegación.
            const previous = collected.get(tab.number);
            if (!previous) {
              collected.set(tab.number, {
                id: tab.number,
                courseId,
                number: tab.number,
                name: tab.name || `Sección ${tab.number}`,
                visible: true,
                userVisible: true,
                modules: []
              });
            }
            continue;
          }
          const previous = collected.get(tab.number);
          const modules = [...(previous?.modules ?? []), ...candidate.modules];
          collected.set(tab.number, {
            ...candidate,
            id: candidate.id || tab.number,
            number: tab.number,
            name: tab.name || candidate.name,
            modules
          });
        } catch (error) {
          if (error instanceof AuthRequiredError) throw error;
          // Una sección inaccesible no debe romper el curso completo.
        }
      }
      sections = [...collected.values()].sort((a, b) => a.number - b.number);
    }

    return {
      course: parsed.course,
      sections,
      source: 'web',
      fetchedAt: new Date().toISOString()
    };
  }

  async getCategory(parentId = 0): Promise<{ categories: EvaCategory[]; courses: EvaCourse[] }> {
    const page = await this.read(`${this.baseUrl}/course/index.php?categoryid=${parentId}`);
    return parseCategoryPage(page.html, this.baseUrl, parentId);
  }

  async searchCourses(query: string): Promise<EvaCourseSearchResult> {
    const page = await this.read(`${this.baseUrl}/course/search.php?search=${encodeURIComponent(query)}`);
    const result = parseSearchResults(page.html, this.baseUrl);
    return { query, total: result.total, courses: result.courses, source: 'web' };
  }

  async getActivity(
    cmid: number,
    fallback?: { courseId: number; sectionId: number; sectionNumber: number; modname: string; name: string }
  ): Promise<EvaActivityDetail> {
    const modname = fallback?.modname;
    const candidates = modname
      ? [`${this.baseUrl}/mod/${modname}/view.php?id=${cmid}`]
      : [
          `${this.baseUrl}/mod/resource/view.php?id=${cmid}`,
          `${this.baseUrl}/mod/forum/view.php?id=${cmid}`,
          `${this.baseUrl}/mod/assign/view.php?id=${cmid}`,
          `${this.baseUrl}/mod/url/view.php?id=${cmid}`,
          `${this.baseUrl}/mod/page/view.php?id=${cmid}`
        ];
    let lastError: unknown;
    for (const url of candidates) {
      try {
        const page = await this.read(url);
        return parseActivityPage(page.html, this.baseUrl, {
          courseId: fallback?.courseId ?? 0,
          sectionId: fallback?.sectionId ?? 0,
          sectionNumber: fallback?.sectionNumber ?? 0,
          cmid,
          modname: modname ?? 'unknown',
          name: fallback?.name ?? ''
        });
      } catch (error) {
        lastError = error;
      }
    }
    throw(lastError);
  }

  async getForum(forumId: number, cmid: number, courseId: number, name = 'Foro'): Promise<{ forum: EvaForum; discussions: EvaDiscussionSummary[] }> {
    const page = await this.read(`${this.baseUrl}/mod/forum/view.php?id=${cmid}`);
    return {
      forum: { id: forumId, courseId, cmid, name, url: `${this.baseUrl}/mod/forum/view.php?id=${cmid}` },
      discussions: parseForumPage(page.html, this.baseUrl, forumId)
    };
  }

  async getDiscussion(discussionId: number): Promise<EvaPost[]> {
    const page = await this.read(`${this.baseUrl}/mod/forum/discuss.php?d=${discussionId}`);
    return parseDiscussionPage(page.html, this.baseUrl, discussionId);
  }

  async getUserInfo(): Promise<{ id?: number; fullname?: string; username?: string }> {
    const page = await this.read(`${this.baseUrl}/my/`);
    return parseUserInfo(page.html);
  }
}
