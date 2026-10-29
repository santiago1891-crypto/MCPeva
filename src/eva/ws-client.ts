import type { HttpClient } from './http-client.js';
import { EvaError } from '../errors.js';

export interface WsSiteInfo {
  sitename: string;
  siteurl: string;
  release?: string;
  version?: string;
  userid?: number;
  username?: string;
  fullname?: string;
  useremail?: string;
  functions: Array<{ name: string; version?: string }>;
}

interface WsErrorPayload {
  exception?: string;
  errorcode?: string;
  message?: string;
  debuginfo?: string;
}

function appendParams(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendParams(params, `${key}[${index}]`, item));
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      appendParams(params, `${key}[${childKey}]`, childValue);
    }
    return;
  }
  params.append(key, String(value));
}

export class WsClient {
  private siteInfoCache?: WsSiteInfo;
  private readonly functions = new Set<string>();

  constructor(
    private readonly http: HttpClient,
    readonly token: string,
    readonly service = 'moodle_mobile_app'
  ) {}

  static isAvailable(): boolean {
    return true;
  }

  async call<T = unknown>(functionName: string, params: Record<string, unknown> = {}): Promise<T> {
    const body = new URLSearchParams({
      wstoken: this.token,
      wsfunction: functionName,
      moodlewsrestformat: 'json',
      wsformat: 'json'
    });
    for (const [key, value] of Object.entries(params)) appendParams(body, key, value);

    const response = await this.http.request(`${this.http.baseUrl}/webservice/rest/server.php`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
      useCookies: false,
      throwOnError: false
    });

    let payload: unknown;
    try {
      payload = JSON.parse(response.text);
    } catch {
      throw new EvaError('UPSTREAM_ERROR', `Respuesta no JSON de Moodle al llamar ${functionName}`, {
        status: response.status,
        details: { body: response.text.slice(0, 500) }
      });
    }

    const error = payload as WsErrorPayload;
    if (error && typeof error === 'object' && error.exception) {
      if (error.errorcode === 'invalidtoken') {
        throw new EvaError('TOKEN_INVALID', 'El token de EVA no es válido o expiró.', { details: error });
      }
      if (error.errorcode === 'accessexception' || error.errorcode === 'invalidfunction') {
        throw new EvaError('NOT_ALLOWED', `La función ${functionName} no está habilitada para este token.`, { details: error });
      }
      throw new EvaError('UPSTREAM_ERROR', error.message ?? `Error de Moodle en ${functionName}`, { details: error });
    }

    return payload as T;
  }

  canCall(functionName: string): boolean {
    if (this.functions.size === 0) return true;
    return this.functions.has(functionName);
  }

  async getSiteInfo(force = false): Promise<WsSiteInfo> {
    if (this.siteInfoCache && !force) return this.siteInfoCache;
    const raw = await this.call<Record<string, unknown>>('core_webservice_get_site_info');
    const functions = Array.isArray(raw.functions)
      ? (raw.functions as Array<Record<string, unknown>>)
          .map((item) => ({ name: String(item.name ?? ''), version: item.version ? String(item.version) : undefined }))
          .filter((item) => item.name)
      : [];
    const info: WsSiteInfo = {
      sitename: String(raw.sitename ?? 'EVA'),
      siteurl: String(raw.siteurl ?? this.http.baseUrl),
      release: raw.release ? String(raw.release) : undefined,
      version: raw.version ? String(raw.version) : undefined,
      userid: raw.userid ? Number(raw.userid) : undefined,
      username: raw.username ? String(raw.username) : undefined,
      fullname: raw.fullname ? String(raw.fullname) : undefined,
      useremail: raw.useremail ? String(raw.useremail) : undefined,
      functions
    };
    this.siteInfoCache = info;
    this.functions.clear();
    for (const fn of functions) this.functions.add(fn.name);
    return info;
  }

  async getMyCourses(userId: number): Promise<unknown[]> {
    return this.call<unknown[]>('core_enrol_get_users_courses', { userid: userId });
  }

  async getCoursesByIds(ids: number[]): Promise<unknown[]> {
    return this.call<unknown[]>('core_course_get_courses_by_field', { field: 'ids', value: ids });
  }

  async getCourseById(id: number): Promise<unknown | undefined> {
    const result = await this.call<{ courses?: unknown[] }>('core_course_get_courses_by_field', {
      field: 'id',
      value: id
    });
    return result.courses?.[0];
  }

  async getCourseContents(courseId: number): Promise<unknown[]> {
    return this.call<unknown[]>('core_course_get_contents', { courseid: courseId });
  }

  async searchCourses(query: string, page = 0, perPage = 20): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>('core_course_search_courses', {
      criterianame: 'search',
      criteriavalue: query,
      page,
      perpage: perPage
    });
  }

  async getCategories(parentId = 0, addSubcategories = false): Promise<unknown[]> {
    return this.call<unknown[]>('core_course_get_categories', {
      criteria: [{ key: 'parent', value: parentId }],
      addsubcategories: addSubcategories ? 1 : 0
    });
  }

  async getCourseModule(cmid: number): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>('core_course_get_course_module', { cmid });
  }

  async getCourseModuleByInstance(module: string, instance: number): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>('core_course_get_course_module_by_instance', { module, instance });
  }

  async getAssignments(courseIds: number[]): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>('mod_assign_get_assignments', { courseids: courseIds });
  }

  async getAssignmentSubmissionStatus(assignId: number, userId?: number): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>('mod_assign_get_submission_status', {
      assignid: assignId,
      ...(userId ? { userid: userId } : {})
    });
  }

  async getForums(courseIds: number[]): Promise<unknown[]> {
    return this.call<unknown[]>('mod_forum_get_forums_by_courses', { courseids: courseIds });
  }

  async getForumDiscussions(forumId: number, page = 0, perPage = 20): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>('mod_forum_get_forum_discussions', {
      forumid: forumId,
      sortorder: -1,
      page,
      perpage: perPage
    });
  }

  async getDiscussionPosts(discussionId: number): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>('mod_forum_get_forum_discussion_posts', {
      discussionid: discussionId,
      sortby: 'created',
      sortdirection: 'ASC'
    });
  }

  async getGradeItems(courseId: number, userId?: number): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>('gradereport_user_get_grade_items', {
      courseid: courseId,
      ...(userId ? { userid: userId } : {})
    });
  }

  async getCompletionStatus(courseId: number, userId: number): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>('core_completion_get_activities_completion_status', {
      courseid: courseId,
      userid: userId
    });
  }
}

export { appendParams };
