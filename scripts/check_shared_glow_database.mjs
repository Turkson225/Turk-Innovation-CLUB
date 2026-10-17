// Real PostgreSQL RLS evaluation in an isolated engine; never touches Supabase.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {PGlite}=createRequire(import.meta.url)(process.env.SPACE_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite(),migration=fs.readFileSync(new URL('../supabase/upgrade_shared_chat_glow.sql',import.meta.url),'utf8');
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const as=(n,sql,args=[],topic='',role='authenticated')=>db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('realtime.topic',$2,true)",[n?uid(n):'',topic]);return tx.query(sql,args);});
const room=async(n,peer)=>(await as(n,'select public.club_glow_room($1) data',[uid(peer)])).rows[0].data;
const read=async(n,topic,extension='broadcast',role='authenticated')=>(await as(n,'select payload from realtime.messages where topic=$1 and extension=$2',[topic,extension],topic,role)).rows;
const insert=(n,topic,rowTopic=topic,extension='broadcast',role='authenticated')=>as(n,'insert into realtime.messages(topic,extension,payload) values($1,$2,\'TEST\')',[rowTopic,extension],topic,role);
let count=0;async function check(name,fn){await fn();count++;console.log('PASS',name);}
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema realtime;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic',true),'') $$;
 grant usage on schema auth,realtime,public to anon,authenticated;
 create table public.profiles(id uuid primary key,role text,membership_status text,private_reason text);
 alter table public.profiles enable row level security;
 create table realtime.messages(topic text,extension text,payload text);
 alter table realtime.messages enable row level security;
 grant select,insert on realtime.messages to anon,authenticated;
 -- Deliberately broad legacy policies: our restrictive guards must prevail.
 create policy legacy_read on realtime.messages for select to public using(true);
 create policy legacy_insert on realtime.messages for insert to public with check(true);`);
 for(let i=1;i<=10;i++)await db.query("insert into profiles values($1,$2,$3,'PRIVATE_JOIN_REASON')",[uid(i),i===4?'investor':i===2?'teacher':i===3?'founder':i===8?'admin':'member',i===5?'pending':i===6?'rejected':i===7?'suspended':'approved']);
 await check('The migration applies twice without changing existing data or policies',async()=>{await db.exec(migration);await db.exec(migration);assert.equal((await db.query('select count(*)::int n from profiles')).rows[0].n,10);assert.equal((await db.query("select count(*)::int n from pg_policies where policyname like 'legacy_%'")).rows[0].n,2);});
 await check('Participants get the same canonical server-minute topic and a bounded lease',async()=>{const a=await room(1,2),b=await room(2,1);assert.equal(a.topic,b.topic);assert(a.lease_ms>0&&a.lease_ms<=60000);assert.equal(a.topic,`space-glow:${uid(1)}:${uid(2)}:${a.minute}`);assert.deepEqual(Object.keys(a).sort(),['lease_ms','minute','topic']);});
 await check('All club roles can pair, while investor and unapproved peers cannot',async()=>{for(const n of [2,3,8,9])assert((await room(1,n)).topic);for(const n of [4,5,6,7,99])await assert.rejects(()=>room(1,n),/Approved club/);});
 await check('Investor, pending, rejected, suspended and missing callers cannot open rooms',async()=>{for(const n of [4,5,6,7,99])await assert.rejects(()=>room(n,1),/Approved club/);});
 await check('Self, null and malformed peer requests fail without leaking profile fields',async()=>{await assert.rejects(()=>room(1,1),/different approved/);await assert.rejects(()=>as(1,'select public.club_glow_room(null)'),/different approved/);await assert.rejects(()=>as(1,"select public.club_glow_room('wrong')"),/invalid input/);assert(!(JSON.stringify(await room(1,2))).includes('PRIVATE'));});
 await check('Anonymous users cannot open rooms and the policy helper returns only false',async()=>{assert.equal((await db.query("select has_function_privilege('anon','public.club_glow_room(uuid)','execute') yes")).rows[0].yes,false);const r=await room(1,2);assert.equal((await as(null,'select public.club_glow_topic_allowed($1) ok',[r.topic],r.topic,'anon')).rows[0].ok,false);});
 await check('Only the current canonical minute passes topic authorization',async()=>{const r=await room(1,2);for(const topic of [null,'',r.topic+':extra',r.topic.replace(':space',':other'),`space-glow:${uid(2)}:${uid(1)}:${r.minute}`,`space-glow:${uid(1)}:${uid(1)}:${r.minute}`,`space-glow:${uid(1)}:${uid(2)}:${r.minute-1}`,`space-glow:${uid(1)}:${uid(2)}:${r.minute+1}`,`space-glow:${uid(1)}:${uid(2)}:0${r.minute}`]){if(topic===r.topic)continue;assert.equal((await as(1,'select public.club_glow_topic_allowed($1) ok',[topic])).rows[0].ok,false,String(topic));}});
 await check('Both participants can send and receive broadcast in their authorized topic',async()=>{const r=await room(1,2);await insert(1,r.topic);await insert(2,r.topic);assert.equal((await read(1,r.topic)).length,2);assert.equal((await read(2,r.topic)).length,2);});
 await check('A third approved member cannot join or write even with legacy broad policies',async()=>{const r=await room(1,2);assert.equal((await read(9,r.topic)).length,0);await assert.rejects(()=>insert(9,r.topic),/row-level security/);});
 await check('Anonymous broad-policy access cannot bypass the glow namespace guards',async()=>{const r=await room(1,2);assert.equal((await read(null,r.topic,'broadcast','anon')).length,0);await assert.rejects(()=>insert(null,r.topic,r.topic,'broadcast','anon'),/row-level security/);});
 await check('Authorized topic context cannot read or write another pair’s rows',async()=>{const mine=await room(1,2),other=await room(2,3);await insert(2,other.topic);assert.equal((await as(1,'select * from realtime.messages where topic=$1',[other.topic],mine.topic)).rows.length,0);await assert.rejects(()=>insert(1,mine.topic,other.topic),/row-level security/);});
 await check('Presence extension and absent topic context cannot expose glow rows',async()=>{const r=await room(1,2);await assert.rejects(()=>insert(1,r.topic,r.topic,'presence'),/row-level security/);assert.equal((await as(1,'select * from realtime.messages where topic=$1',[r.topic])).rows.length,0);await assert.rejects(()=>insert(1,'',r.topic),/row-level security/);});
 await check('Unrelated namespaces keep their existing policies',async()=>{await insert(9,'other-chat');assert.equal((await read(9,'other-chat')).length,1);await insert(null,'legacy-room','legacy-room','broadcast','anon');assert.equal((await read(null,'legacy-room','broadcast','anon')).length,1);});
 await check('Changing access invalidates subsequent room and policy authorization',async()=>{const r=await room(1,2);await db.query("update profiles set membership_status='suspended' where id=$1",[uid(2)]);try{await assert.rejects(()=>room(1,2),/Approved club/);assert.equal((await read(1,r.topic)).length,0);await assert.rejects(()=>insert(1,r.topic),/row-level security/);}finally{await db.query("update profiles set membership_status='approved' where id=$1",[uid(2)]);}});
 await check('No drawing tables, realtime functions, profile grants or recursive policies are introduced',async()=>{assert.equal((await db.query("select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n,1);assert.equal((await db.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='realtime'")).rows[0].n,1);await assert.rejects(()=>as(1,'select private_reason from profiles'),/permission denied/);});
 console.log(`${count}/${count} shared glow database checks passed (isolated PostgreSQL engine).`);
}finally{await db.close();}
