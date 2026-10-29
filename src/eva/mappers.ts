import type {
  EvaAssignment,
  EvaCategory,
  EvaCourse,
  EvaDiscussionSummary,
  EvaFile,
  EvaForum,
  EvaGradeItem,
  EvaGradeReport,
  EvaModule,
  EvaPost,
  EvaSection
} from '../domain/types.js';
import {
  absoluteUrl,
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  cleanText,
  htmlToText,
  stripTokenFromUrl,
  unixToIso
} from '../domain/util.js';

function summaryFields(raw: Record<string, unknown>, baseUrl: string): { summary?: string; summaryHtml?: string } {
  const summary = asString(raw.summary) ?? asString(raw.intro);
  if (!summary) return {};
  const hasHtml = summary.includes('<') && summary.includes('>');
  return {
    summary: cleanText(hasHtml ? htmlToText(summary) : summary),
    ...(hasHtml ? { summaryHtml: absoluteHtmlUrls(summary, baseUrl) } : {})
  };
}

function absoluteHtmlUrls(html: string, baseUrl: string): string {
  return html.replace(/(href|src)=["'](\/(?!\/)[^"']*)["']/gi, (_match, attr: string, path: string) => {
    return `${attr}="${absoluteUrl(path, baseUrl) ?? path}"`;
  });
}

function mapContents(raw: Record<string, unknown>, baseUrl: string): EvaFile[] {
  return asArray<Record<string, unknown>>(raw.contents)
    .map((item) => {
      const fileUrl = asString(item.fileurl);
      if (!fileUrl) return undefined;
      const file: EvaFile = {
        filename: asString(item.filename) ?? 'archivo',
        filepath: asString(item.filepath),
        size: asNumber(item.filesize),
        mimeType: asString(item.mimetype),
        url: stripTokenFromUrl(absoluteUrl(fileUrl, baseUrl) ?? fileUrl),
        modifiedAt: unixToIso(item.timemodified),
        isExternal: asBoolean(item.isexternalfile)
      };
      return file;
    })
    .filter((item): item is EvaFile => Boolean(item));
}

function mapDates(raw: Record<string, unknown>): EvaModule['dates'] | undefined {
  const dates = asArray<Record<string, unknown>>(raw.dates);
  if (!dates.length) return undefined;
  const result: NonNullable<EvaModule['dates']> = {};
  for (const entry of dates) {
    const label = cleanText(asString(entry.label) ?? '').toLowerCase();
    const iso = unixToIso(entry.timestamp);
    if (!iso) continue;
    if (/(due|entrega|venc|cierre final)/i.test(label)) result.due ??= iso;
    else if (/(from|apertura|desde|inicio|abre)/i.test(label)) result.opened ??= iso;
    else if (/(to|cierre|hasta|cutoff|termina)/i.test(label)) result.closed ??= iso;
  }
  return Object.keys(result).length ? result : undefined;
}

function mapCompletion(raw: Record<string, unknown>): EvaModule['completion'] | undefined {
  const enabled = asNumber(raw.completion);
  const data = asRecord(raw.completiondata);
  if (enabled === undefined || enabled === 0) return undefined;
  const state = asNumber(data.state);
  return {
    enabled: true,
    ...(state !== undefined ? { complete: state === 1 || state === 2, passed: state === 2 } : {}),
    ...(asString(data.description) ? { description: asString(data.description) } : {})
  };
}

export function mapCourse(rawValue: unknown, baseUrl: string): EvaCourse {
  const raw = asRecord(rawValue);
  const id = asNumber(raw.id) ?? 0;
  const fullname = cleanText(asString(raw.fullname) ?? asString(raw.displayname) ?? `Curso ${id}`);
  const displayName = cleanText(asString(raw.displayname) ?? fullname);
  const summary = summaryFields(raw, baseUrl);
  const overviewFiles = asArray<Record<string, unknown>>(raw.overviewfiles);
  const image = overviewFiles.find((file) => asString(file.mimetype)?.startsWith('image/'));
  const imageUrl = asString(image?.fileurl) ?? asString(raw.courseimage);
  return {
    id,
    shortname: cleanText(asString(raw.shortname) ?? ''),
    fullname,
    displayName,
    categoryId: asNumber(raw.categoryid) ?? asNumber(raw.category),
    categoryName: asString(raw.categoryname),
    ...summary,
    format: asString(raw.format),
    visible: asBoolean(raw.visible),
    startDate: unixToIso(raw.startdate),
    endDate: unixToIso(raw.enddate),
    url: `${baseUrl}/course/view.php?id=${id}`,
    ...(imageUrl ? { imageUrl: stripTokenFromUrl(absoluteUrl(imageUrl, baseUrl) ?? imageUrl) } : {}),
    progress: asNumber(raw.progress),
    enrolledCount: asNumber(raw.enrolledusercount)
  };
}

