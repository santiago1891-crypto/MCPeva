import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type {
  ContentSearchHit,
  EvaActivityDetail,
  EvaCourse,
  EvaCourseContents,
  EvaFile,
  EvaFileSearchHit,
  EvaModule
} from '../domain/types.js';
import type { EvaService } from '../services/eva-service.js';
import { useTerminalSize } from './hooks.js';
import { clamp, fitText, formatBytes, listWindow, wrapText } from './list.js';
import { flattenOutline, moduleTag } from './outline.js';
import { openFile } from './open-file.js';

type View =
  | { kind: 'courses' }
  | { kind: 'outline'; courseId: number; courseName: string }
  | { kind: 'activity'; cmid: number; courseId?: number; modname?: string; name?: string }
  | { kind: 'search' };

interface ScreenProps {
  listSize: number;
  width: number;
  setToast: (message: string) => void;
  onBack: () => void;
  onQuit: () => void;
  onSearch: () => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function breadcrumb(view: View): string {
  if (view.kind === 'outline') return view.courseName;
  if (view.kind === 'activity') return view.name ?? 'Actividad';
  if (view.kind === 'search') return 'Buscar';
  return 'Mis cursos';
}

interface HelpKey {
  keys: string;
  usage: string;
}

/** Teclas y su uso para la pantalla actual (se dibujan en la barra inferior). */
function helpKeys(view: View): HelpKey[] {
  switch (view.kind) {
    case 'courses':
      return [
        { keys: '↑↓ jk', usage: 'moverse' },
        { keys: 'Enter', usage: 'abrir curso' },
        { keys: '/', usage: 'buscar' }
      ];
    case 'outline':
      return [
        { keys: '↑↓ jk', usage: 'moverse' },
        { keys: 'Enter', usage: 'abrir actividad' },
        { keys: '/', usage: 'buscar' },
        { keys: 'Esc h', usage: 'volver' }
      ];
    case 'activity':
      return [
        { keys: '↑↓ jk', usage: 'moverse entre archivos' },
        { keys: 'd', usage: 'descargar' },
        { keys: 'o', usage: 'abrir archivo' },
        { keys: '/', usage: 'buscar' },
        { keys: 'Esc h', usage: 'volver' }
      ];
    case 'search':
      return [
        { keys: 'Enter', usage: 'buscar' },
        { keys: '↑↓', usage: 'moverse' },
        { keys: 'Enter', usage: 'abrir o descargar' },
        { keys: 'Esc', usage: 'volver' }
      ];
    default:
      return [];
  }
}

const FOOTER_BG = '#282c34';
const FOOTER_KEY = '#61afef';
const FOOTER_TEXT = '#d7dae0';

function Footer({ view }: { view: View }) {
  const keys = helpKeys(view);
  const quit: HelpKey = view.kind === 'search' ? { keys: 'Ctrl+C', usage: 'salir' } : { keys: 'q', usage: 'salir' };
  return (
    <Box backgroundColor={FOOTER_BG} paddingX={1} justifyContent="space-between" width="100%">
      <Box>
        {keys.map((item, index) => (
          <Text key={`${item.keys}-${item.usage}`}>
            {index > 0 && (
              <Text color={FOOTER_TEXT} dimColor>
                {' · '}
              </Text>
            )}
            <Text color={FOOTER_KEY} bold>
              {item.keys}
            </Text>
            <Text color={FOOTER_TEXT}>{` ${item.usage}`}</Text>
          </Text>
        ))}
      </Box>
      <Text>
        <Text color={FOOTER_KEY} bold>
          {quit.keys}
        </Text>
        <Text color={FOOTER_TEXT}>{` ${quit.usage}`}</Text>
      </Text>
    </Box>
  );
}

export interface AppProps {
  service: EvaService;
  userLabel: string;
}

export function App({ service, userLabel }: AppProps) {
  const { exit } = useApp();
  const { rows, columns } = useTerminalSize();
  const listSize = Math.max(5, rows - 8);
  const width = Math.max(30, columns - 2);
  const [stack, setStack] = useState<View[]>([{ kind: 'courses' }]);
  const [toast, setToast] = useState<string | undefined>(undefined);
  const view = stack[stack.length - 1]!;

  const go = (next: View): void => {
    setToast(undefined);
    setStack((current) => [...current, next]);
  };
  const back = (): void => {
    setToast(undefined);
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  };

  const screen: ScreenProps = {
    listSize,
    width,
    setToast,
    onBack: back,
    onQuit: exit,
    onSearch: () => go({ kind: 'search' })
  };

  return (
    <Box flexDirection="column" height={rows}>
      <Box paddingX={1} justifyContent="space-between">
        <Text color="cyan" bold>
          {`EVA › ${breadcrumb(view)}`}
        </Text>
        <Text color="gray">{fitText(userLabel, Math.max(10, width - 10))}</Text>
      </Box>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} flexGrow={1}>
        {view.kind === 'courses' && (
          <CoursesScreen
            {...screen}
            service={service}
            onOpen={(course) => go({ kind: 'outline', courseId: course.id, courseName: course.fullname })}
          />
        )}
        {view.kind === 'outline' && (
          <OutlineScreen
            {...screen}
            key={`outline-${view.courseId}`}
            service={service}
            courseId={view.courseId}
            onOpen={(module) =>
              go({
                kind: 'activity',
                cmid: module.id,
                courseId: module.courseId || view.courseId,
                modname: module.modname,
                name: module.name
              })
            }
          />
        )}
        {view.kind === 'activity' && (
          <ActivityScreen {...screen} key={`activity-${view.cmid}`} service={service} target={view} />
        )}
        {view.kind === 'search' && (
          <SearchScreen
            {...screen}
            service={service}
            onOpenActivity={(hit) =>
              go({
                kind: 'activity',
                cmid: hit.moduleId ?? 0,
                courseId: hit.courseId,
                modname: hit.modname,
                name: hit.moduleName
              })
            }
            onOpenCourse={(hit) => go({ kind: 'outline', courseId: hit.courseId, courseName: hit.courseName })}
          />
        )}
      </Box>
      <Box minHeight={1} paddingX={1}>
        <Text color={toast?.startsWith('Error') ? 'red' : 'green'}>{fitText(toast ?? '', width)}</Text>
      </Box>
      <Footer view={view} />
    </Box>
  );
}

