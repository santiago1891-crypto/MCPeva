export type AuthMode = 'webservice' | 'web' | 'none';

export interface EvaUser {
  id?: number;
  username?: string;
  fullname?: string;
  email?: string;
  roles?: string[];
}

export interface EvaSite {
  name: string;
  url: string;
  release?: string;
  version?: string;
  auth: AuthMode;
  user?: EvaUser;
  features: {
    webservice: boolean;
    webSession: boolean;
    canDownloadFiles: boolean;
  };
}

export interface EvaCourse {
  id: number;
  shortname: string;
  fullname: string;
  displayName: string;
  categoryId?: number;
  categoryName?: string;
  summary?: string;
  summaryHtml?: string;
  format?: string;
  visible?: boolean;
  startDate?: string;
  endDate?: string;
  url: string;
  imageUrl?: string;
  progress?: number;
  enrolledCount?: number;
}

export interface EvaFile {
  filename: string;
  filepath?: string;
  size?: number;
  mimeType?: string;
  url: string;
  modifiedAt?: string;
  isExternal?: boolean;
}

export interface EvaModule {
  id: number;
  courseId: number;
  sectionId: number;
  sectionNumber: number;
  instanceId?: number;
  name: string;
  modname: string;
  modLabel?: string;
  url?: string;
  description?: string;
  descriptionHtml?: string;
  visible: boolean;
  userVisible: boolean;
  indent?: number;
  completion?: {
    enabled: boolean;
    complete?: boolean;
    passed?: boolean;
    description?: string;
  };
  dates?: {
    opened?: string;
    due?: string;
    closed?: string;
  };
  contents: EvaFile[];
}

export interface EvaSection {
  id: number;
  courseId: number;
  number: number;
  name: string;
  summary?: string;
  summaryHtml?: string;
  visible: boolean;
  userVisible: boolean;
  modules: EvaModule[];
}

export interface EvaCourseContents {
  course: EvaCourse;
  sections: EvaSection[];
  source: AuthMode;
  fetchedAt: string;
}

export interface EvaCategory {
  id: number;
  name: string;
  parentId?: number;
  depth?: number;
  courseCount?: number;
  url: string;
  children?: EvaCategory[];
}

export interface EvaCourseSearchResult {
  query?: string;
  total: number;
  courses: EvaCourse[];
  source: AuthMode;
}

export interface EvaAssignment {
  id: number;
  courseId: number;
  cmid: number;
  name: string;
  intro?: string;
  introHtml?: string;
  dueDate?: string;
  allowFromDate?: string;
  cutoffDate?: string;
  grade?: number;
  url: string;
  submission?: {
    status?: string;
    submittedAt?: string;
    gradedAt?: string;
    grade?: string;
    canSubmit?: boolean;
  };
}

export interface EvaForum {
  id: number;
  courseId: number;
  cmid: number;
  name: string;
  intro?: string;
  type?: string;
  url: string;
  discussionCount?: number;
}

export interface EvaDiscussionSummary {
  id: number;
  forumId: number;
  name: string;
  author?: string;
  createdAt?: string;
  modifiedAt?: string;
  replyCount?: number;
  unread?: number;
  pinned?: boolean;
  url: string;
}

export interface EvaPost {
  id: number;
  discussionId: number;
  parentId?: number;
  subject: string;
  author?: string;
  createdAt?: string;
  modifiedAt?: string;
  messageHtml?: string;
  message?: string;
  attachments: EvaFile[];
  isDeleted?: boolean;
}

export interface EvaGradeItem {
  id?: number;
  itemName: string;
  itemType?: string;
  itemModule?: string;
  gradeFormatted?: string;
  gradeRaw?: number;
  maxGrade?: number;
  percentage?: number;
  feedback?: string;
  dateSubmitted?: string;
  dateGraded?: string;
}

export interface EvaGradeReport {
  courseId: number;
  userId?: number;
  items: EvaGradeItem[];
  source: AuthMode;
}

export interface EvaActivityDetail {
  module: EvaModule;
  title: string;
  description?: string;
  descriptionHtml?: string;
  files: EvaFile[];
  links: Array<{ title: string; url: string }>;
  metadata: Record<string, string>;
  assignment?: EvaAssignment;
  forum?: EvaForum;
  discussions?: EvaDiscussionSummary[];
  source: AuthMode;
}

export interface DownloadedFile {
  filename: string;
  path: string;
  size: number;
  mimeType?: string;
  sourceUrl: string;
}

export interface EvaFileSearchHit {
  filename: string;
  filepath?: string;
  size?: number;
  mimeType?: string;
  url: string;
  modifiedAt?: string;
  courseId: number;
  courseName: string;
  sectionId?: number;
  sectionName?: string;
  sectionNumber?: number;
  moduleId?: number;
  moduleName?: string;
  modname?: string;
}

export interface ContentSearchHit {
  courseId: number;
  courseName: string;
  sectionId?: number;
  sectionName?: string;
  moduleId?: number;
  moduleName?: string;
  modname?: string;
  kind: 'course' | 'section' | 'module' | 'file';
  snippet: string;
  url?: string;
}
