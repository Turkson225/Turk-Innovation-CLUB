-- Run in SQL Editor only after deploying send-approval-emails, enabling
-- pg_cron/pg_net, and adding a Vault secret named approval_email_worker_key.
-- Its value must be the secret API key named approval_email_worker in
-- Project Settings > API Keys. Never paste that value into this file.
-- Running this again updates the same named Cron job.

select cron.schedule(
  'innovatex-approval-email-worker',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://xsbpxjiuiqpfrvhqmlsa.supabase.co/functions/v1/send-approval-emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets
                   where name = 'approval_email_worker_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    ) as request_id;
  $$
);
