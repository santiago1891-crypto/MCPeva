import * as cheerio from 'cheerio';
import type {
  EvaActivityDetail,
  EvaCategory,
  EvaCourse,
  EvaDiscussionSummary,
  EvaFile,
  EvaForum,
  EvaModule,
  EvaPost,
  EvaSection
} from '../domain/types.js';
import { absoluteUrl, cleanText, htmlToText, stripTokenFromUrl, uniqueBy } from '../domain/util.js';

type Doc = ReturnType<typeof cheerio.load>;
type Node = ReturnType<Doc>;

function text(node: Node): string {
  return cleanText(node.text());
}

function titleFromLink(node: Node): string {
  const clone = node.clone();
  clone.find('.accesshide, .sr-only, .visually-hidden').remove();
  return cleanText(clone.text());
}

function courseIdFromUrl(url: string | undefined): number | undefined {
  if (!url) return undefined;
  const match = /[?&]id=(\d+)/.exec(url);
  return match ? Number(match[1]) : undefined;
}

function cmidFromUrl(url: string | undefined): number | undefined {
  return courseIdFromUrl(url);
}

function isHidden(node: Node): boolean {
  const className = node.attr('class') ?? '';
  return /\b(hidden|dimmed|notavailable|invisible)\b/.test(className) || node.attr('data-visible') === '0';
}

