import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

/** Paths the host itself owns; they never fall back to index.html. */
const RESERVED = ['/ws', '/assets', '/healthz', '/__test'];

function isReserved(path: string): boolean {
  return RESERVED.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Serves the built client (HOST-01) from the Fastify not-found handler, so every explicit route
 * (/ws upgrade, /assets/*, /healthz) wins and is never shadowed. Unknown extension-less GET paths
 * get index.html (SPA fallback); unknown files and reserved prefixes stay 404.
 */
export function registerStaticClient(app: FastifyInstance, root: string): void {
  app.setNotFoundHandler(async (request, reply) => {
    const method = request.method;
    if (method !== 'GET' && method !== 'HEAD') return reply.code(404).send({ error: 'not-found' });
    let path: string;
    try {
      path = decodeURIComponent(request.url.split('?')[0] ?? '/');
    } catch {
      return reply.code(400).send({ error: 'bad-request' });
    }
    if (isReserved(path) || path.includes('\0'))
      return reply.code(404).send({ error: 'not-found' });

    const rel = normalize(path).replace(/^([/\\])+/, '');
    const candidate = join(root, rel);
    // Guard against traversal out of the client root.
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      return reply.code(404).send({ error: 'not-found' });
    }
    let file = candidate;
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) {
      if (extname(path) !== '') return reply.code(404).send({ error: 'not-found' });
      file = join(root, 'index.html');
    }
    const body = await readFile(file).catch(() => undefined);
    if (!body) return reply.code(404).send({ error: 'not-found' });
    const ext = extname(file).toLowerCase();
    // Hashed bundle files are immutable; index.html must always revalidate.
    const immutable = file.includes(`${sep}static${sep}`);
    return reply
      .header('content-type', TYPES[ext] ?? 'application/octet-stream')
      .header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
      .send(method === 'HEAD' ? undefined : body);
  });
}
