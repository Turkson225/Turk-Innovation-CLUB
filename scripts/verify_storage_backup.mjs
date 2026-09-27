#!/usr/bin/env node

// Offline verification of a completed backup_storage.mjs run. No network calls.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const EXPECTED_BUCKETS = new Map([
  ['club-documents', false],
  ['club-media', false],
  ['club-learning', false],
  ['club-course-evidence', false],
  ['club-founder-portraits', true],
]);
const REQUIRED_BUCKETS = [...EXPECTED_BUCKETS.keys()].filter((id) => id !== 'club-founder-portraits');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function validPath(path) {
  return typeof path === 'string' && path.length > 0 &&
    path.split('/').every((part) => part && part !== '.' && part !== '..' && !/[\\\0]/.test(part));
}

async function hashFile(file) {
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    digest.update(chunk);
    bytes += chunk.length;
    check(Number.isSafeInteger(bytes), 'Object size exceeds safe integer range');
  }
  return { bytes, sha256: digest.digest('hex') };
}

async function regularFile(file) {
  const stats = await lstat(file);
  check(stats.isFile(), `Expected a regular file, without symlinks: ${file}`);
  return stats;
}

async function objectFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    check(entry.isFile() || entry.isDirectory(), `Unexpected symlink or special object: ${path}`);
    if (entry.isDirectory()) found.push(...await objectFiles(join(dir, entry.name), path));
    else found.push(path);
  }
  return found;
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/verify_storage_backup.mjs /absolute/path/to/completed/backup');
    return;
  }
  check(process.argv.length === 3, 'Supply exactly one completed backup directory; see --help');
  const root = resolve(process.argv[2]);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  check(manifest.format === 'innovatex-storage-backup-v1', 'Unknown backup format');
  check(typeof manifest.finished_at === 'string', 'Backup did not finish');
  check(Array.isArray(manifest.buckets) &&
    manifest.buckets.length >= REQUIRED_BUCKETS.length &&
    manifest.buckets.length <= EXPECTED_BUCKETS.size,
    'Backup does not cover the four required club buckets');
  check(Number.isSafeInteger(manifest.total_objects) && manifest.total_objects >= 0 &&
    Number.isSafeInteger(manifest.total_bytes) && manifest.total_bytes >= 0,
    'Invalid manifest totals');
  const totals = new Map();
  for (const bucket of manifest.buckets) {
    check(EXPECTED_BUCKETS.has(bucket.id) && !totals.has(bucket.id), 'Unexpected or duplicate bucket');
    check(bucket.settings?.id === bucket.id && bucket.settings?.public === EXPECTED_BUCKETS.get(bucket.id),
      `Bucket privacy/settings differ for ${bucket.id}`);
    check(Number.isSafeInteger(bucket.objects) && bucket.objects >= 0 &&
      Number.isSafeInteger(bucket.bytes) && bucket.bytes >= 0,
      `Invalid totals for ${bucket.id}`);
    totals.set(bucket.id, { objects: 0, bytes: 0, expected: bucket });
  }
  check(REQUIRED_BUCKETS.every((id) => totals.has(id)), 'One or more core club buckets are missing');

  let objectCount = 0;
  let totalBytes = 0;
  const listed = new Set();
  const lines = createInterface({ input: createReadStream(join(root, 'files.jsonl')), crlfDelay: Infinity });
  for await (const line of lines) {
    check(line.length > 0, 'Empty line in files.jsonl');
    const item = JSON.parse(line);
    check(totals.has(item.bucket) && validPath(item.path), 'Invalid bucket or object path in files.jsonl');
    const key = `${item.bucket}/${item.path}`;
    check(!listed.has(key), `Duplicate object: ${key}`);
    listed.add(key);
    check(Number.isSafeInteger(item.bytes) && item.bytes >= 0 &&
      /^[0-9a-f]{64}$/.test(item.sha256), `Invalid size/hash for ${key}`);
    const file = join(root, 'objects', item.bucket, ...item.path.split('/'));
    const stats = await regularFile(file);
    check(stats.size === item.bytes, `File size mismatch: ${key}`);
    const calculated = await hashFile(file);
    check(calculated.bytes === item.bytes && calculated.sha256 === item.sha256,
      `File hash mismatch: ${key}`);
    objectCount++;
    totalBytes += item.bytes;
    const bucket = totals.get(item.bucket);
    bucket.objects++;
    bucket.bytes += item.bytes;
  }
  check(objectCount === manifest.total_objects && totalBytes === manifest.total_bytes,
    'Manifest object/byte totals differ from downloaded files');
  for (const [id, total] of totals) {
    check(total.objects === total.expected.objects && total.bytes === total.expected.bytes,
      `Manifest totals differ for ${id}`);
  }
  const objectsDir = join(root, 'objects');
  try {
    const actual = await objectFiles(objectsDir);
    check(actual.length === listed.size && actual.every((path) => listed.has(path)),
      'objects/ contains unlisted files, or listed files are missing');
  } catch (error) {
    // A backup with zero files may have no objects/ directory.
    if (!(error.code === 'ENOENT' && listed.size === 0)) throw error;
  }
  console.log(`Verified ${objectCount} objects (${totalBytes} bytes) across ${totals.size} buckets.`);
  if (!totals.has('club-founder-portraits')) {
    console.warn('Founder portrait bucket absent in this backup; verify migration state before using it as a recovery point.');
  }
  console.log(`Backup source: ${manifest.source}; completed: ${manifest.finished_at}`);
  console.log('This verifies local bytes and counts; test recovery to a separate Supabase project.');
}

main().catch((error) => { console.error(`Verification failed: ${error.message}`); process.exitCode = 1; });