interface CoursesScreenProps extends ScreenProps {
  service: EvaService;
  onOpen: (course: EvaCourse) => void;
}

function CoursesScreen({ service, listSize, width, onOpen, onSearch, onQuit }: CoursesScreenProps) {
  const [courses, setCourses] = useState<EvaCourse[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    let active = true;
    service
      .getMyCourses()
      .then((items) => {
        if (active) setCourses(items);
      })
      .catch((err) => {
        if (active) setError(messageOf(err));
      });
    return () => {
      active = false;
    };
  }, [service]);

  useInput((input, key) => {
    const items = courses ?? [];
    if (key.upArrow || input === 'k') {
      setCursor((value) => Math.max(0, value - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor((value) => Math.min(items.length - 1, value + 1));
      return;
    }
    if (key.return) {
      const course = items[cursor];
      if (course) onOpen(course);
      return;
    }
    if (input === '/') {
      onSearch();
      return;
    }
    if (input === 'q' || (key.ctrl && input === 'c')) {
      onQuit();
    }
  });

  if (error) return <Text color="red">{fitText(error, width)}</Text>;
  if (!courses) return <Text color="yellow">Cargando cursos…</Text>;
  if (!courses.length) return <Text>No tenés cursos inscriptos.</Text>;

  const window = listWindow(courses.length, cursor, listSize);
  return (
    <Box flexDirection="column">
      <Text color="gray" dimColor>
        {`${courses.length} curso(s)`}
      </Text>
      {courses.slice(window.start, window.end).map((course, offset) => {
        const index = window.start + offset;
        const selected = index === cursor;
        return (
          <Text key={course.id} color={selected ? 'cyan' : undefined} bold={selected}>
            {fitText(`${selected ? '> ' : '  '}${course.displayName || course.fullname}`, width - 4)}
          </Text>
        );
      })}
    </Box>
  );
}

interface OutlineScreenProps extends ScreenProps {
  service: EvaService;
  courseId: number;
  onOpen: (module: EvaModule) => void;
}

function OutlineScreen({ service, courseId, listSize, width, onOpen, onBack, onQuit, onSearch }: OutlineScreenProps) {
  const [contents, setContents] = useState<EvaCourseContents>();
  const [error, setError] = useState<string | undefined>(undefined);
  const [position, setPosition] = useState(0);

  useEffect(() => {
    let active = true;
    service
      .getCourseContents(courseId)
      .then((value) => {
        if (active) setContents(value);
      })
      .catch((err) => {
        if (active) setError(messageOf(err));
      });
    return () => {
      active = false;
    };
  }, [service, courseId]);

  const entries = useMemo(() => (contents ? flattenOutline(contents) : []), [contents]);
  const selectable = useMemo(
    () => entries.flatMap((entry, index) => (entry.type === 'module' ? [index] : [])),
    [entries]
  );
  const cursor = clamp(position, selectable.length);
  const entryIndex = selectable[cursor] ?? 0;

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (!contents) return;
    if (key.upArrow || input === 'k') {
      setPosition(Math.max(0, cursor - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setPosition(Math.min(selectable.length - 1, cursor + 1));
      return;
    }
    if (key.return) {
      const entry = entries[entryIndex];
      if (entry?.type === 'module') onOpen(entry.module);
      return;
    }
    if (input === '/' || input === 'f') {
      onSearch();
      return;
    }
    if (input === 'h') {
      onBack();
      return;
    }
    if (input === 'q') {
      onQuit();
    }
  });

  if (error) return <Text color="red">{fitText(error, width)}</Text>;
  if (!contents) return <Text color="yellow">Cargando curso…</Text>;

  const window = listWindow(entries.length, entryIndex, listSize);
  return (
    <Box flexDirection="column">
      <Text color="gray" dimColor>
        {`${contents.sections.length} sección(es) · ${selectable.length} actividad(es) · fuente ${contents.source}`}
      </Text>
      {entries.slice(window.start, window.end).map((entry, offset) => {
        const index = window.start + offset;
        if (entry.type === 'section') {
          return (
            <Text key={`section-${entry.section.id}-${index}`} color="magenta" bold>
              {fitText(`[${entry.section.number}] ${entry.section.name}`, width - 4)}
            </Text>
          );
        }
        const selected = index === entryIndex;
        const hidden = entry.module.userVisible ? '' : ' (oculta)';
        return (
          <Text key={`module-${entry.module.id}`} color={selected ? 'cyan' : undefined} bold={selected}>
            {fitText(
              `${selected ? '> ' : '  '}${moduleTag(entry.module.modname)} ${entry.module.name}${hidden}`,
              width - 4
            )}
          </Text>
        );
      })}
    </Box>
  );
}

interface ActivityTarget {
  cmid: number;
  courseId?: number;
  modname?: string;
  name?: string;
}

interface ActivityScreenProps extends ScreenProps {
  service: EvaService;
  target: ActivityTarget;
}

function ActivityScreen({ service, target, listSize, width, setToast, onBack, onQuit, onSearch }: ActivityScreenProps) {
  const [detail, setDetail] = useState<EvaActivityDetail>();
  const [error, setError] = useState<string | undefined>(undefined);
  const [cursor, setCursor] = useState(0);
  const [lastDownload, setLastDownload] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    service
      .getActivity(target.cmid, target.courseId, target.modname, target.name)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((err) => {
        if (active) setError(messageOf(err));
      });
    return () => {
      active = false;
    };
  }, [service, target.cmid]);

  const files = detail?.files ?? [];
  const index = clamp(cursor, files.length);

  const download = async (file: EvaFile, open: boolean): Promise<void> => {
    setToast(`Descargando ${file.filename}…`);
    try {
      const result = await service.downloadFile(file.url, file.filename);
      setLastDownload(result.path);
      setToast(open ? `Abriendo ${result.filename} (${result.path})` : `Descargado: ${result.path}`);
      if (open) openFile(result.path);
    } catch (err) {
      setToast(`Error: ${messageOf(err)}`);
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (!detail) {
      if (input === 'q') onQuit();
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor(Math.max(0, index - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor(Math.min(files.length - 1, index + 1));
      return;
    }
    const file = files[index];
    if (input === 'd' && file) {
      void download(file, false);
      return;
    }
    if (input === 'o') {
      if (file) {
        void download(file, true);
      } else if (lastDownload) {
        setToast(`Abriendo ${lastDownload}`);
        openFile(lastDownload);
      }
      return;
    }
    if (input === '/' || input === 'f') {
      onSearch();
      return;
    }
    if (input === 'h') {
      onBack();
      return;
    }
    if (input === 'q') {
      onQuit();
    }
  });

  if (error) return <Text color="red">{fitText(error, width)}</Text>;
  if (!detail) return <Text color="yellow">Cargando actividad…</Text>;

  const descriptionLines = detail.description ? wrapText(detail.description, width - 4, 4) : [];
  const window = listWindow(files.length, index, listSize);
  const metadata = Object.entries(detail.metadata).slice(0, 4);

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        {fitText(detail.title, width - 4)}
      </Text>
      <Text color="gray" dimColor>
        {`${moduleTag(detail.module.modname)} · cmid ${detail.module.id} · fuente ${detail.source}`}
      </Text>
      {descriptionLines.map((text, lineIndex) => (
        <Text key={`desc-${lineIndex}`}>{fitText(text, width - 4)}</Text>
      ))}
      {detail.module.dates?.due && <Text color="yellow">{fitText(`Entrega: ${detail.module.dates.due}`, width - 4)}</Text>}
      {detail.assignment?.dueDate && (
        <Text color="yellow">{fitText(`Entrega: ${detail.assignment.dueDate}`, width - 4)}</Text>
      )}
      {metadata.map(([key, value]) => (
        <Text key={key} color="gray">
          {fitText(`${key}: ${value}`, width - 4)}
        </Text>
      ))}
      <Text color="gray" dimColor>
        {`${files.length} archivo(s)${files.length ? ' · d descargar · o abrir' : ''}`}
      </Text>
      {files.slice(window.start, window.end).map((file, offset) => {
        const fileIndex = window.start + offset;
        const selected = fileIndex === index;
        const details = [formatBytes(file.size), file.mimeType].filter(Boolean).join(' · ');
        return (
          <Text key={`${file.url}-${fileIndex}`} color={selected ? 'cyan' : undefined} bold={selected}>
            {fitText(`${selected ? '> ' : '  '}${file.filename}${details ? ` (${details})` : ''}`, width - 4)}
          </Text>
        );
      })}
    </Box>
  );
}

