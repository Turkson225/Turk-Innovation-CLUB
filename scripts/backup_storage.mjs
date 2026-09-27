#!/usr/bin/env node

// Read-only backup of the club's Supabase Storage buckets. Requires Node.js 20+.
// This script deliberately does not upload, delete, or modify remote objects.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { appendFile, mkdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BUCKETS = [
  'club-documents', 'club-media', 'club-learning', 'club-course-evidence',
  'club-founder-portraits',
];
const REQUIRED_BUCKETS = BUCKETS.filter((bucket) => bucket !== 'club-founder-portraits');
const PAGE_SIZE = 100;
const MAX_ATTEMPTS = 4;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  console.log(`Usage: SUPABASE_URL=https://<project>.supabase.co \\
  SUPABASE_SECRET_KEY=sb_secret_... \\
  BACKUP_DIR=/absolute/path/outside/the/repository/run-YYYY-MM-DD \\
  node scripts/backup_storage.mjs

Downloads the four core buckets and the founder portrait bucket, if installed,
into a NEW directory. It writes objects/,
files.jsonl (path, metadata, SHA-256), and manifest.json (bucket settings and counts).
No files are changed on the server. Do not commit the resulting backup.`);
}

function validSegment(value) {
  return typeof value === 'string' && value.length > 0 && value !== '.' &&
    value !== '..' && !/[\\/\0]/.test(value);
}

function safeObjectPath(prefix, name) {
  if (!validSegment(name) || (prefix && !prefix.split('/').every(validSegment))) {
    throw new Error(`Invalid Storage object name in ${prefix || 'root'}; backup stopped`);
  }
  return prefix ? `${prefix}/${name}` : name;
}

function objectUrl(base, bucket, objectPath) {
  const encoded = [bucket, ...objectPath.split('/')].map(encodeURIComponent).join('/');
  return `${base}/storage/v1/object/authenticated/${encoded}`;
}

function wait(ms) { return new Promise((resolveWait) => setTimeout(resolveWait, ms)); }

async function request(url, key, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        redirect: 'error',
        headers: {
          apikey: key,
          // sb_secret_ keys are opaque API keys, not JWTs. Supabase accepts
          // these in apikey; never send one as Authorization: Bearer.
          Accept: 'application/json, application/octet-stream',
          'Accept-Encoding': 'identity',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(120_000),
      });
      if (response.ok) return response;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === MAX_ATTEMPTS) {
        throw new Error(`Storage returned HTTP ${response.status} for ${new URL(url).pathname}`);
      }
      await response.body?.cancel();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (error.message.startsWith('Storage returned HTTP')) throw error;
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
    }
    await wait(250 * 2 ** (attempt - 1));
  }
  throw new Error(`Storage request failed after ${MAX_ATTEMPTS} attempts: ${lastError.message}`);
}

async function jsonRequest(url, key, options = {}) {
  const response = await request(url, key, options);
  return response.json();
}

async function checkBuckets(base, key) {
  const discovered = new Set();
  for (let offset = 0; ; ) {
    const url = new URL(`${base}/storage/v1/bucket`);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('sortColumn', 'id');
    url.searchParams.set('sortOrder', 'asc');
    const page = await jsonRequest(url.href, key);
    if (!Array.isArray(page)) throw new Error('Invalid Storage bucket listing');
    for (const bucket of page) {
      if (typeof bucket.id !== 'string' || discovered.has(bucket.id)) {
        throw new Error('Invalid or duplicated Storage bucket listing');
      }
      discovered.add(bucket.id);
    }
    offset += page.length;
    if (page.length < PAGE_SIZE) break;
  }
  const unknown = [...discovered].filter((id) => id.startsWith('club-') && !BUCKETS.includes(id));
  if (unknown.length) {
    throw new Error(`New club bucket(s) missing from backup: ${unknown.join(', ')}. Update BUCKETS before running again.`);
  }
  const missing = REQUIRED_BUCKETS.filter((id) => !discovered.has(id));
  if (missing.length) throw new Error(`Required club bucket(s) not found: ${missing.join(', ')}. Apply the club migrations first.`);
  if (!discovered.has('club-founder-portraits')) {
    console.warn('Founder portrait bucket not installed; apply upgrade_founder_portraits.sql before publishing portraits.');
  }
  return BUCKETS.filter((id) => discovered.has(id));
}

