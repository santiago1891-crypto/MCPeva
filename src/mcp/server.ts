import { z } from 'zod';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { EvaService } from '../services/eva-service.js';
import { toEvaError } from '../errors.js';
import { truncate } from '../domain/util.js';
import { logger } from '../logger.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function result(data: unknown): CallToolResult {
  const text = JSON.stringify(data, null, 2);
  return {
    content: [{ type: 'text', text }],
    ...(Array.isArray(data)
      ? { structuredContent: { items: data, count: data.length } }
      : isRecord(data)
        ? { structuredContent: data }
        : {})
  };
}

function failure(error: unknown): CallToolResult {
  const evaError = toEvaError(error);
  logger.warn('Herramienta MCP falló', { code: evaError.code, message: evaError.message });
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(evaError.toJSON(), null, 2) }]
  };
}

function compactModule(module: {
  id: number;
  name: string;
  modname: string;
  url?: string;
  description?: string;
  visible: boolean;
  userVisible: boolean;
  contents: Array<unknown>;
}, includeDescriptions: boolean): Record<string, unknown> {
  return {
    id: module.id,
    name: module.name,
    modname: module.modname,
    ...(module.url ? { url: module.url } : {}),
    ...(includeDescriptions && module.description ? { description: truncate(module.description, 400) } : {}),
    visible: module.visible,
    userVisible: module.userVisible,
    fileCount: module.contents.length
  };
}

