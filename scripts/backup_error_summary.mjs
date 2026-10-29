#!/usr/bin/env node
// Output fixed diagnostic text only. Never print any part of a tool log.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const RULES = [
  ['POOLER_TARGET', /tenant or user not found/i, 'The pooler could not identify the project or database user. Recopy the Session pooler URI from Connect.'],
  ['DOCKER_IMAGE_PULL', /pull access denied|manifest unknown|no matching manifest|failed to pull (?:image|docker)|error pulling image|denied: requested access to the resource is denied/i, 'The database container image could not be downloaded. Check Docker image access and the registry connection.'],
  ['DOCKER_DAEMON', /cannot connect to the docker daemon|is the docker daemon running|permission denied[^\r\n]{0,180}(?:docker daemon|docker\.sock)|docker\.sock[^\r\n]{0,180}permission denied/i, 'The database export could not access Docker. Check that its daemon is running and accessible.'],
  ['DB_AUTH_REJECTED', /password authentication failed|\b28P01\b|wrong password|scram[^\r\n]{0,80}\b(?:authentication|auth)\s+failed/i, 'The database login was rejected. Check the database password and allow time for a recent reset to take effect.'],
  ['TLS', /certificate verif(?:y|ication) failed|\bx509:|server does not support ssl|ssl connection error|tls handshake|certificate is not trusted|root certificate file/i, 'The secure database connection failed. Check the TLS settings and any required certificates.'],
  ['NETWORK_DNS', /no such host|\bgetaddrinfo\b|temporary failure in name resolution|could not translate host name|dns[^\r\n]{0,80}server misbehaving/i, 'The database or registry hostname could not be resolved. Check the copied host and DNS connectivity.'],
  ['NETWORK_TIMEOUT', /i\/o timeout|connection timed out|context deadline exceeded|timeout expired|dial tcp[^\r\n]{0,180}timeout/i, 'The database or registry connection timed out. Check network access and retry when connectivity is stable.'],
  ['NETWORK_UNREACHABLE', /network is unreachable|no route to host/i, 'The network route to the database or registry is unavailable. Check connectivity and the selected connection endpoint.'],
  ['NETWORK_REFUSED', /connection refused/i, 'A database or registry connection was refused. Check endpoint availability and network restrictions.'],
  ['PGDUMP_VERSION', /server version mismatch|unsupported server version|server version:[^\r\n]+[\s\S]{0,300}pg_dump(?:all)? version:/i, 'The PostgreSQL export client is incompatible with the server version. Review the CLI and its database image version.'],
  ['DB_PERMISSION', /permission denied for (?:schema|table|relation|database|sequence)|must be (?:a )?superuser|must be owner of|\b42501\b/i, 'The database user lacks permission for the export. Review the database role and the failing export operation.'],
  ['CLI_CONFIG', /failed to parse config|invalid configuration|config\.toml[^\r\n]{0,100}(?:not found|no such file)|unknown flag|unknown command|cannot find project ref|project is not linked|could not find supabase/i, 'The CLI configuration or command was rejected. Check the CLI setup and supported options.'],
  ['DISK_SPACE', /no space left on device|disk quota exceeded/i, 'The backup workspace has insufficient disk space or quota. Check available storage before retrying.'],
];

export function summarizeBackupError(log) {
  const clean = String(log).replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  for (const [code, pattern, message] of RULES) if (pattern.test(clean)) return {code, message};
  return {code:'UNCLASSIFIED', message:'The failure could not be classified. Its cause is still unknown; raw tool output remains private.'};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let result;
  try {
    if (process.argv.length !== 3) throw new Error();
    result = summarizeBackupError(await readFile(process.argv[2], 'utf8'));
  } catch {
    result = {code:'LOG_UNAVAILABLE', message:'The private diagnostic log could not be read. No raw output was displayed.'};
  }
  process.stdout.write(`Safe diagnostic: ${result.code}\n${result.message}\n`);
}