export function mapModule(rawValue: unknown, courseId: number, sectionId: number, sectionNumber: number, baseUrl: string): EvaModule {
  const raw = asRecord(rawValue);
  const id = asNumber(raw.id) ?? 0;
  const modname = asString(raw.modname) ?? 'unknown';
  const name = cleanText(asString(raw.name) ?? asString(raw.customdata ? asRecord(raw.customdata).name : undefined) ?? `Actividad ${id}`);
  const descriptionHtml = asString(raw.description);
  const description = descriptionHtml ? cleanText(htmlToText(descriptionHtml)) : undefined;
  const url = asString(raw.url);
  return {
    id,
    courseId,
    sectionId: asNumber(raw.sectionid) ?? sectionId,
    sectionNumber: asNumber(raw.sectionnumber) ?? sectionNumber,
    instanceId: asNumber(raw.instance),
    name,
    modname,
    modLabel: asString(raw.modplural),
    ...(url ? { url: absoluteUrl(url, baseUrl) ?? url } : {}),
    ...(description ? { description } : {}),
    ...(descriptionHtml ? { descriptionHtml: absoluteHtmlUrls(descriptionHtml, baseUrl) } : {}),
    visible: asBoolean(raw.visible) ?? true,
    userVisible: asBoolean(raw.uservisible) ?? true,
    indent: asNumber(raw.indent),
    ...(mapCompletion(raw) ? { completion: mapCompletion(raw) } : {}),
    ...(mapDates(raw) ? { dates: mapDates(raw) } : {}),
    contents: mapContents(raw, baseUrl)
  };
}

export function mapCourseContents(rawSections: unknown, course: EvaCourse, baseUrl: string): EvaSection[] {
  return asArray<Record<string, unknown>>(rawSections).map((raw, index) => {
    const id = asNumber(raw.id) ?? index;
    const number = asNumber(raw.section) ?? index;
    const rawName = cleanText(asString(raw.name) ?? '');
    const name = rawName || (number === 0 ? 'General' : `Sección ${number}`);
    const summary = summaryFields(raw, baseUrl);
    return {
      id,
      courseId: course.id,
      number,
      name,
      ...summary,
      visible: asBoolean(raw.visible) ?? true,
      userVisible: asBoolean(raw.uservisible) ?? true,
      modules: asArray<Record<string, unknown>>(raw.modules).map((module) => mapModule(module, course.id, id, number, baseUrl))
    };
  });
}

export function mapCategory(rawValue: unknown, baseUrl: string): EvaCategory {
  const raw = asRecord(rawValue);
  const id = asNumber(raw.id) ?? 0;
  return {
    id,
    name: cleanText(asString(raw.name) ?? `Categoría ${id}`),
    parentId: asNumber(raw.parent),
    depth: asNumber(raw.depth),
    courseCount: asNumber(raw.coursecount),
    url: `${baseUrl}/course/index.php?categoryid=${id}`
  };
}

export function mapAssignment(rawValue: unknown, courseId: number, baseUrl: string): EvaAssignment {
  const raw = asRecord(rawValue);
  const id = asNumber(raw.id) ?? 0;
  const cmid = asNumber(raw.cmid) ?? 0;
  const introHtml = asString(raw.intro);
  return {
    id,
    courseId: asNumber(raw.course) ?? courseId,
    cmid,
    name: cleanText(asString(raw.name) ?? `Tarea ${id}`),
    ...(introHtml ? { intro: cleanText(htmlToText(introHtml)), introHtml: absoluteHtmlUrls(introHtml, baseUrl) } : {}),
    dueDate: unixToIso(raw.duedate),
    allowFromDate: unixToIso(raw.allowsubmissionsfromdate),
    cutoffDate: unixToIso(raw.cutoffdate),
    grade: asNumber(raw.grade),
    url: `${baseUrl}/mod/assign/view.php?id=${cmid}`
  };
}