export function buildMcpServer(service: EvaService): McpServer {
  const server = new McpServer(
    { name: 'mcp-eva', version: '0.1.0' },
    {
      instructions:
        'Servidor MCP para EVA FING (Moodle). Empezá con eva_status. Usá eva_list_courses para ver tus cursos, ' +
        'eva_get_course_outline para recorrer secciones y actividades, y eva_get_activity para ver el detalle. ' +
        'Los IDs de curso son los de las URLs /course/view.php?id=...; los cmid son los de /mod/.../view.php?id=.... ' +
        'Para descargar materiales usá eva_download_file con la URL devuelta por las herramientas.'
    }
  );

  server.registerTool(
    'eva_status',
    {
      title: 'Estado de la conexión con EVA',
      description: 'Muestra el usuario autenticado, el modo de conexión (Web Services o sesión web) y las capacidades disponibles.',
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async () => {
      try {
        return result(await service.status(true));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_list_courses',
    {
      title: 'Listar cursos',
      description: 'Lista los cursos en los que estás inscripto. Si se pasa "query", busca cursos en toda la plataforma.',
      inputSchema: {
        query: z.string().min(1).optional().describe('Texto a buscar. Si se omite, devuelve tus cursos inscriptos.'),
        limit: z.number().int().min(1).max(100).optional().describe('Cantidad máxima de resultados (por defecto 30).')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ query, limit }) => {
      try {
        if (query) return result(await service.searchCourses(query, limit ?? 30));
        const courses = await service.getMyCourses();
        return result({ courses, count: courses.length });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_get_course',
    {
      title: 'Obtener curso',
      description: 'Devuelve los datos generales de un curso (nombre, categoría, fechas, resumen, URL).',
      inputSchema: {
        courseId: z.number().int().positive().describe('ID del curso (parámetro id de /course/view.php).')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ courseId }) => {
      try {
        return result(await service.getCourse(courseId));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_get_course_outline',
    {
      title: 'Recorrer el índice de un curso',
      description:
        'Devuelve el curso con todas sus secciones y actividades en formato compacto. Es la herramienta principal para ' +
        'entender la estructura del curso y encontrar los cmid de las actividades.',
      inputSchema: {
        courseId: z.number().int().positive().describe('ID del curso.'),
        includeDescriptions: z.boolean().optional().describe('Incluir un resumen corto de cada actividad (por defecto true).'),
        includeFiles: z.boolean().optional().describe('Incluir los archivos de cada actividad (por defecto false).')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ courseId, includeDescriptions, includeFiles }) => {
      try {
        const contents = await service.getCourseContents(courseId);
        return result({
          course: contents.course,
          source: contents.source,
          fetchedAt: contents.fetchedAt,
          sections: contents.sections.map((section) => ({
            id: section.id,
            number: section.number,
            name: section.name,
            ...(section.summary ? { summary: truncate(section.summary, 500) } : {}),
            visible: section.visible,
            userVisible: section.userVisible,
            modules: section.modules.map((module) => ({
              ...compactModule(module, includeDescriptions !== false),
              ...(includeFiles ? { files: module.contents } : {})
            }))
          }))
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_list_sections',
    {
      title: 'Listar secciones',
      description: 'Lista las secciones (temas/semanas) de un curso con la cantidad de actividades de cada una.',
      inputSchema: {
        courseId: z.number().int().positive().describe('ID del curso.')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ courseId }) => {
      try {
        const sections = await service.listSections(courseId);
        return result({
          sections: sections.map((section) => ({
            id: section.id,
            number: section.number,
            name: section.name,
            ...(section.summary ? { summary: truncate(section.summary, 300) } : {}),
            visible: section.visible,
            userVisible: section.userVisible,
            moduleCount: section.modules.length
          })),
          count: sections.length
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_get_section',
    {
      title: 'Obtener una sección',
      description: 'Devuelve una sección completa con sus actividades y archivos. Se puede buscar por número de sección o por ID interno.',
      inputSchema: {
        courseId: z.number().int().positive().describe('ID del curso.'),
        section: z.number().int().min(0).describe('Número de sección (el de ?section=...) o ID interno.'),
        by: z.enum(['number', 'id']).optional().describe('Interpretación de "section": number (por defecto) o id.')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ courseId, section, by }) => {
      try {
        return result(await service.getSection(courseId, section, by ?? 'number'));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_get_activity',
    {
      title: 'Obtener una actividad',
      description:
        'Devuelve el detalle de una actividad (tarea, foro, recurso, URL, página, cuestionario, etc.): descripción, ' +
        'archivos, enlaces y metadatos. Si es tarea incluye fechas y estado de entrega; si es foro incluye discusiones.',
      inputSchema: {
        cmid: z.number().int().positive().describe('ID del módulo del curso (cmid) de la URL /mod/.../view.php?id=.'),
        courseId: z.number().int().positive().optional().describe('ID del curso, si lo conocés.'),
        modname: z.string().optional().describe('Tipo de módulo (assign, forum, resource, url, page, quiz, etc.).'),
        name: z.string().optional().describe('Nombre de la actividad, como ayuda cuando no se conoce el cmid.')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ cmid, courseId, modname, name }) => {
      try {
        return result(await service.getActivity(cmid, courseId, modname, name));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_list_assignments',
    {
      title: 'Listar tareas',
      description: 'Lista las tareas de un curso con fechas de apertura, entrega y cierre.',
      inputSchema: {
        courseId: z.number().int().positive().describe('ID del curso.')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ courseId }) => {
      try {
        const assignments = await service.listAssignments(courseId);
        return result({ assignments, count: assignments.length });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_get_assignment',
    {
      title: 'Obtener una tarea',
      description: 'Devuelve una tarea y, si hay Web Services, el estado de la entrega y la calificación.',
      inputSchema: {
        courseId: z.number().int().positive().describe('ID del curso.'),
        cmid: z.number().int().positive().describe('cmid de la tarea (o su ID de instancia).')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ courseId, cmid }) => {
      try {
        return result(await service.getAssignment(courseId, cmid));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_list_forums',
    {
      title: 'Listar foros',
      description: 'Lista los foros de un curso.',
      inputSchema: {
        courseId: z.number().int().positive().describe('ID del curso.')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ courseId }) => {
      try {
        const forums = await service.listForums(courseId);
        return result({ forums, count: forums.length });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_get_forum_discussions',
    {
      title: 'Listar discusiones de un foro',
      description: 'Devuelve las discusiones de un foro, con autor, respuestas y enlace.',
      inputSchema: {
        forumId: z.number().int().positive().describe('ID del foro (instancia), devuelto por eva_list_forums.'),
        cmid: z.number().int().positive().describe('cmid del foro.'),
        courseId: z.number().int().positive().describe('ID del curso.'),
        page: z.number().int().min(0).optional().describe('Página (por defecto 0).'),
        perPage: z.number().int().min(1).max(100).optional().describe('Cantidad por página (por defecto 20).')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ forumId, cmid, courseId, page, perPage }) => {
      try {
        const discussions = await service.getForumDiscussions(forumId, cmid, courseId, page ?? 0, perPage ?? 20);
        return result({ discussions, count: discussions.length });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_get_discussion_posts',
    {
      title: 'Leer una discusión',
      description: 'Devuelve las publicaciones de una discusión de foro, con su texto y adjuntos.',
      inputSchema: {
        discussionId: z.number().int().positive().describe('ID de la discusión (parámetro d de discuss.php).')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ discussionId }) => {
      try {
        const posts = await service.getDiscussionPosts(discussionId);
        return result({ posts, count: posts.length });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_get_grades',
    {
      title: 'Consultar calificaciones',
      description: 'Devuelve las calificaciones del curso para el usuario autenticado (requiere Web Services).',
      inputSchema: {
        courseId: z.number().int().positive().describe('ID del curso.'),
        userId: z.number().int().positive().optional().describe('ID de otro usuario (solo si tenés permiso).')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ courseId, userId }) => {
      try {
        return result(await service.getGrades(courseId, userId));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_list_categories',
    {
      title: 'Listar categorías',
      description: 'Lista las categorías hijas de una categoría. Usá parentId=0 para las categorías raíz.',
      inputSchema: {
        parentId: z.number().int().min(0).optional().describe('ID de la categoría padre (0 para la raíz).')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ parentId }) => {
      try {
        const categories = await service.getCategories(parentId ?? 0);
        return result({ categories, count: categories.length });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_browse_category',
    {
      title: 'Explorar una categoría',
      description: 'Devuelve las subcategorías y los cursos visibles de una categoría.',
      inputSchema: {
        categoryId: z.number().int().positive().describe('ID de la categoría (parámetro categoryid).')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ categoryId }) => {
      try {
        return result(await service.browseCategory(categoryId));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_search_courses',
    {
      title: 'Buscar cursos',
      description: 'Busca cursos por texto en toda la plataforma.',
      inputSchema: {
        query: z.string().min(1).describe('Texto a buscar.'),
        limit: z.number().int().min(1).max(100).optional().describe('Cantidad máxima de resultados.')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ query, limit }) => {
      try {
        return result(await service.searchCourses(query, limit ?? 30));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_search_content',
    {
      title: 'Buscar dentro de los cursos',
      description:
        'Busca un texto en nombres y descripciones de cursos, secciones, actividades y archivos de tus cursos. ' +
        'Puede tardar porque recorre los cursos; limitá courseIds si sabés dónde buscar.',
      inputSchema: {
        query: z.string().min(1).describe('Texto a buscar.'),
        courseIds: z.array(z.number().int().positive()).max(30).optional().describe('IDs de cursos donde buscar.'),
        limit: z.number().int().min(1).max(200).optional().describe('Cantidad máxima de coincidencias (por defecto 60).')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ query, courseIds, limit }) => {
      try {
        const hits = await service.searchContent(query, courseIds, limit ?? 60);
        return result({ hits, count: hits.length });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_search_files',
    {
      title: 'Buscar archivos por nombre',
      description:
        'Busca archivos por nombre y/o extensión en tus cursos (por ejemplo, "parcial pdf" o extensions=["pdf"]). ' +
        'Devuelve el nombre, curso, sección, actividad y URL de descarga de cada archivo.',
      inputSchema: {
        query: z.string().optional().describe('Texto a buscar en el nombre del archivo.'),
        extensions: z
          .array(z.string().min(1))
          .max(10)
          .optional()
          .describe('Extensiones a incluir, sin punto (por ejemplo, ["pdf", "docx"]).'),
        courseIds: z.array(z.number().int().positive()).max(30).optional().describe('IDs de cursos donde buscar.'),
        limit: z.number().int().min(1).max(200).optional().describe('Cantidad máxima de archivos (por defecto 60).')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ query, extensions, courseIds, limit }) => {
      try {
        const files = await service.searchFiles(query ?? '', { extensions, courseIds, limit: limit ?? 60 });
        return result({ files, count: files.length });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'eva_download_file',
    {
      title: 'Descargar un archivo',
      description:
        'Descarga un archivo de EVA al directorio local de descargas y devuelve su ruta. Solo acepta URLs del dominio de EVA. ' +
        'La descarga queda registrada en el disco del servidor, no se envía al modelo.',
      inputSchema: {
        url: z.string().url().describe('URL del archivo (por ejemplo, la devuelta en contents/fileUrl).'),
        filename: z.string().min(1).max(200).optional().describe('Nombre de archivo sugerido.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ url, filename }) => {
      try {
        return result(await service.downloadFile(url, filename));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerResource(
    'estado',
    'eva://status',
    { title: 'Estado de EVA', description: 'Usuario y modo de conexión actual.', mimeType: 'application/json' },
    async (uri) => {
      const status = await service.status(true);
      return { contents: [{ uri: uri.toString(), mimeType: 'application/json', text: JSON.stringify(status, null, 2) }] };
    }
  );

  server.registerResource(
    'cursos',
    'eva://courses',
    { title: 'Mis cursos', description: 'Cursos inscriptos del usuario.', mimeType: 'application/json' },
    async (uri) => {
      const courses = await service.getMyCourses();
      return {
        contents: [{ uri: uri.toString(), mimeType: 'application/json', text: JSON.stringify({ courses, count: courses.length }, null, 2) }]
      };
    }
  );

  server.registerResource(
    'contenido-curso',
    new ResourceTemplate('eva://course/{courseId}/contents', { list: undefined }),
    { title: 'Contenido de un curso', description: 'Secciones y actividades de un curso.', mimeType: 'application/json' },
    async (uri, variables) => {
      const courseId = Number(variables.courseId);
      const contents = await service.getCourseContents(courseId);
      return {
        contents: [{ uri: uri.toString(), mimeType: 'application/json', text: JSON.stringify(contents, null, 2) }]
      };
    }
  );

  return server;
}
