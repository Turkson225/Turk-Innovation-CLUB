-- Run in Supabase SQL Editor after deploying send-push-notifications, enabling
-- pg_cron and pg_net, and saving the named secret API key in Vault with the
-- exact name push_notification_worker_key. The key itself stays out of Git.
-- Safe to rerun: the same named Cron job is updated.

select cron.schedule(
  'innovatex-push-notification-worker',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://xsbpxjiuiqpfrvhqmlsa.supabase.co/functions/v1/send-push-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets
                   where name = 'push_notification_worker_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) as request_id;
  $$
);
