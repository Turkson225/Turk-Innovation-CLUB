#!/usr/bin/env node
// Offline fixtures only. Does not connect to Supabase or copy member data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=await mkdtemp(join(tmpdir(),'space-storage-fixture-'));
const buckets=['club-documents','club-media','club-learning','club-course-evidence','club-founder-portraits','club-finance-receipts','club-direct-files','club-shop-images','club-teacher-signatures'];
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
  let result=verify();assert.equal(result.status,0,result.stderr);assert(result.stdout.includes('Verified 2509 objects'));console.log('PASS Verified all 2,509 synthetic objects across nine buckets, including teacher signatures.');
  const last=rows.at(-1),file=join(root,'objects',last.bucket,last.path);
  assert.equal(last.bucket,'club-teacher-signatures');
  manifest.buckets.at(-1).settings.public=true;
  await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
  result=verify();assert.notEqual(result.status,0);assert(result.stderr.includes('Bucket privacy/settings differ for club-teacher-signatures'));console.log('PASS Rejected teacher signatures incorrectly marked public.');
  manifest.buckets.at(-1).settings.public=false;
  await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
  await writeFile(file,Buffer.alloc(last.bytes,120));result=verify();assert.notEqual(result.status,0);assert(result.stderr.includes('hash mismatch'));console.log('PASS Rejected a teacher signature changed without changing its size.');
  await rm(file);result=verify();assert.notEqual(result.status,0);console.log('PASS Rejected an incomplete file backup.');
  const signatureBucket=manifest.buckets.pop();
  manifest.total_objects-=signatureBucket.objects;manifest.total_bytes-=signatureBucket.bytes;
  rows.pop();await rm(join(root,'objects','club-teacher-signatures'),{recursive:true});
  await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
  await writeFile(join(root,'files.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  result=verify();assert.equal(result.status,0,result.stderr);assert(result.stdout.includes('Verified 2508 objects'));assert(result.stderr.includes('Teacher signature bucket absent'));console.log('PASS Accepted an older eight-bucket backup with an explicit signature warning.');

  // Mock the Storage API in a child process: exercise the real downloader without network access.
  const downloader=fileURLToPath(new URL('./backup_storage.mjs',import.meta.url));
  const mockDownload=(target,unknown=false)=>spawnSync(process.execPath,['--input-type=module','-e',`
    process.argv=[process.execPath,${JSON.stringify(downloader)}];
    const buckets=${JSON.stringify(buckets.concat(unknown?['club-unrecognized']:[]))};
    globalThis.fetch=async(input,options={})=>{
      const url=new URL(input),path=url.pathname;
      if(url.origin!=='https://fixture.supabase.co')throw Error('Unexpected test origin');
      if(path==='/storage/v1/bucket')return Response.json(buckets.map(id=>({id})));
      if(path.startsWith('/storage/v1/bucket/')){
        const id=path.split('/').at(-1);return Response.json({id,public:id==='club-founder-portraits'});
      }
      if(path==='/storage/v1/object/list/club-teacher-signatures'){
        const body=JSON.parse(options.body);
        return Response.json(body.prefix===''?[{name:'teacher',id:null}]:[{name:'signature.png',id:'signature-fixture',metadata:{size:9}}]);
      }
      if(path.startsWith('/storage/v1/object/list/'))return Response.json([]);
      if(path==='/storage/v1/object/authenticated/club-teacher-signatures/teacher/signature.png')return new Response('signature', {headers:{'content-type':'image/png','content-length':'9'}});
      throw Error('Unexpected test request: '+path);
    };
    await import(${JSON.stringify(new URL('./backup_storage.mjs',import.meta.url).href)});
  `],{encoding:'utf8',timeout:30000,env:{...process.env,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture',BACKUP_DIR:target}});
  const downloaded=join(root,'downloaded');
  result=mockDownload(downloaded);assert.equal(result.status,0,result.stderr);
  const downloadedManifest=JSON.parse(await readFile(join(downloaded,'manifest.json'),'utf8'));
  assert.equal(downloadedManifest.buckets.length,9);assert.equal(downloadedManifest.total_objects,1);
  assert.equal(await readFile(join(downloaded,'objects','club-teacher-signatures','teacher','signature.png'),'utf8'),'signature');
  const downloadedVerification=spawnSync(process.execPath,[fileURLToPath(new URL('./verify_storage_backup.mjs',import.meta.url)),downloaded],{encoding:'utf8',timeout:30000});
  assert.equal(downloadedVerification.status,0,downloadedVerification.stderr);console.log('PASS Downloaded and verified a private teacher signature at its original nested path through a mocked Storage API.');
  result=mockDownload(join(root,'unknown-bucket'),true);assert.notEqual(result.status,0);assert(result.stderr.includes('New club bucket(s) missing from backup: club-unrecognized'));console.log('PASS Refused an unknown club bucket instead of silently omitting it.');
  console.log('7/7 offline backup checks passed. This does not prove a live restore.');
}finally{await rm(root,{recursive:true,force:true});}