function sectionNameFromTabs(doc: Doc, sectionNumber: number): string | undefined {
  const candidates = doc('.format_onetopic-tabs a[href*="section="], .nav-tabs a[href*="section="]').toArray();
  for (const element of candidates) {
    const node = doc(element);
    const href = node.attr('href') ?? '';
    const match = /[?&]section=(\d+)/.exec(href);
    if (!match || Number(match[1]) !== sectionNumber) continue;
    const label = text(node);
    if (label && !/^#?$/.test(label)) return label;
  }
  return undefined;
}

function parseModules(doc: Doc, sectionNode: Node, courseId: number, sectionId: number, sectionNumber: number, baseUrl: string): EvaModule[] {
  const activities = sectionNode.find('li.activity[data-id], li.activity[id^="module-"], .activity[data-id]').toArray();
  const seen = new Set<string>();
  const modules: EvaModule[] = [];

  for (const element of activities) {
    const node = doc(element);
    const classList = node.attr('class') ?? '';
    const idMatch = /module-(\d+)/.exec(node.attr('id') ?? '');
    const link = node.find('.activityname a.aalink, .activityname a, a.aalink[href*="/mod/"]').first();
    const href = link.attr('href') ?? node.find('a[href*="/mod/"]').first().attr('href');
    const cmid = Number(node.attr('data-id') ?? idMatch?.[1] ?? cmidFromUrl(href) ?? 0);
    if (!cmid || seen.has(String(cmid))) continue;
    seen.add(String(cmid));

    const modname = /modtype_([a-z0-9_]+)/.exec(classList)?.[1] ?? /\/mod\/([^/]+)\//.exec(href ?? '')?.[1] ?? 'unknown';
    const name =
      titleFromLink(node.find('.instancename').first()) ||
      titleFromLink(node.find('.activityname').first()) ||
      cleanText(
        node.attr('data-activityname') ??
          node.find('[data-activityname]').first().attr('data-activityname') ??
          ''
      ) ||
      `Actividad ${cmid}`;
    const descriptionNode = node.find('.activity-altcontent, .activity-description, .activity-information .no-overflow').first();
    const descriptionHtml = descriptionNode.length ? descriptionNode.html() ?? undefined : undefined;
    const description = descriptionHtml ? cleanText(htmlToText(descriptionHtml)) : undefined;
    const fileLinks = node.find('a[href*="pluginfile.php"]').toArray();
    const contents: EvaFile[] = fileLinks.map((fileElement) => {
      const fileNode = doc(fileElement);
      const fileUrl = absoluteUrl(fileNode.attr('href'), baseUrl) ?? '';
      return {
        filename: text(fileNode) || 'archivo',
        url: stripTokenFromUrl(fileUrl)
      };
    });
    const completionText = text(node.find('.completion-info, .completionstatus, [data-region="completion-info"]').first());

    modules.push({
      id: cmid,
      courseId,
      sectionId,
      sectionNumber,
      name,
      modname,
      modLabel: text(node.find('.accesshide').last()).replace(/^ /, '') || undefined,
      ...(href ? { url: absoluteUrl(href, baseUrl) } : {}),
      ...(description ? { description } : {}),
      ...(descriptionHtml ? { descriptionHtml } : {}),
      visible: !isHidden(node),
      userVisible: !isHidden(node),
      ...(completionText ? { completion: { enabled: true, description: completionText } } : {}),
      contents
    });
  }

  return modules;
}

function parseSections(doc: Doc, courseId: number, baseUrl: string): EvaSection[] {
  const sectionNodes = doc('li.section.course-section, .course-section').toArray();
  const sections: EvaSection[] = [];
  const seen = new Set<number>();

  sectionNodes.forEach((element, index) => {
    const node = doc(element);
    const number = Number(node.attr('data-number') ?? node.attr('data-section') ?? index);
    const id = Number(node.attr('data-id') ?? node.attr('data-sectionid') ?? number);
    if (seen.has(id)) return;
    seen.add(id);
    const header = node.find('.course-section-header, .section-header').first();
    const rawName =
      text(node.find('.sectionname').first()) ||
      text(node.find('.section-title, .section-title h2, .section-title h3').first()) ||
      text(header.find('h2, h3, h4').first()) ||
      sectionNameFromTabs(doc, number);
    const name = rawName || (number === 0 ? 'General' : `Sección ${number}`);
    const summaryNode = node.find('.summarytext, .section-summary, [data-for="sectioninfo"] .no-overflow').first();
    const summaryHtml = summaryNode.length ? summaryNode.html() ?? undefined : undefined;
    const summary = summaryHtml ? cleanText(htmlToText(summaryHtml)) : undefined;

    sections.push({
      id,
      courseId,
      number,
      name,
      ...(summary ? { summary } : {}),
      ...(summaryHtml ? { summaryHtml } : {}),
      visible: !isHidden(node),
      userVisible: !isHidden(node) && node.find('.availabilityinfo').length === 0,
      modules: parseModules(doc, node, courseId, id, number, baseUrl)
    });
  });

  if (!sections.length) {
    const activities = doc('.activity[data-id]').toArray();
    if (activities.length) {
      sections.push({
        id: 0,
        courseId,
        number: 0,
        name: 'General',
        visible: true,
        userVisible: true,
        modules: parseModules(doc, doc('body'), courseId, 0, 0, baseUrl)
      });
    }
  }

  return sections;
}

export interface ParsedCoursePage {
  course: EvaCourse;
  sections: EvaSection[];
  tabs: Array<{ number: number; name: string }>;
}

export function parseCoursePage(html: string, baseUrl: string, courseIdHint?: number): ParsedCoursePage {
  const doc = cheerio.load(html);
  const bodyClass = doc('body').attr('class') ?? '';
  const courseId = courseIdHint ?? Number(/course-(\d+)/.exec(bodyClass)?.[1]) ?? 0;
  const title =
    cleanText(doc('h1').first().text()) ||
    cleanText(doc('.page-header-headings h1').first().text()) ||
    cleanText(doc('title').first().text().split('|')[0] ?? '') ||
    `Curso ${courseId}`;
  const summaryNode = doc('#course-summary, .course-summary, .course-info-container .summarytext').first();
  const summaryHtml = summaryNode.length ? summaryNode.html() ?? undefined : undefined;
  const summary = summaryHtml ? cleanText(htmlToText(summaryHtml)) : undefined;
  const tabItems: Array<{ number: number; name: string }> = [];
  doc('.format_onetopic-tabs a[href*="section="], .nav-tabs a[href*="section="]').each((_index, element) => {
    const node = doc(element);
    const match = /[?&]section=(\d+)/.exec(node.attr('href') ?? '');
    const name = text(node);
    if (match && name) tabItems.push({ number: Number(match[1]), name });
  });
  // El formato onetopic también expone todas las secciones (incluidas las que no
  // tienen pestaña visible) en el desplegable "Ir a...".
  doc('select.jumpmenu option[value*="section="], select[name="jump"] option[value*="section="]').each(
    (_index, element) => {
      const node = doc(element);
      const match = /[?&]section=(\d+)/.exec(node.attr('value') ?? '');
      const name = text(node);
      if (match && name) tabItems.push({ number: Number(match[1]), name });
    }
  );
  const tabs = uniqueBy(
    tabItems,
    (item) => item.number
  ).sort((a, b) => a.number - b.number);
  const sections = parseSections(doc, courseId, baseUrl);
  const course: EvaCourse = {
    id: courseId,
    shortname: '',
    fullname: title,
    displayName: title,
    ...(summary ? { summary, summaryHtml } : {}),
    url: `${baseUrl}/course/view.php?id=${courseId}`,
    visible: true
  };
  return { course, sections, tabs };
}

export function parseCourseList(html: string, baseUrl: string, categoryName?: string): EvaCourse[] {
  const doc = cheerio.load(html);
  const courses: EvaCourse[] = [];

  doc('.coursebox[data-courseid], .course-listitem[data-courseid]').each((_index, element) => {
    const node = doc(element);
    const id = Number(node.attr('data-courseid'));
    if (!id) return;
    const link = node.find('.coursename a, a.coursename, a[href*="/course/view.php?id="]').first();
    const name = titleFromLink(link) || cleanText(node.find('.coursename').text());
    if (!name) return;
    const summaryText = text(node.find('.summary, .course-summary').first());
    const image = absoluteUrl(node.find('img.courseimage, img').first().attr('src'), baseUrl);
    courses.push({
      id,
      shortname: '',
      fullname: name,
      displayName: name,
      ...(categoryName ? { categoryName } : {}),
      ...(summaryText ? { summary: summaryText } : {}),
      url: `${baseUrl}/course/view.php?id=${id}`,
      ...(image ? { imageUrl: image } : {})
    });
  });

  if (!courses.length) {
    const main = doc('main, #region-main, .course-content').first();
    const links = (main.length ? main : doc('body')).find('a[href*="/course/view.php?id="]').toArray();
    for (const element of links) {
      const node = doc(element);
      const href = node.attr('href') ?? '';
      const id = courseIdFromUrl(href);
      if (!id) continue;
      const name = titleFromLink(node);
      if (!name || name.toLowerCase() === 'acceder') continue;
      courses.push({
        id,
        shortname: '',
        fullname: name,
        displayName: name,
        ...(categoryName ? { categoryName } : {}),
        url: `${baseUrl}/course/view.php?id=${id}`
      });
    }
  }

  return uniqueBy(courses, (course) => course.id);
}

export function parseCategoryPage(html: string, baseUrl: string, parentId?: number): { categories: EvaCategory[]; courses: EvaCourse[] } {
  const doc = cheerio.load(html);
  const categories: EvaCategory[] = [];
  doc('.category[data-categoryid]').each((_index, element) => {
    const node = doc(element);
    const id = Number(node.attr('data-categoryid'));
    const name = text(node.find('.categoryname a, .categoryname').first());
    if (!id || !name) return;
    categories.push({
      id,
      name,
      parentId,
      depth: Number(node.attr('data-depth') ?? 0) || undefined,
      courseCount: Number(node.attr('data-showcourses') ?? 0) || undefined,
      url: `${baseUrl}/course/index.php?categoryid=${id}`
    });
  });
  const heading = cleanText(doc('h1').first().text());
  return { categories: uniqueBy(categories, (category) => category.id), courses: parseCourseList(html, baseUrl, heading) };
}

export function parseSearchResults(html: string, baseUrl: string): { courses: EvaCourse[]; total: number } {
  const doc = cheerio.load(html);
  const courses = parseCourseList(html, baseUrl);
  const countMatch = /(\d+)\s+(?:resultado|curso)/i.exec(cleanText(doc('main').text()));
  return { courses, total: countMatch ? Number(countMatch[1]) : courses.length };
}

function extractFiles(doc: Doc, root: Node, baseUrl: string): EvaFile[] {
  const files: EvaFile[] = [];
  root.find('a[href*="pluginfile.php"]').each((_index, element) => {
    const node = doc(element);
    const url = absoluteUrl(node.attr('href'), baseUrl);
    if (!url) return;
    files.push({
      filename: text(node) || node.attr('download') || 'archivo',
      url: stripTokenFromUrl(url)
    });
  });
  return uniqueBy(files, (file) => file.url);
}

export function parseActivityPage(html: string, baseUrl: string, fallback?: { courseId: number; sectionId: number; sectionNumber: number; cmid: number; modname: string; name: string }): EvaActivityDetail {
  const doc = cheerio.load(html);
  const bodyClass = doc('body').attr('class') ?? '';
  const courseId = Number(/course-(\d+)/.exec(bodyClass)?.[1] ?? fallback?.courseId ?? 0);
  const modname = /path-mod-([a-z0-9_]+)/.exec(bodyClass)?.[1] ?? fallback?.modname ?? 'unknown';
  const title =
    cleanText(doc('h1').first().text()) ||
    cleanText(doc('.page-header-headings h1').first().text()) ||
    fallback?.name ||
    'Actividad';
  const introNode = doc('#intro, .activity-description, .box.generalbox, [data-region="activity-information"]').first();
  const descriptionHtml = introNode.length ? introNode.html() ?? undefined : undefined;
  const description = descriptionHtml ? cleanText(htmlToText(descriptionHtml)) : undefined;
  const main = doc('main, #region-main').first();
  const files = extractFiles(doc, main.length ? main : doc('body'), baseUrl);
  const links: Array<{ title: string; url: string }> = [];
  (main.length ? main : doc('body')).find('a[href]').each((_index, element) => {
    const node = doc(element);
    const href = absoluteUrl(node.attr('href'), baseUrl);
    const label = titleFromLink(node);
    if (!href || !label || label.length > 200) return;
    if (/\/(login|logout|course\/view|mod\/[^/]+\/view)\.php/i.test(href)) return;
    links.push({ title: label, url: href });
  });
  const metadata: Record<string, string> = {};
  (main.length ? main : doc('body')).find('table tr').each((_index, element) => {
    const row = doc(element);
    const label = cleanText(row.find('th').first().text());
    const value = cleanText(row.find('td').first().text());
    if (label && value) metadata[label] = value;
  });
  const module: EvaModule = {
    id: fallback?.cmid ?? cmidFromUrl(doc('a[href*="/mod/"]').first().attr('href')) ?? 0,
    courseId,
    sectionId: fallback?.sectionId ?? 0,
    sectionNumber: fallback?.sectionNumber ?? 0,
    name: fallback?.name ?? title,
    modname,
    ...(description ? { description } : {}),
    ...(descriptionHtml ? { descriptionHtml } : {}),
    visible: true,
    userVisible: true,
    contents: files
  };
  return {
    module,
    title,
    ...(description ? { description } : {}),
    ...(descriptionHtml ? { descriptionHtml } : {}),
    files,
    links: uniqueBy(links, (link) => link.url).slice(0, 50),
    metadata,
    source: 'web'
  };
}

export function parseForumPage(html: string, baseUrl: string, forumId: number): EvaDiscussionSummary[] {
  const doc = cheerio.load(html);
  const discussions: EvaDiscussionSummary[] = [];
  doc('tr.discussion, .discussion').each((_index, element) => {
    const node = doc(element);
    const link = node.find('a[href*="discuss.php?d="]').first();
    const href = link.attr('href');
    const match = /[?&]d=(\d+)/.exec(href ?? '');
    if (!match) return;
    const id = Number(match[1]);
    const name = titleFromLink(link);
    if (!name) return;
    discussions.push({
      id,
      forumId,
      name,
      author: text(node.find('.author, .username').first()) || undefined,
      replyCount: Number(text(node.find('.replies').first()) || NaN) || undefined,
      pinned: node.hasClass('pinned') || node.find('.pinned').length > 0,
      url: `${baseUrl}/mod/forum/discuss.php?d=${id}`
    });
  });
  if (!discussions.length) {
    doc('a[href*="discuss.php?d="]').each((_index, element) => {
      const node = doc(element);
      const id = Number(/[?&]d=(\d+)/.exec(node.attr('href') ?? '')?.[1]);
      const name = titleFromLink(node);
      if (id && name) discussions.push({ id, forumId, name, url: `${baseUrl}/mod/forum/discuss.php?d=${id}` });
    });
  }
  return uniqueBy(discussions, (discussion) => discussion.id);
}

export function parseDiscussionPage(html: string, baseUrl: string, discussionId: number): EvaPost[] {
  const doc = cheerio.load(html);
  const posts: EvaPost[] = [];
  doc('article.forumpost, .forumpost').each((_index, element) => {
    const node = doc(element);
    const id = Number(/(?:post-|p)(\d+)/.exec(node.attr('id') ?? '')?.[1] ?? node.attr('data-post-id') ?? 0);
    const subject = text(node.find('.subject, .post-subject, h3').first());
    const author = text(node.find('.author a, .author, .user a, .user').first());
    const dateText = cleanText(node.find('.postdate, time').first().text());
    const parsedDate = dateText ? new Date(dateText) : undefined;
    const messageNode = node.find('.post-content, .posting, .content').first();
    const messageHtml = messageNode.length ? messageNode.html() ?? undefined : undefined;
    posts.push({
      id,
      discussionId,
      subject: subject || `Publicación ${id}`,
      author: author || undefined,
      createdAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : undefined,
      ...(messageHtml ? { messageHtml, message: cleanText(htmlToText(messageHtml)) } : {}),
      attachments: extractFiles(doc, node, baseUrl)
    });
  });
  return uniqueBy(posts, (post) => post.id);
}

export function parseCourseForum(html: string, baseUrl: string, courseId: number): EvaForum[] {
  const doc = cheerio.load(html);
  const forums: EvaForum[] = [];
  doc('a[href*="/mod/forum/view.php?id="]').each((_index, element) => {
    const node = doc(element);
    const href = node.attr('href') ?? '';
    const cmid = cmidFromUrl(href);
    const name = titleFromLink(node);
    if (!cmid || !name) return;
    forums.push({ id: 0, courseId, cmid, name, url: `${baseUrl}/mod/forum/view.php?id=${cmid}` });
  });
  return uniqueBy(forums, (forum) => forum.cmid);
}

export function parseLoginRequired(html: string): boolean {
  const doc = cheerio.load(html);
  const bodyClass = doc('body').attr('class') ?? '';
  return bodyClass.includes('notloggedin') || doc('form#login, form.login-form').length > 0;
}
