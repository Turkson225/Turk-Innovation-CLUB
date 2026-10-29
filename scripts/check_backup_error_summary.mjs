#!/usr/bin/env node
// Synthetic, offline cases only. No database or member data is accessed.
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {summarizeBackupError} from './backup_error_summary.mjs';

const canary='CANARY_PRIVATE_VALUE_987';
const uri=`postgresql://postgres.fixture:${canary}@private.example.test:5432/postgres`;
const fixtures=[
  ['POOLER_TARGET', `FATAL: Tenant or user not found ${uri}`],
  ['DOCKER_IMAGE_PULL', `Error response from daemon: manifest for image not found: manifest unknown ${canary}`],
  ['DOCKER_IMAGE_PULL', `pull access denied for ${canary}; permission denied for table unrelated`],
  ['DOCKER_DAEMON', `permission denied while trying to connect to the Docker daemon socket docker.sock ${canary}`],
  ['DOCKER_DAEMON', `Cannot connect to the Docker daemon ${canary}`],
  ['DB_AUTH_REJECTED', `FATAL: password authentication failed for user "${canary}" ${uri}`],
  ['DB_AUTH_REJECTED', `SQLSTATE 28P01 ${uri}`],
  ['DB_AUTH_REJECTED', `error received from server in SCRAM exchange: Wrong password ${uri}`],
  ['DB_AUTH_REJECTED', `SCRAM authentication failed ${canary}`],
  ['DB_AUTH_REJECTED', `\x1b[31mpassword authentication failed\x1b[0m ${canary}`],
  ['TLS', `tls handshake error: x509: certificate signed by unknown authority ${uri}`],
  ['NETWORK_DNS', `lookup private.example.test: no such host ${canary}`],
  ['NETWORK_TIMEOUT', `dial tcp private.example.test:5432: i/o timeout ${canary}`],
  ['NETWORK_UNREACHABLE', `dial tcp: network is unreachable ${uri}`],
  ['NETWORK_REFUSED', `dial tcp: connection refused ${uri}`],
  ['PGDUMP_VERSION', `pg_dump: server version: 18.0; pg_dump version: 17.1 ${canary}`],
  ['DB_PERMISSION', `pg_dumpall: ERROR: permission denied for table pg_authid ${canary}`],
  ['CLI_CONFIG', `failed to parse config: ${canary}`],
  ['CLI_CONFIG', `unknown flag: --${canary}`],
  ['DISK_SPACE', `write: no space left on device ${canary}`],
  ['UNCLASSIFIED', `SCRAM exchange started; ${canary}`],
  ['UNCLASSIFIED', `Unrecognized error ${uri}\nCOPY members FROM stdin;\n${canary},Private Name,private@example.test`],
  ['UNCLASSIFIED', `\x1b]0;${canary}\x07anything unexpected`],
];
const root=await mkdtemp(join(tmpdir(),'space-backup-summary-'));
try {
  const executable=fileURLToPath(new URL('./backup_error_summary.mjs',import.meta.url));
  const log=join(root,'private.log');
  for (const [expected, text] of fixtures) {
    const result=summarizeBackupError(text);
    assert.equal(result.code, expected);
    assert.deepEqual(Object.keys(result), ['code','message']);
    assert(!JSON.stringify(result).includes(canary));
    await writeFile(log,text);
    const child=spawnSync(process.execPath,[executable,log],{encoding:'utf8',timeout:10000});
    assert.equal(child.status,0,child.stderr);
    assert.equal(child.stderr,'');
    assert.equal(child.stdout,`Safe diagnostic: ${result.code}\n${result.message}\n`);
    for (const secret of [canary,uri,'Private Name','private@example.test','COPY members',root]) assert(!child.stdout.includes(secret));
  }
  for (const args of [[join(root,'missing.log')],[]]) {
    const child=spawnSync(process.execPath,[executable,...args],{encoding:'utf8',timeout:10000});
    assert.equal(child.status,0);assert.equal(child.stderr,'');
    assert(child.stdout.includes('Safe diagnostic: LOG_UNAVAILABLE'));
    assert(!child.stdout.includes(root));assert(!child.stdout.includes('Error:'));
  }
  console.log(`${fixtures.length+2}/${fixtures.length+2} offline diagnostic checks passed; all output uses fixed text without raw log content.`);
} finally {await rm(root,{recursive:true,force:true});}
