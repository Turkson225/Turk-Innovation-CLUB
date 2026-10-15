// Real isolated PostgreSQL engine; synthetic fixture only; no live requests.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {prepareFixture,uuid} from './load_test_fixture.mjs';
const {PGlite}=createRequire(import.meta.url)(process.env.SPACE_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite(),client={query:async(sql,args)=>{
 // PGlite supplies core gen_random_uuid, but not the native pgcrypto extension.
 sql=sql.replace('create extension if not exists pgcrypto;','');
 const r=args?await db.query(sql,args):(await db.exec(sql)).at(-1);return {...r,rowCount:r.rows?.length||0};
}};
const as=(n,sql,args=[])=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uuid(n)]);return tx.query(sql,args);});
const directory=async(n,args={})=>{
 const entries=Object.entries(args),names=entries.map(([key],i)=>`${key}=>$${i+1}`).join(',');
 return (await as(n,`select public.space_member_directory(${names}) data`,entries.map(([,v])=>v))).rows[0].data;
};
let count=0;const check=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
try{
 await prepareFixture(client);
 await check('Performance migration reruns without losing member or learning records',async()=>{
  await client.query(fs.readFileSync(new URL('../supabase/upgrade_directory_learning_performance.sql',import.meta.url),'utf8'));
  assert.equal((await db.query('select count(*)::int n from profiles')).rows[0].n,2000);
 });
 await check('The directory returns 24 profiles and counts the complete visible community',async()=>{
  const value=await directory(10);assert.equal(value.rows.length,24);assert.equal(value.total,1801);assert.equal(value.stats.all,1801);
  assert(!value.rows.some(p=>p.id===uuid(20)));assert(!JSON.stringify(value).includes('Synthetic application answer'));
 });
 await check('Pages have a stable unique order and an out-of-range page clamps safely',async()=>{
  const first=await directory(10,{p_sort:'name'}),second=await directory(10,{p_sort:'name',p_offset:24});
  assert.equal(new Set([...first.rows,...second.rows].map(p=>p.id)).size,48);
  assert.deepEqual((await directory(10,{p_sort:'name'})).rows.map(p=>p.id),first.rows.map(p=>p.id));
  const last=await directory(10,{p_offset:999999});assert(last.rows.length>0);assert.equal(last.offset,1800);
 });
 await check('Search, roles and saved filters apply beyond the first page',async()=>{
  const result=await directory(10,{p_search:'Synthetic member 1999'});assert.equal(result.total,1);assert.equal(result.rows[0].id,uuid(1999));
  const teachers=await directory(10,{p_role:'leads'});assert.equal(teachers.total,8);assert(teachers.rows.every(p=>p.role==='teacher'));
  const saved=await directory(10,{p_group:'saved',p_saved:[uuid(1999),uuid(20)]});assert.equal(saved.total,1);assert.equal(saved.stats.saved,1);
 });
 await check('A private profile cannot leak through search, facets, saved counts or teacher access',async()=>{
  await db.query("update profiles set skills='PRIVATE_FACET_MARKER',full_name='PRIVATE_NAME_MARKER' where id=$1",[uuid(20)]);
  for(const n of [10,2]){const result=await directory(n,{p_search:'PRIVATE_NAME_MARKER'});assert.equal(result.total,0);assert(!JSON.stringify(result).includes('PRIVATE_FACET_MARKER'));}
  const owner=await directory(20,{p_search:'PRIVATE_NAME_MARKER'});assert.equal(owner.total,1);assert.equal(owner.rows[0].id,uuid(20));
  const admin=await directory(1,{p_search:'PRIVATE_NAME_MARKER'});assert.equal(admin.total,1);assert.equal(admin.stats.all,2000);
 });
 await check('Editing profile interests refreshes derived search and accent-insensitive matches',async()=>{
  await as(11,"update profiles set full_name='Amélie Prototype',skills='Robotics, robotics, Python' where id=auth.uid()");
  const result=await directory(10,{p_search:'amelie python',p_skill:'ROBOTICS'});assert.equal(result.total,1);assert.equal(result.rows[0].id,uuid(11));
  assert.equal((await db.query('select cardinality(directory_interest_keys) n from profiles where id=$1',[uuid(11)])).rows[0].n,2);
 });
 await check('Online and availability filters use current profile state',async()=>{
  await db.query("update profiles set last_seen_at=now(),availability='busy' where id=$1",[uuid(11)]);
  assert.equal((await directory(10,{p_presence:'online'})).total,1);
  assert.equal((await directory(10,{p_presence:'busy'})).total,1);
 });
 await check('Invalid filters and excessive page sizes are rejected',async()=>{
  for(const args of [{p_limit:500},{p_offset:-1},{p_role:'investor'},{p_sort:'unsafe'},{p_search:'x'.repeat(121)}])await assert.rejects(()=>directory(10,args),/Invalid directory/);
 });
 await check('Student submission filters preserve only their own private attempts',async()=>{
  const result=await as(10,'select * from classroom_assignment_submissions where learner_id=auth.uid()');assert.equal(result.rows.length,4);assert(result.rows.every(s=>s.learner_id===uuid(10)));
  assert.equal((await as(10,'select * from classroom_assignment_submissions where learner_id=$1',[uuid(11)])).rows.length,0);
 });
 await check('The assigned teacher retains classroom review access',async()=>{
  const rows=(await as(2,'select * from classroom_assignment_submissions limit 500')).rows;assert(rows.length>0);
 });
 await check('Pending applicants and investors cannot call the member directory',async()=>{
  await db.exec('set session_replication_role=replica');await db.query("update profiles set membership_status='pending' where id=$1",[uuid(1998)]);await db.query("update profiles set role='investor',application_type='investor' where id=$1",[uuid(1997)]);await db.exec('set session_replication_role=origin');
  for(const n of [1998,1997])await assert.rejects(()=>directory(n),/Approved member access/);
 });
 await check('Anonymous access remains denied and member application answers remain private',async()=>{
  await assert.rejects(()=>db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select public.space_member_directory()');}),/permission denied/);
  assert.equal((await as(10,'select * from application_answers')).rows.length,1);
 });
 console.log(`${count}/${count} directory and learning database checks passed`);
}finally{await db.close();}
