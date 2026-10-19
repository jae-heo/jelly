import { randomBytes } from 'node:crypto';
import { posix } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from './config.js';
import type { Store, Project } from './store.js';
import { ApiError } from './http.js';
import { ProjectFiles, collect, filePath, previewType } from './project-files.js';

export class FileTransfers {
  private files: ProjectFiles;
  private tickets = new Map<string, { projectId: string; path: string; expires: number }>();
  private active = new Set<AbortController>();
  private closed = false;
  constructor(config: Config, private store: Store) { this.files = new ProjectFiles(config, id => store.host(id)); }
  private prune() { for (const [key, value] of this.tickets) if (value.expires <= Date.now()) this.tickets.delete(key); }
  async operation<T>(req: IncomingMessage, res: ServerResponse, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) throw new ApiError(503, 'Server stopping');
    if (this.active.size >= 4) throw new ApiError(429, 'Too many file transfers. Try again shortly.');
    if (res.destroyed || req.aborted) throw new ApiError(408, 'File request cancelled');
    const controller = new AbortController();
    this.active.add(controller);
    const abort = () => controller.abort();
    res.once('close', abort); req.once('aborted', abort);
    const timeout = setTimeout(abort, 5 * 60_000); timeout.unref();
    try { return await action(controller.signal); }
    catch (error) { if (controller.signal.aborted) throw new ApiError(408, 'File transfer timed out or was cancelled'); throw error; }
    finally { clearTimeout(timeout); res.off('close', abort); req.off('aborted', abort); controller.abort(); this.active.delete(controller); }
  }
  async list(project: Project, path: string, hidden: boolean, signal: AbortSignal) {
    return this.files.list(project, path, hidden, AbortSignal.any([signal, AbortSignal.timeout(8000)]));
  }
  async ticket(project: Project, requested: string, signal: AbortSignal) {
    this.prune();
    if (this.tickets.size >= 64) throw new ApiError(429, 'Too many pending downloads. Try again shortly.');
    const path = filePath(requested);
    const stream = await this.files.open(project, path, AbortSignal.any([signal, AbortSignal.timeout(8000)]));
    stream.destroy();
    if (this.tickets.size >= 64) throw new ApiError(429, 'Too many pending downloads. Try again shortly.');
    if (this.closed || signal.aborted) throw new ApiError(408, 'File request cancelled');
    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(ticket, { projectId: project.id, path, expires: Date.now() + 30_000 });
    return { url: `/api/downloads/${ticket}`, name: posix.basename(path), expiresIn: 30 };
  }
  async download(ticket: string, req: IncomingMessage, res: ServerResponse) {
    this.prune();
    const grant = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!grant) throw new ApiError(401, 'Download link expired. Start the download again.');
    const project = this.store.project(grant.projectId);
    if (!project) throw new ApiError(404, 'Project not found');
    return this.operation(req, res, async signal => {
      const stream = await this.files.open(project, grant.path, signal);
      const name = encodeURIComponent(posix.basename(grant.path)).replace(/[!'()*]/g, value => '%' + value.charCodeAt(0).toString(16).toUpperCase());
      res.writeHead(200, { ...fileHeaders, 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${name}` });
      try { await pipeline(stream, res, { signal }); }
      catch { res.destroy(); }
    });
  }
  async preview(project: Project, path: string, res: ServerResponse, signal: AbortSignal) {
    const format = previewType(path);
    const stream = await this.files.open(project, path, signal);
    const content = await collect(stream, format.limit);
    if (format.kind === 'text' && content.includes(0)) throw new ApiError(415, 'Binary files cannot be previewed. Download it instead.');
    if (format.kind === 'pdf' && !content.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new ApiError(415, 'Invalid PDF file');
    if (signal.aborted) throw new ApiError(408, 'File request cancelled');
    res.writeHead(200, { ...fileHeaders, 'Content-Type': format.type, 'Content-Length': content.length, 'X-Jelly-Preview': format.kind });
    res.end(content);
  }
  close() { this.closed = true; this.tickets.clear(); for (const controller of this.active) controller.abort(); }
}
const fileHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Frame-Options': 'DENY' };
