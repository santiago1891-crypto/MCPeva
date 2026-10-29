import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { EvaService } from '../services/eva-service.js';
import { buildMcpServer } from './server.js';

export async function startMcpStdio(service: EvaService): Promise<void> {
  const server = buildMcpServer(service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Servidor MCP escuchando por stdio');
}

function authorized(request: IncomingMessage): boolean {
  if (!config.apiKey) return true;
  const header = request.headers['x-api-key'];
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  return header === config.apiKey || bearer === config.apiKey;
}

export async function startMcpHttp(service: EvaService, port = config.apiPort + 1, host = config.apiHost): Promise<ReturnType<typeof createServer>> {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type, mcp-session-id, x-api-key, authorization');
    response.setHeader('access-control-expose-headers', 'mcp-session-id');

    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname !== '/mcp') {
      response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Ruta no encontrada' }));
      return;
    }
    if (!authorized(request)) {
      response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'API key inválida o ausente' }));
      return;
    }

    const sessionId = request.headers['mcp-session-id'];
    const existing = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;
    if (existing) {
      await existing.handleRequest(request, response);
      return;
    }

    if (sessionId) {
      response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Sesión MCP no encontrada' }));
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Falta mcp-session-id' }));
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        transports.set(newSessionId, transport);
      }
    });
    const server = buildMcpServer(service);
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) transports.delete(id);
      void server.close();
    };
    await server.connect(transport);
    await transport.handleRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => resolve());
  });
  logger.info('Servidor MCP HTTP escuchando', { url: `http://${host}:${port}/mcp` });
  return httpServer;
}

export async function handleHttpRequest(
  transport: StreamableHTTPServerTransport,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  await transport.handleRequest(request, response);
}