type SearchEntry =
  | { kind: 'module'; hit: ContentSearchHit }
  | { kind: 'section'; hit: ContentSearchHit }
  | { kind: 'file'; hit: EvaFileSearchHit };

interface SearchScreenProps extends ScreenProps {
  service: EvaService;
  onOpenActivity: (hit: ContentSearchHit) => void;
  onOpenCourse: (hit: ContentSearchHit) => void;
}

function SearchScreen({
  service,
  listSize,
  width,
  setToast,
  onBack,
  onQuit,
  onOpenActivity,
  onOpenCourse
}: SearchScreenProps) {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [entries, setEntries] = useState<SearchEntry[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [cursor, setCursor] = useState(0);

  const index = clamp(cursor, entries.length);

  const run = async (): Promise<void> => {
    const needle = query.trim();
    if (!needle) return;
    setPhase('loading');
    setError(undefined);
    setEntries([]);
    setCursor(0);
    try {
      const [contentHits, fileHits] = await Promise.all([
        service.searchContent(needle).catch(() => [] as ContentSearchHit[]),
        service.searchFiles(needle).catch(() => [] as EvaFileSearchHit[])
      ]);
      const mapped: SearchEntry[] = [
        ...contentHits
          .filter((hit) => hit.kind === 'module' || hit.kind === 'section')
          .map((hit): SearchEntry => ({ kind: hit.kind as 'module' | 'section', hit })),
        ...fileHits.map((hit): SearchEntry => ({ kind: 'file', hit }))
      ];
      setEntries(mapped);
      setPhase('done');
    } catch (err) {
      setError(messageOf(err));
      setPhase('error');
    }
  };

  const downloadHit = async (hit: EvaFileSearchHit): Promise<void> => {
    setToast(`Descargando ${hit.filename}…`);
    try {
      const result = await service.downloadFile(hit.url, hit.filename);
      setToast(`Descargado: ${result.path}`);
    } catch (err) {
      setToast(`Error: ${messageOf(err)}`);
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.ctrl && input === 'c') {
      onQuit();
      return;
    }
    if (phase === 'loading') return;
    if (key.upArrow) {
      setCursor(Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      setCursor(Math.min(entries.length - 1, index + 1));
      return;
    }
    if (key.return) {
      const entry = entries[index];
      if (!entry) {
        void run();
        return;
      }
      if (entry.kind === 'module') {
        onOpenActivity(entry.hit);
        return;
      }
      if (entry.kind === 'section') {
        onOpenCourse(entry.hit);
        return;
      }
      void downloadHit(entry.hit);
      return;
    }
    if (key.backspace || input === '\x7f' || input === '\b') {
      setQuery((value) => value.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta && input >= ' ') {
      setQuery((value) => value + input);
    }
  });

  const window = listWindow(entries.length, index, listSize);
  return (
    <Box flexDirection="column">
      <Text color="gray" dimColor>
        Buscar en tus cursos. Escribí y presioná Enter.
      </Text>
      <Text color="cyan">{fitText(`> ${query}`, width - 4)}</Text>
      {phase === 'loading' && <Text color="yellow">Buscando…</Text>}
      {phase === 'error' && <Text color="red">{fitText(error ?? 'Error al buscar', width - 4)}</Text>}
      {phase === 'done' && entries.length === 0 && (
        <Text color="gray">{fitText(`Sin resultados para "${query}".`, width - 4)}</Text>
      )}
      {entries.slice(window.start, window.end).map((entry, offset) => {
        const entryIndex = window.start + offset;
        const selected = entryIndex === index;
        const label =
          entry.kind === 'file'
            ? `[archivo] ${entry.hit.filename} · ${entry.hit.courseName}`
            : `[${entry.kind === 'module' ? 'contenido' : 'sección'}] ${entry.hit.courseName}${
                entry.hit.sectionName ? ` › ${entry.hit.sectionName}` : ''
              }${entry.hit.moduleName ? ` › ${entry.hit.moduleName}` : ''}`;
        return (
          <Text key={`${entryIndex}`} color={selected ? 'cyan' : undefined} bold={selected}>
            {fitText(`${selected ? '> ' : '  '}${label}`, width - 4)}
          </Text>
        );
      })}
    </Box>
  );
}