async function download(base, key, bucket, path, target, expectedSize) {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const temp = `${target}.partial`;
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      const response = await request(objectUrl(base, bucket, path), key);
      if (!response.body && response.headers.get('content-length') !== '0' && expectedSize !== 0) {
        throw new Error('Download response has no body');
      }
      await pipeline(
        response.body ? Readable.fromWeb(response.body) : Readable.from([]),
        new Transform({ transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          hash.update(chunk);
          callback(null, chunk);
        } }),
        createWriteStream(temp, { flags: 'wx', mode: 0o600 }),
      );
      const length = response.headers.get('content-length');
      if (length !== null && Number(length) !== bytes) {
        throw new Error(`Content-Length differs for ${bucket}/${path}`);
      }
      if (expectedSize !== null && expectedSize !== bytes) {
        throw new Error(`Listed size differs for ${bucket}/${path}; source changed during backup`);
      }
      // The destination is new, and each object is recorded only once.
      await rename(temp, target);
      return {
        bytes,
        sha256: hash.digest('hex'),
        response_headers: Object.fromEntries(
          ['content-type', 'cache-control', 'content-disposition', 'content-encoding', 'etag', 'last-modified']
            .filter((header) => response.headers.has(header))
            .map((header) => [header, response.headers.get(header)]),
        ),
      };
    } catch (error) {
      await rm(temp, { force: true });
      lastError = error;
      if (/Listed size differs|Content-Length differs/.test(error.message)) break;
      if (attempt < MAX_ATTEMPTS) await wait(250 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

async function main() {
  if (process.argv.includes('--help')) { usage(); return; }
  if (process.argv.length !== 2) throw new Error('No positional arguments are supported; use --help');
  const { SUPABASE_URL, SUPABASE_SECRET_KEY, BACKUP_DIR } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY?.startsWith('sb_secret_') || !BACKUP_DIR) {
    throw new Error('Set SUPABASE_URL, SUPABASE_SECRET_KEY (sb_secret_...), and BACKUP_DIR; see --help');
  }
  const project = new URL(SUPABASE_URL);
  if (project.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(project.hostname) ||
    project.pathname !== '/' || project.search || project.hash || project.username || project.password) {
    throw new Error('SUPABASE_URL must be an https://<project>.supabase.co origin');
  }
  if (!isAbsolute(BACKUP_DIR)) throw new Error('BACKUP_DIR must be an absolute path');
  const out = resolve(BACKUP_DIR);
  const parent = await realpath(dirname(out));
  const actualOut = join(parent, basename(out));
  const insideRepo = relative(REPO_ROOT, actualOut);
  if (!insideRepo || (!insideRepo.startsWith(`..${sep}`) && insideRepo !== '..' && !isAbsolute(insideRepo))) {
    throw new Error('BACKUP_DIR must be outside this repository');
  }
  try { await stat(actualOut); throw new Error('BACKUP_DIR already exists; choose a new directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const base = project.origin;
  const presentBuckets = await checkBuckets(base, SUPABASE_SECRET_KEY);
  await mkdir(actualOut, { mode: 0o700 });
  await writeFile(join(actualOut, 'files.jsonl'), '', { flag: 'wx', mode: 0o600 });

  const manifest = {
    format: 'innovatex-storage-backup-v1',
    source: base,
    started_at: new Date().toISOString(),
    buckets: [],
    total_objects: 0,
    total_bytes: 0,
  };
  const seen = new Set();
  try {
    for (const bucket of presentBuckets) {
      console.log(`Backing up ${bucket}...`);
      const settings = await jsonRequest(`${base}/storage/v1/bucket/${encodeURIComponent(bucket)}`, SUPABASE_SECRET_KEY);
      if (settings?.id !== bucket) throw new Error(`Unexpected bucket settings for ${bucket}`);
      const result = { id: bucket, settings, objects: 0, bytes: 0 };
      manifest.buckets.push(result);
      const folders = [''];
      for (let index = 0; index < folders.length; index++) {
        const prefix = folders[index];
        for (let offset = 0; ; ) {
          const entries = await jsonRequest(
            `${base}/storage/v1/object/list/${encodeURIComponent(bucket)}`,
            SUPABASE_SECRET_KEY,
            { method: 'POST', body: JSON.stringify({ prefix, limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } }) },
          );
          if (!Array.isArray(entries)) throw new Error(`Invalid listing response for ${bucket}/${prefix}`);
          for (const item of entries) {
            const path = safeObjectPath(prefix, item.name);
            if (item.id === null) { folders.push(path); continue; }
            if (typeof item.id !== 'string' || seen.has(`${bucket}/${path}`)) {
              throw new Error(`Invalid or duplicated Storage object: ${bucket}/${path}`);
            }
            seen.add(`${bucket}/${path}`);
            const size = item.metadata?.size;
            const expectedSize = size === undefined || size === null ? null : Number(size);
            if (expectedSize !== null && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) {
              throw new Error(`Invalid object size for ${bucket}/${path}`);
            }
            const file = await download(base, SUPABASE_SECRET_KEY, bucket, path,
              join(actualOut, 'objects', bucket, ...path.split('/')), expectedSize);
            await appendFile(join(actualOut, 'files.jsonl'),
              `${JSON.stringify({ bucket, path, listed: item, ...file })}\n`, { mode: 0o600 });
            result.objects++;
            result.bytes += file.bytes;
            manifest.total_objects++;
            manifest.total_bytes += file.bytes;
          }
          offset += entries.length;
          if (entries.length < PAGE_SIZE) break;
        }
      }
      console.log(`${bucket}: ${result.objects} objects, ${result.bytes} bytes`);
    }
    manifest.finished_at = new Date().toISOString();
    await writeFile(join(actualOut, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 });
    console.log(`Complete: ${manifest.total_objects} objects in ${actualOut}`);
  } catch (error) {
    console.error(`Incomplete backup in ${actualOut}; do not treat it as a restore point.`);
    throw error;
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
