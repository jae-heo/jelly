import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { Config } from './config.js';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export const Id = z.uuid();
export const Name = z.string().trim().min(1).max(100);
export const Size = z.object({ cols: z.number().int().min(2).max(500).default(80), rows: z.number().int().min(2).max(200).default(24) });

export function authorized(req: IncomingMessage, token: string): boolean {
  const supplied = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export function checkOrigin(req: IncomingMessage, config: Config): void {
  if (req.headers.origin && !config.origins.has(req.headers.origin)) throw new ApiError(403, 'Origin not allowed');
}
export async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new ApiError(415, 'Expected application/json');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new ApiError(413, 'Request body too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'Invalid JSON'); }
}
export function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
export function failure(error: unknown): { status: number; message: string } {
  if (error instanceof ApiError) return { status: error.status, message: error.message };
  if (error instanceof z.ZodError) return { status: 400, message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') };
  // Never expose exec arguments, terminal contents, tokens or filesystem diagnostics in responses/logs.
  console.error('Jelly operation failed:', error instanceof Error ? error.name : 'UnknownError');
  return { status: 500, message: 'Internal server error' };
}
