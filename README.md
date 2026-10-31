<div align="center">

# 🎓 mcp-eva

**Backend, API REST y servidor MCP para recorrer y trabajar con EVA FING** (Moodle 4.5 · `https://eva.fing.edu.uy/`)

*Que un agente o un cliente propio entienda la estructura de los cursos —categorías, cursos, secciones, actividades, archivos, tareas, foros y calificaciones— sin tener que navegar la interfaz de Moodle.*

[![Node](https://img.shields.io/badge/Node.js-20.18.1+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/docs/latest-v20.x/api/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-1.32-DA5A2A?style=flat-square&logo=modelcontextprotocol&logoColor=white)](https://modelcontextprotocol.io/)
[![Fastify](https://img.shields.io/badge/Fastify-5.12-000000?style=flat-square&logo=fastify&logoColor=white)](https://fastify.dev/docs/)
[![Ink](https://img.shields.io/badge/Ink-6.8-FF6B6B?style=flat-square&logo=react&logoColor=white)](https://github.com/vadimdemedes/ink)
[![React](https://img.shields.io/badge/React-19.3-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Cheerio](https://img.shields.io/badge/Cheerio-1.2-3EE48C?style=flat-square&logo=npm&logoColor=black)](https://cheerio.js.org/)
[![Zod](https://img.shields.io/badge/Zod-4.6-3E67B1?style=flat-square&logo=zod&logoColor=white)](https://zod.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-1.64-2EAD33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev/docs/intro)
[![Vitest](https://img.shields.io/badge/Vitest-4.0-729B1B?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)

[![Licencia](https://img.shields.io/badge/licencia-MIT-blue?style=flat-square)](#licencia)
[![Estado](https://img.shields.io/badge/estado-solo%20lectura-yellow?style=flat-square)](#qué-es)
[![Tests](https://img.shields.io/badge/tests-48%20pasando-brightgreen?style=flat-square)](#tests)
[![Plataforma](https://img.shields.io/badge/EVA-FING%20%7C%20Moodle%204.5-4A90D9?style=flat-square&logo=moodle&logoColor=white)](https://eva.fing.edu.uy/)

</div>

---

## 📑 Índice

- [Qué es](#qué-es)
- [Arquitectura](#arquitectura)
- [Stack tecnológico](#stack-tecnológico)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Autenticación](#autenticación)
- [Uso por CLI](#uso-por-cli)
- [TUI (interfaz interactiva)](#tui-interfaz-interactiva)
- [API REST](#api-rest)
- [Servidor MCP](#servidor-mcp)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Configuración](#configuración)
- [Tests](#tests)
- [Seguridad](#seguridad)
- [Limitaciones conocidas](#limitaciones-conocidas)
- [Licencia](#licencia)

---

## 🎯 Qué es

`mcp-eva` es un backend en **TypeScript/Node** que expone la plataforma **EVA FING** (una instancia Moodle 4.5 usada por la Facultad de Ingeniería de la UdelaR) a través de tres interfaces que comparten la misma capa de servicios:

- **CLI** — comandos para consultar y descargar desde la terminal.
- **API REST** — servidor HTTP (Fastify) con rutas JSON.
- **Servidor MCP** — para conectar EVA a clientes/agentes que hablen el *Model Context Protocol*.

Además incluye una **TUI** (interfaz de terminal con Ink/React) para navegar cursos, secciones, actividades y archivos sin escribir comandos ni recordar IDs.

> **Estado:** 🔒 **solo lectura.** `EVA_READ_ONLY=true` es el valor por defecto y todavía no hay operaciones de escritura.

---

## 🏗 Arquitectura

El diseño separa claramente las interfaces (CLI / API / MCP / TUI) de la lógica de acceso a Moodle, que se resuelve en dos capas con respaldo automático:

```
   CLI ─ API REST ─ MCP ─ TUI
              │
        services/ (EvaService)
         │            │
   Web Services   Sesión web
   (token oficial) (parseo HTML)
         │            │
       eva/ ws-client · web-client · web-parsers
              │
          EVA FING (Moodle 4.5)
```

**Flujo de una consulta:**

1. Se carga la sesión guardada en `~/.mcp-eva/session.json` (cookies + token opcional).
2. Si hay token de **Web Services**, se usa la API oficial de Moodle (más rápida y completa).
3. Si no hay token, o la función no está habilitada para el servicio, se usa la **sesión web** y se parsea el HTML con Cheerio.
4. Los resultados se normalizan a los tipos de `src/domain/types.ts` y se **cachean** con TTL.

---

## 📚 Stack tecnológico

| Tecnología | Versión | Para qué se usa | Documentación |
| --- | --- | --- | --- |
| [Node.js](https://nodejs.org/docs/latest-v20.x/api/) | 20.18.1+ | Runtime y API de archivos/red | [Docs](https://nodejs.org/docs/latest-v20.x/api/) |
| [TypeScript](https://www.typescriptlang.org/docs/) | 5.9 | Tipado estricto, compilación a ESM | [Docs](https://www.typescriptlang.org/docs/) |
| [MCP SDK](https://modelcontextprotocol.io/) | 1.32 | Servidor y transporte MCP (stdio/HTTP) | [Docs](https://modelcontextprotocol.io/docs) |
| [Fastify](https://fastify.dev/docs/) | 5.12 | API REST de alta performance | [Docs](https://fastify.dev/docs/) |
| [Ink](https://github.com/vadimdemedes/ink) | 6.8 | TUI declarativa en la terminal | [Docs](https://github.com/vadimdemedes/ink) |
| [React](https://react.dev/) | 19.3 | Modelo de componentes para la TUI | [Docs](https://react.dev/) |
| [Cheerio](https://cheerio.js.org/) | 1.2 | Parseo del HTML de Moodle (jQuery-like) | [Docs](https://cheerio.js.org/) |
| [Zod](https://zod.dev/) | 4.6 | Validación de esquemas y parámetros | [Docs](https://zod.dev/) |
| [Playwright Core](https://playwright.dev/docs/intro) | 1.64 | Login con navegador (sin binarios propios) | [Docs](https://playwright.dev/docs/intro) |
| [Tough Cookie](https://github.com/salesforce/tough-cookie) | 5.1 | Manejo y persistencia de cookies | [Docs](https://github.com/salesforce/tough-cookie) |
| [Vitest](https://vitest.dev/) | 4.0 | Tests unitarios y de componentes TUI | [Docs](https://vitest.dev/) |
| [tsx](https://tsx.is/) | 4.2 | Ejecución de TS en desarrollo | [Docs](https://tsx.is/) |

---

## 📋 Requisitos

- **Node.js** 20.18 o superior.
- **Microsoft Edge** o **Google Chrome** instalado (se usa `playwright-core`, sin descargar navegadores).
- Acceso a **EVA FING** (cuenta UdelaR o local).

---

## ⚙️ Instalación

```bash
# 1. Clonar e instalar dependencias
git clone https://github.com/<tu-usuario>/MCPeva.git
cd MCPeva
npm install

# 2. Configurar variables (opcional, hay valores por defecto)
cp .env.example .env
# En PowerShell: Copy-Item .env.example .env

# 3. Compilar
npm run build
```

### Scripts disponibles

| Script | Descripción |
| --- | --- |
| `npm run dev` | Desarrollo con recarga (`tsx watch`). |
| `npm run build` | Compilar a `dist/`. |
| `npm start` | Ejecutar la CLI compilada. |
| `npm run login` / `token` / `logout` | Gestión de sesión. |
| `npm run status` / `courses` / `contents` | Consultas rápidas. |
| `npm run search` / `content` / `files` | Búsquedas. |
| `npm run download` | Descargar un archivo. |
| `npm run tui` | Interfaz interactiva. |
| `npm run api` / `npm run mcp` | Servidores REST / MCP. |
| `npm test` / `npm run test:watch` | Tests (Vitest). |
| `npm run typecheck` | Comprobación de tipos. |
| `npm run check` | `typecheck` + `test`. |

---

## 🔐 Autenticación

EVA usa **Shibboleth** (`login.udelar.edu.uy`) para las cuentas de la UdelaR. El camino principal es:

```bash
npm run login
```

Eso abre Edge/Chrome, espera a que inicies sesión (estudiante por UdelaR o usuario local) y luego:

1. Guarda las cookies de la sesión web.
2. Intenta obtener automáticamente un **token de Web Services** llamando a `/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=...&urlscheme=moodlemobile`.
3. Valida el token con `core_webservice_get_site_info`.
4. Guarda todo en `~/.mcp-eva/session.json` con permisos restringidos.

Si el token móvil no está disponible, la **sesión web sigue funcionando como respaldo** (con menos capacidades: por ejemplo, las calificaciones requieren Web Services).

También podés guardar un token existente:

```bash
npm run token -- TU_TOKEN
# o sin argumento, para que lo pida por consola:
npm run token
```

Variables opcionales para login automático sin interacción (no recomendado para cuentas SSO):

```env
EVA_USERNAME=...
EVA_PASSWORD=...
EVA_BROWSER_HEADLESS=true
```

---

## 💻 Uso por CLI

```bash
npm run status
npm run courses
npm run courses -- --query "gestión" --limit 10
npm run contents -- 1988
npm run search -- "bases de datos"
npm run content -- "parcial" --courses 1988,2001
npm run files -- "parcial" --ext pdf
npm run files -- --ext pdf --courses 1988 --limit 100
npm run download -- "https://eva.fing.edu.uy/pluginfile.php/..."
npm run tui
```

Todos los comandos aceptan `--json` para una salida apta para scripts. Los logs van a **stderr**, así que `stdout` queda limpio.

| Comando | Descripción |
| --- | --- |
| `login` | Abre el navegador y guarda la sesión. `--headless` usa las credenciales del `.env`. |
| `token [TOKEN]` | Valida y guarda un token de Web Services. |
| `logout` | Borra la sesión guardada. |
| `status` | Muestra sitio, versión de Moodle, usuario y capacidades. |
| `courses` | Lista tus cursos. Con `--query` busca en toda la plataforma. |
| `contents <cursoId>` | Muestra secciones y actividades de un curso. |
| `search <texto>` | Busca cursos por texto. |
| `content <texto>` | Busca dentro de tus cursos (secciones, actividades y archivos). |
| `files <texto>` | Busca archivos por nombre y/o extensión (`--ext pdf`, `--courses 1,2`). |
| `download <url>` | Descarga un archivo al directorio local. |
| `tui` | Interfaz interactiva (ver abajo). |
| `api` | Inicia la API REST. |
| `mcp` | Inicia el servidor MCP por stdio. `--http` usa Streamable HTTP. |
| `help` | Muestra la ayuda. |

---

## 🖥 TUI (interfaz interactiva)

```bash
npm run tui
```

Es una interfaz de terminal (**Ink** + **React**) pensada para navegar EVA sin recordar comandos ni IDs:

```text
EVA › Mis cursos                                    uy-do-… · Web Services
┌──────────────────────────────────────────────┐
│ 3 curso(s)                                    │
│ > GAL1-2S Geometría y Álgebra Lineal 1       │
│   CDIV-2S Cálculo diferencial e integral     │
│   PIm Programación Imperativa                │
└──────────────────────────────────────────────┘
 ↑↓ jk moverse · Enter abrir curso · / buscar          q salir
```

La **barra inferior** (estilo status bar, a todo el ancho y en la última línea del terminal) muestra las teclas y su uso **según la pantalla actual**:

| Tecla | Pantalla | Uso |
| --- | --- | --- |
| `↑` `↓` o `j` `k` | todas | Moverse por la lista |
| `Enter` | cursos | Abrir el curso seleccionado |
| `Enter` | curso | Abrir la actividad seleccionada |
| `Enter` | actividad | Si es un foro, abrir sus discusiones |
| `Enter` | foro | Abrir la discusión seleccionada y leer sus mensajes |
| `Enter` | buscar | Buscar si escribiste texto; si hay resultado seleccionado, abre la actividad o descarga el archivo |
| `d` | actividad | Descargar el archivo seleccionado |
| `o` | actividad | Descargar y abrir el archivo con la app del sistema |
| `d` | discusión | Descargar el adjunto del mensaje seleccionado |
| `o` | discusión | Descargar y abrir el adjunto (o el último descargado) |
| `Espacio` o `l` | discusión | Expandir el mensaje seleccionado: cuerpo completo y sus adjuntos |
| `Escribir` | buscar | Carga el texto de la búsqueda |
| `Backspace` | buscar | Borra el último carácter |
| `/` o `f` | cursos, curso, actividad, foro | Ir a la búsqueda global |
| `Esc` o `h` | curso, actividad, foro, discusión, buscar | Volver a la pantalla anterior |
| `q` | cursos, curso, actividad, foro, discusión | Salir (en buscar, `Esc` y después `q`; `Ctrl+C` sale siempre) |

**Flujo típico:** `Mis cursos → curso → sección → actividad → archivo (d / o)`.

**Navegación de foros:** `actividad de foro (Enter) → discusiones del foro (Enter) → mensajes de la discusión`. En la pantalla del foro se ven la introducción y cada discusión con su autor, fecha, respuestas y no leídas; en la de mensajes, el hilo ordenado jerárquicamente (las respuestas van sangradas), con el cuerpo del mensaje seleccionado previsualizado arriba. `Espacio` lo expande y ahí aparecen sus adjuntos, que se descargan con `d` y se abren con `o`.

- Los cursos, secciones y actividades salen de la misma capa de servicios que el CLI, la API y el MCP (con Web Services primero y sesión web como respaldo).
- La búsqueda global busca a la vez en nombres de actividades/secciones (`searchContent`) y en nombres de archivo (`searchFiles`).
- Las descargas se guardan en `EVA_DOWNLOADS_DIR` y `o` las abre con el visor predeterminado (Edge/Preview/xdg-open).
- Requiere una **terminal interactiva (TTY)** y una sesión válida (`npm run login`).

---

## 🌐 API REST

```bash
npm run api
# http://127.0.0.1:8787
```

Si definís `EVA_API_KEY`, todas las rutas salvo `/health` requieren `x-api-key: <clave>` o `Authorization: Bearer <clave>`.

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/health` | Estado del proceso. |
| GET | `/api/status` | Usuario, modo de conexión y capacidades. |
| GET | `/api/courses` | Cursos inscriptos. Acepta `?q=` o `?categoryId=`. |
| GET | `/api/courses/:id` | Datos de un curso. |
| GET | `/api/courses/:id/contents` | Curso completo con secciones y actividades. `?includeModules=false` resume. |
| GET | `/api/courses/:id/sections` | Lista de secciones. |
| GET | `/api/courses/:id/sections/:section` | Una sección. `?by=id` para buscar por ID interno. |
| GET | `/api/courses/:id/assignments` | Tareas del curso. |
| GET | `/api/courses/:id/assignments/:cmid` | Detalle de una tarea y estado de entrega. |
| GET | `/api/courses/:id/forums` | Foros del curso. |
| GET | `/api/courses/:id/forums/:forumId/discussions?cmid=` | Discusiones de un foro. |
| GET | `/api/discussions/:id/posts` | Publicaciones de una discusión. |
| GET | `/api/courses/:id/grades` | Calificaciones (requiere Web Services). Acepta `?userId=`. |
| GET | `/api/activities/:cmid` | Detalle de una actividad. Acepta `?courseId=`, `?modname=`, `?name=`. |
| GET | `/api/categories` | Categorías hijas. Acepta `?parentId=` (0 = raíz). |
| GET | `/api/categories/:id/browse` | Subcategorías y cursos de una categoría. |
| GET | `/api/search/courses?q=` | Búsqueda de cursos. Acepta `?limit=`. |
| GET | `/api/search/content?q=` | Búsqueda dentro de cursos. Acepta `?courseIds=1,2&limit=`. |
| GET | `/api/search/files?q=` | Busca archivos por nombre. Acepta `?ext=pdf,docx&courseIds=1,2&limit=`. |
| POST | `/api/files/download` | Descarga un archivo. Cuerpo: `{ "url": "...", "filename": "..." }`. |
| GET | `/api/download?url=` | Descarga y devuelve el archivo con `content-disposition`. |

Los errores tienen la forma:

```json
{
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "No hay una sesión válida de EVA. Ejecutá \"npm run login\" para iniciar sesión."
  }
}
```

Códigos: `AUTH_REQUIRED`, `AUTH_FAILED`, `TOKEN_INVALID`, `SESSION_EXPIRED`, `NOT_FOUND`, `INVALID_INPUT`, `NOT_ALLOWED`, `DOWNLOAD_TOO_LARGE`, `UPSTREAM_ERROR`, `NETWORK_ERROR`.

---

## 🤖 Servidor MCP

### stdio (recomendado para clientes locales)

Compilá primero y configurá el cliente para ejecutar `node dist/cli/index.js mcp`:

```json
{
  "mcpServers": {
    "eva": {
      "command": "node",
      "args": ["C:/ruta/a/MCPeva/dist/cli/index.js", "mcp"],
      "env": { "EVA_LOG_LEVEL": "warn" }
    }
  }
}
```

El proceso **no escribe nada en `stdout`** salvo el protocolo MCP. Todos los logs van a `stderr`.

### HTTP

```bash
node dist/cli/index.js mcp --http --port 8788
# POST http://127.0.0.1:8788/mcp
```

El transporte es **Streamable HTTP** con sesiones (`mcp-session-id`). Respeta `EVA_API_KEY` igual que la API REST.

### Herramientas

| Herramienta | Descripción |
| --- | --- |
| `eva_status` | Usuario, modo de conexión y capacidades. |
| `eva_list_courses` | Cursos inscriptos; con `query` busca en toda la plataforma. |
| `eva_get_course` | Datos generales de un curso. |
| `eva_get_course_outline` | Índice compacto del curso: secciones y actividades. |
| `eva_list_sections` | Secciones con cantidad de actividades. |
| `eva_get_section` | Una sección completa, por número o ID. |
| `eva_get_activity` | Detalle de una actividad (descripción, archivos, enlaces, metadatos). |
| `eva_list_assignments` / `eva_get_assignment` | Tareas y estado de entrega. |
| `eva_list_forums` / `eva_get_forum_discussions` / `eva_get_discussion_posts` | Foros y publicaciones. |
| `eva_get_grades` | Calificaciones (requiere Web Services). |
| `eva_list_categories` / `eva_browse_category` | Navegación por categorías. |
| `eva_search_courses` / `eva_search_content` | Búsqueda de cursos y de contenido. |
| `eva_search_files` | Busca archivos por nombre y/o extensión en tus cursos. |
| `eva_download_file` | Descarga un archivo de EVA al disco local. |

### Recursos

- `eva://status`
- `eva://courses`
- `eva://course/{courseId}/contents`

---

## 🗂 Estructura del proyecto

```
MCPeva/
├── src/
│   ├── cli/                 Interfaz de línea de comandos (login, status, courses, api, mcp, tui, ...)
│   ├── tui/                 Interfaz interactiva de terminal (Ink/React) para navegar cursos
│   │   ├── App.tsx          Componente raíz: pantallas, footer de ayuda y toast
│   │   ├── index.ts         Arranque de la TUI (valida TTY y sesión, silencia logs)
│   │   ├── list.ts          Helpers de listas (ventana, truncado, formato)
│   │   ├── foros.ts         Helpers de foros (HTML a texto, orden de mensajes)
│   │   ├── outline.ts       Aplanado de secciones/actividades y etiquetas
│   │   ├── open-file.ts     Apertura de archivos con la app del sistema
│   │   └── hooks.ts         Hook de tamaño de terminal
│   ├── api/
│   │   └── server.ts        API REST con Fastify
│   ├── mcp/
│   │   ├── server.ts        Herramientas, recursos y lógica MCP
│   │   └── transport.ts     Transportes MCP (stdio / Streamable HTTP)
│   ├── services/
│   │   └── eva-service.ts   Orquestación: WS primero, web como respaldo, caché y descargas
│   ├── auth/
│   │   ├── login.ts         Login con navegador (playwright-core) y extracción de token móvil
│   │   ├── cookie-store.ts  Manejo de cookies (tough-cookie)
│   │   └── session-store.ts Sesión persistida en ~/.mcp-eva/session.json
│   ├── eva/
│   │   ├── ws-client.ts     Cliente de Web Services de Moodle
│   │   ├── web-client.ts    Cliente web (sesión + requests)
│   │   ├── web-parsers.ts   Parseo del HTML de Moodle con Cheerio
│   │   ├── mappers.ts       Mapeo de respuestas WS a tipos de dominio
│   │   └── http-client.ts   Cliente HTTP base con timeout y errores tipados
│   ├── domain/
│   │   ├── types.ts         Tipos normalizados del dominio
│   │   ├── file-search.ts   Búsqueda de archivos por nombre/extensión
│   │   └── util.ts          Utilidades de URLs, texto y saneamiento
│   ├── cache.ts             Caché en memoria con TTL
│   ├── config.ts            Configuración por variables de entorno
│   ├── errors.ts            Errores tipados (AUTH_REQUIRED, NOT_FOUND, ...)
│   └── logger.ts            Logs JSON a stderr con redacción de secretos
├── test/
│   ├── fixtures/            HTML de ejemplo de Moodle (curso, actividad, foro, ...)
│   ├── auth.test.ts
│   ├── file-search.test.ts
│   ├── mappers.test.ts
│   ├── parsers.test.ts
│   ├── tui-app.test.tsx     Smoke test de la TUI con ink-testing-library
│   ├── tui-foros.test.ts    Helpers puros de foros (HTML, fechas, orden de mensajes)
│   ├── tui-forums.test.tsx  Navegación de foros: actividad → discusiones → mensajes
│   ├── tui-list.test.ts     Helpers puros de la TUI
│   ├── util.test.ts
│   └── ws-client.test.ts
├── .env.example             Ejemplo de configuración
├── package.json             Scripts, dependencias y binarios (mcp-eva / eva)
├── tsconfig.json            Configuración de TypeScript (incluye JSX)
├── tsconfig.build.json      Configuración de compilación a dist/
└── README.md                Este archivo
```

### Roles de cada capa

- **`cli/`** — interpreta argumentos y delega en `services/`. Es la única entrada de usuario junto a la API, el MCP y la TUI.
- **`tui/`** — interfaz declarativa en la terminal. Usa la misma `EvaService` que el resto.
- **`api/`** — expone `EvaService` como rutas HTTP JSON.
- **`mcp/`** — traduce herramientas/recursos MCP a llamadas de `EvaService`.
- **`services/`** — orquesta todo: decide si ir por Web Services o por sesión web, cachea y gestiona descargas.
- **`auth/`** — login con navegador, cookies y sesión persistida.
- **`eva/`** — clientes y parsers específicos de Moodle.
- **`domain/`** — tipos normalizados (lo que consumen CLI/API/MCP/TUI) y utilidades puras.

---

## ⚙️ Configuración

Todas las variables son opcionales. Se leen desde `.env` o del entorno.

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `EVA_BASE_URL` | `https://eva.fing.edu.uy` | URL base de la instancia Moodle. |
| `EVA_TOKEN` | — | Token de Web Services. Tiene prioridad sobre el guardado. |
| `EVA_WS_SERVICE` | `moodle_mobile_app` | Servicio asociado al token. |
| `EVA_DATA_DIR` | `~/.mcp-eva` | Directorio de datos. |
| `EVA_SESSION_FILE` | `~/.mcp-eva/session.json` | Archivo de sesión. |
| `EVA_DOWNLOADS_DIR` | `~/.mcp-eva/downloads` | Directorio de descargas. |
| `EVA_MAX_DOWNLOAD_BYTES` | `209715200` (200 MB) | Tamaño máximo de descarga. |
| `EVA_BROWSER_CHANNEL` | `msedge` | Canal de Playwright (`msedge`, `chrome`). |
| `EVA_BROWSER_HEADLESS` | `false` | Login sin ventana (requiere credenciales). |
| `EVA_USERNAME` / `EVA_PASSWORD` | — | Credenciales opcionales para login automático. |
| `EVA_API_HOST` | `127.0.0.1` | Host de la API REST y del MCP HTTP. |
| `EVA_API_PORT` | `8787` | Puerto de la API REST (el MCP HTTP usa `8788`). |
| `EVA_API_KEY` | — | Clave para proteger API y MCP HTTP. |
| `EVA_REQUEST_TIMEOUT_MS` | `30000` | Timeout de requests a EVA. |
| `EVA_LOGIN_TIMEOUT_MS` | `300000` | Espera máxima para completar el login. |
| `EVA_CACHE_TTL_MS` | `120000` | TTL base de la caché. |
| `EVA_LOG_LEVEL` | `info` | `debug`, `info`, `warn` o `error`. |
| `EVA_READ_ONLY` | `true` | Reservado para futuras operaciones de escritura. |

---

## 🧪 Tests

```bash
npm test            # corrida única
npm run test:watch  # modo watch
```

**48 tests** en verde, organizados por suites:

| Suite | Qué cubre |
| --- | --- |
| `parsers.test.ts` | Parseo del HTML de Moodle (curso, actividades, foros, discusiones, categorías) con fixtures. |
| `mappers.test.ts` | Mapeo de respuestas de Web Services a tipos de dominio. |
| `auth.test.ts` | Extracción del token móvil, cookies y serialización de sesión. |
| `file-search.test.ts` | Búsqueda de archivos por nombre y extensión. |
| `ws-client.test.ts` | Serialización de parámetros y manejo de respuestas del WS. |
| `util.test.ts` | Utilidades de URLs, texto y saneamiento. |
| `tui-list.test.ts` | Helpers puros de la TUI (ventana de lista, truncado, outline). |
| `tui-app.test.tsx` | Smoke test de la TUI con `ink-testing-library` (navegación, descarga, volver). |
| `tui-foros.test.ts` | Helpers de foros: HTML a texto, fechas, formato de discusiones y orden jerárquico de mensajes. |
| `tui-forums.test.tsx` | Navegación de foros en la TUI: actividad → discusiones → mensajes, expandir y descargar adjuntos. |

Los fixtures HTML de ejemplo están en `test/fixtures/`.

---

## 🔒 Seguridad

- La sesión se guarda en `~/.mcp-eva/session.json` con permisos `0600` cuando el sistema lo permite. **Contiene cookies y un token equivalentes a tu contraseña**: no la compartas ni la subas a un repositorio.
- El logger **redacta** tokens, contraseñas y cookies antes de escribirlos.
- Las descargas solo se permiten desde el host de `EVA_BASE_URL`; se valida el nombre del archivo y se evita escribir fuera del directorio de descargas.
- La API y el MCP HTTP escuchan en `127.0.0.1` por defecto. Si los exponés en red, configurá `EVA_API_KEY`.
- El modo de solo lectura es el valor por defecto. No hay herramientas que modifiquen cursos.

---

## ⚠️ Limitaciones conocidas

- Las calificaciones y algunas funciones requieren token de **Web Services**; con solo sesión web no están disponibles.
- El login necesita un navegador instalado (Edge o Chrome).
- El formato `onetopic` se recorre pestaña por pestaña, así que la primera lectura de un curso puede tardar. Luego se usa la caché.
- No hay operaciones de escritura (renombrar secciones, crear recursos, entregar tareas) en esta versión.

---

## 📄 Licencia

Este proyecto se distribuye bajo la licencia **MIT**. Es un proyecto independiente, sin relación oficial con la UdelaR ni la FING.

<div align="center">

[![Node](https://img.shields.io/badge/Node.js-20.18.1+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/docs/latest-v20.x/api/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/)
[![MCP](https://img.shields.io/badge/MCP-1.32-DA5A2A?style=for-the-badge&logo=modelcontextprotocol&logoColor=white)](https://modelcontextprotocol.io/)

</div>