export function mapSubmissionStatus(rawValue: unknown): EvaAssignment['submission'] {
  const raw = asRecord(rawValue);
  const lastAttempt = asRecord(raw.lastattempt);
  const submission = asRecord(lastAttempt.submission);
  const grade = asRecord(lastAttempt.grade);
  const feedback = asRecord(raw.feedback);
  const gradeValue = asString(grade.gradefordisplay) ?? asString(grade.grade);
  const feedbackText = asString(feedback.feedback);
  if (!Object.keys(submission).length && !Object.keys(grade).length) return undefined;
  return {
    status: asString(submission.status),
    submittedAt: unixToIso(submission.timemodified) ?? unixToIso(submission.timecreated),
    gradedAt: unixToIso(grade.gradedategraded),
    grade: gradeValue ?? (feedbackText ? cleanText(htmlToText(feedbackText)) : undefined)
  };
}

export function mapForum(rawValue: unknown, courseId: number, baseUrl: string): EvaForum {
  const raw = asRecord(rawValue);
  const id = asNumber(raw.id) ?? 0;
  const cmid = asNumber(raw.cmid) ?? 0;
  const introHtml = asString(raw.intro);
  return {
    id,
    courseId: asNumber(raw.course) ?? courseId,
    cmid,
    name: cleanText(asString(raw.name) ?? `Foro ${id}`),
    ...(introHtml ? { intro: cleanText(htmlToText(introHtml)) } : {}),
    type: asString(raw.type),
    url: `${baseUrl}/mod/forum/view.php?id=${cmid}`
  };
}

export function mapDiscussion(rawValue: unknown, forumId: number, baseUrl: string): EvaDiscussionSummary {
  const raw = asRecord(rawValue);
  const id = asNumber(raw.discussion) ?? asNumber(raw.id) ?? 0;
  return {
    id,
    forumId: asNumber(raw.forum) ?? forumId,
    name: cleanText(asString(raw.name) ?? asString(raw.subject) ?? `Discusión ${id}`),
    author: asString(raw.userfullname),
    createdAt: unixToIso(raw.created) ?? unixToIso(raw.timemodified),
    modifiedAt: unixToIso(raw.timemodified),
    replyCount: asNumber(raw.numreplies),
    unread: asNumber(raw.unread),
    pinned: asBoolean(raw.pinned),
    url: `${baseUrl}/mod/forum/discuss.php?d=${id}`
  };
}

export function mapPost(rawValue: unknown, baseUrl: string): EvaPost {
  const raw = asRecord(rawValue);
  const id = asNumber(raw.id) ?? 0;
  const messageHtml = asString(raw.message);
  const attachments = asArray<Record<string, unknown>>(raw.attachments)
    .map((item) => {
      const url = asString(item.fileurl);
      if (!url) return undefined;
      const file: EvaFile = {
        filename: asString(item.filename) ?? 'archivo',
        size: asNumber(item.filesize),
        mimeType: asString(item.mimetype),
        url: stripTokenFromUrl(absoluteUrl(url, baseUrl) ?? url)
      };
      return file;
    })
    .filter((item): item is EvaFile => Boolean(item));
  return {
    id,
    discussionId: asNumber(raw.discussionid) ?? 0,
    parentId: asNumber(raw.parentid),
    subject: cleanText(asString(raw.subject) ?? ''),
    author: asString(raw.userfullname),
    createdAt: unixToIso(raw.created),
    modifiedAt: unixToIso(raw.modified),
    ...(messageHtml ? { messageHtml: absoluteHtmlUrls(messageHtml, baseUrl), message: cleanText(htmlToText(messageHtml)) } : {}),
    attachments,
    isDeleted: asBoolean(raw.deleted)
  };
}

export function mapGradeReport(rawValue: unknown, courseId: number): EvaGradeReport {
  const raw = asRecord(rawValue);
  const userGrades = asArray<Record<string, unknown>>(raw.usergrades);
  const first = userGrades[0] ?? {};
  const items = asArray<Record<string, unknown>>(first.gradeitems).map((item): EvaGradeItem => {
    const gradeRaw = asNumber(item.graderaw);
    const maxGrade = asNumber(item.grademax);
    const percentage = asNumber(item.percentage);
    return {
      id: asNumber(item.id),
      itemName: cleanText(asString(item.itemname) ?? 'Ítem'),
      itemType: asString(item.itemtype),
      itemModule: asString(item.itemmodule),
      gradeFormatted: asString(item.gradeformatted),
      gradeRaw,
      maxGrade,
      percentage,
      feedback: asString(item.feedback) ? cleanText(htmlToText(asString(item.feedback))) : undefined,
      dateSubmitted: unixToIso(item.gradedatesubmitted),
      dateGraded: unixToIso(item.gradedategraded)
    };
  });
  return {
    courseId,
    userId: asNumber(first.userid),
    items,
    source: 'webservice'
  };
}
