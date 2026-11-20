-- Run after deploying send-admin-notification-emails and adding its two Vault
-- secrets. Never paste secret API keys into this SQL file.
do $$ begin
  if to_regclass('cron.job') is null or to_regclass('vault.decrypted_secrets') is null
    or not exists(select 1 from pg_namespace where nspname='net') then
    raise exception 'Enable pg_cron and pg_net and make sure Vault is available first.';
  end if;
  if (select count(*) from vault.decrypted_secrets where name='admin_notification_project_url'
      and decrypted_secret ~ '^https://[a-z0-9]+[.]supabase[.]co/?$')<>1
    or (select count(*) from vault.decrypted_secrets where name='admin_notification_worker_key'
      and decrypted_secret like 'sb_secret_%')<>1 then
    raise exception 'Set admin_notification_project_url and admin_notification_worker_key in Vault first.';
  end if;
end $$;
select cron.schedule(
  'space-admin-email-worker','*/2 * * * *',
  $job$
    select net.http_post(
      url := rtrim(project.decrypted_secret,'/') || '/functions/v1/send-admin-notification-emails',
      headers := jsonb_build_object('Content-Type','application/json','apikey',credential.decrypted_secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 65000
    )
    from vault.decrypted_secrets project cross join vault.decrypted_secrets credential
    where project.name='admin_notification_project_url' and credential.name='admin_notification_worker_key';
  $job$
);
