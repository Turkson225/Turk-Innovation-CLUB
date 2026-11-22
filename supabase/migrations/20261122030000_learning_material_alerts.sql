-- Run after the track learning materials migration. Enable pg_cron in the
-- Supabase project first to install the minute-by-minute delivery schedule.
begin;

create schema if not exists space_private;
revoke all on schema space_private from public,anon,authenticated;

create table if not exists space_private.learning_material_alert_jobs (
  material_id uuid primary key references public.learning_materials(id) on delete cascade,
  after_user uuid,
  next_batch_at timestamptz not null default now(),
  last_error text
);
revoke all on space_private.learning_material_alert_jobs from public,anon,authenticated;
create index if not exists learning_material_alert_jobs_due
  on space_private.learning_material_alert_jobs(next_batch_at,material_id);
create unique index if not exists notifications_learning_material_once
  on public.notifications(user_id,target_id) where target_type='learning_material';

-- General library uploads have no specific course audience, so do not send
-- them to the whole club. Existing materials and restores are not queued.
create or replace function space_private.enqueue_learning_material_alert()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.hidden_at is null and (new.learning_track is not null or new.course_id is not null) then
    insert into space_private.learning_material_alert_jobs(material_id)
      values (new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function space_private.enqueue_learning_material_alert() from public,anon,authenticated;
drop trigger if exists enqueue_learning_material_alert on public.learning_materials;
create trigger enqueue_learning_material_alert after insert on public.learning_materials
  for each row execute function space_private.enqueue_learning_material_alert();

-- A publish creates only one job. A private worker writes notifications in
-- bounded batches and can resume without sending a duplicate.
create or replace function space_private.deliver_learning_material_alerts()
returns integer language plpgsql security definer set search_path='' as $$
declare
  job space_private.learning_material_alert_jobs%rowtype;
  material public.learning_materials%rowtype;
  v_after uuid;
  v_count integer;
  v_sent integer;
  v_total integer:=0;
begin
  for job in
    select j.* from space_private.learning_material_alert_jobs j
    where j.next_batch_at<=now()
    order by j.next_batch_at,j.material_id limit 10 for update skip locked
  loop
    begin
      select m.* into material from public.learning_materials m
        where m.id=job.material_id and m.hidden_at is null for share;
      if not found then
        delete from space_private.learning_material_alert_jobs where material_id=job.material_id;
        continue;
      end if;
      with eligible as (
        select e.learner_id as user_id from public.course_enrollments e
          where material.course_id is not null and e.course_id=material.course_id
        union
        select l.user_id from public.member_learning_paths l
          where material.learning_track is not null and material.learning_track=any(l.tracks)
        union
        select e.learner_id from public.course_enrollments e
          join public.courses c on c.id=e.course_id
          where material.learning_track is not null
            and public.learning_track_name(c.category)=material.learning_track
      ), recipients as materialized (
        select p.id from eligible e join public.profiles p on p.id=e.user_id
          join auth.users u on u.id=p.id
          where p.membership_status='approved' and p.role in ('member','teacher','founder','admin')
            and u.email_confirmed_at is not null and p.id<>material.uploaded_by
            and (job.after_user is null or p.id>job.after_user)
          order by p.id limit 250
      ), sent as (
        insert into public.notifications(user_id,kind,title,target_type,target_id)
          select r.id,'learning_material','New learning material: '||material.title,'learning_material',material.id
          from recipients r
          on conflict (user_id,target_id) where target_type='learning_material' do nothing
          returning 1
      )
      select (select id from recipients order by id desc limit 1),
        (select count(*) from recipients),(select count(*) from sent)
      into v_after,v_count,v_sent;

      if v_count<250 then
        delete from space_private.learning_material_alert_jobs where material_id=job.material_id;
      else
        update space_private.learning_material_alert_jobs
          set after_user=v_after,next_batch_at=now()+interval '30 seconds',last_error=null
          where material_id=job.material_id;
      end if;
      v_total:=v_total+v_sent;
    exception when others then
      update space_private.learning_material_alert_jobs
        set next_batch_at=now()+interval '5 minutes',last_error=sqlstate
        where material_id=job.material_id;
    end;
  end loop;
  return v_total;
end;
$$;
revoke all on function space_private.deliver_learning_material_alerts() from public,anon,authenticated;

do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('space-learning-material-alerts','* * * * *',
      'select space_private.deliver_learning_material_alerts();');
  else
    raise notice 'Enable pg_cron then rerun this migration to start learning material alert delivery.';
  end if;
end;
$$;

commit;
