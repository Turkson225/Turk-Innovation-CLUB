#!/usr/bin/env node
// Offline fixtures only. Does not connect to Supabase or copy member data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=await mkdtemp(join(tmpdir(),'space-storage-fixture-'));
const buckets=['club-documents','club-media','club-learning','club-course-evidence','club-founder-portraits','club-finance-receipts','club-direct-files','club-shop-images'];
const manifest={format:'innovatex-storage-backup-v1',source:'https://fixture.supabase.co',finished_at:new Date().toISOString(),total_objects:0,total_bytes:0,buckets:[]};
const rows=[];
try{
  for(const id of buckets){
    const total=id==='club-media'?2501:1,record={id,settings:{id,public:id==='club-founder-portraits'},objects:total,bytes:0};
    await mkdir(join(root,'objects',id),{recursive:true});
    for(let i=0;i<total;i++){
      const path='fixture-'+i+'.txt',bytes=Buffer.from('Synthetic backup object '+id+' '+i);
      await writeFile(join(root,'objects',id,path),bytes);
      rows.push({bucket:id,path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
      record.bytes+=bytes.length;
    }
    manifest.buckets.push(record);manifest.total_objects+=record.objects;manifest.total_bytes+=record.bytes;
  }
  await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
  await writeFile(join(root,'files.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  const verify=()=>spawnSync(process.execPath,[fileURLToPath(new URL('./verify_storage_backup.mjs',import.meta.url)),root],{encoding:'utf8',timeout:30000});
  let result=verify();assert.equal(result.status,0,result.stderr);assert(result.stdout.includes('Verified 2508 objects'));console.log('PASS Verified all 2,508 synthetic objects across eight buckets.');
  const last=rows.at(-1),file=join(root,'objects',last.bucket,last.path);
  await writeFile(file,Buffer.alloc(last.bytes,120));result=verify();assert.notEqual(result.status,0);assert(result.stderr.includes('hash mismatch'));console.log('PASS Rejected a file changed without changing its size.');
  await rm(file);result=verify();assert.notEqual(result.status,0);console.log('PASS Rejected an incomplete file backup.');
  console.log('3/3 offline backup checks passed. This does not prove a live restore.');
}finally{await rm(root,{recursive:true,force:true});}
