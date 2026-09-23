import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';

const root = new URL('../web/', import.meta.url);
const types: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', webmanifest: 'application/manifest+json; charset=utf-8' };
const publicFiles = new Set(['/jelly.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest']);

export async function serveWeb(path: string, method: string | undefined, res: ServerResponse): Promise<boolean> {
  if (method !== 'GET' && method !== 'HEAD') return false;
  // Only built, allowlisted web assets are public; never serve arbitrary paths from the repository.
  const file = path === '/' ? 'index.html' : publicFiles.has(path) ? path.slice(1)
    : /^\/assets\/[a-zA-Z0-9._-]+\.(js|css)$/.test(path) ? path.slice(1) : null;
  if (!file) return false;
  let content: Buffer;
  try { content = await readFile(fileURLToPath(new URL(file, root))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  res.writeHead(200, {
    'Content-Type': types[file.split('.').pop()!] ?? 'application/octet-stream',
    'Content-Length': content.length,
    'Cache-Control': file.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(method === 'HEAD' ? undefined : content);
  return true;
}
