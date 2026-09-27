# Approval email worker health check

The approval email worker is separate from sign-in codes. After an administrator approves a verified, completed application, a trigger adds a job to `public.approval_email_outbox`. Supabase Cron calls `send-approval-emails` every minute, up to five jobs per call. The function requires the **named** `approval_email_worker` secret key, then sends through the Edge Function SMTP credentials. It records success or retries failures, up to eight attempts. A timeout after Gmail accepts a message can result in a duplicate; this is an at-least-once workflow.

Use the following **read-only** checks in the production project's Supabase **SQL Editor**. Do not paste Vault values, SMTP passwords or secret API keys into queries, chat, screenshots, or tickets. The SQL Editor is privileged: share only redacted results.

## 1. Verify the schedule and job execution

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'innovatex-approval-email-worker';

select r.jobid, r.status, r.start_time, r.end_time,
       left(r.return_message, 160) as return_message
from cron.job_run_details r
join cron.job j on j.jobid = r.jobid
where j.jobname = 'innovatex-approval-email-worker'
order by r.start_time desc
limit 10;
```

Expect one active job and recent runs marked `succeeded`. **Cron success only means its SQL ran:** the `net.http_post` call queues an HTTP request, so this does not prove the Edge Function or Gmail delivered mail. Supabase documents `cron.job_run_details` for job history and `pg_net` response records for HTTP troubleshooting. [Cron](https://supabase.com/docs/guides/cron) · [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)

## 2. Check the queue without listing recipient addresses

```sql
select status, count(*) as jobs,
       min(created_at) as oldest_created_at,
       max(created_at) as newest_created_at
from public.approval_email_outbox
group by status
order by status;

select id, application_type, status, attempts,
       created_at, next_attempt_at, sent_at, left(last_error, 160) as last_error
from public.approval_email_outbox
where status in ('pending', 'retry', 'processing', 'failed')
order by created_at
limit 20;
```

A fresh `pending` job should become `sent` after the next scheduled run. `retry` means the worker will try again at `next_attempt_at`. Investigate a `pending` job older than several minutes, an expired `processing` claim older than 10 minutes, or `failed` after eight attempts. Do not reset failed jobs until the cause is fixed; see the last comment of `supabase/upgrade_approval_emails.sql` for the intentionally manual retry. The queue is private and not available to ordinary browser accounts.

## 3. Verify the Edge Function

Open **Edge Functions → send-approval-emails → Invocations/Logs** and confirm recent Cron POSTs return HTTP 200 with a body like `{"claimed":1,"sent":1,"failed":0,"unrecorded":0}`. A 200 with `claimed:0` is healthy only if no email is queued. A 401/403 indicates a missing or wrong named secret key or JWT verification left enabled; a 503 indicates missing SMTP secrets; a 500 means the queue claim failed. If Cron ran but no invocation appears, inspect the **pg_net** HTTP response and Cron job configuration. Supabase notes `net._http_response` retains responses for about six hours by default, and other integrations can also write there; do not assume every row came from this worker. [Function logs](https://supabase.com/docs/guides/functions/logging) · [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)

For a recent HTTP failure, inspect **status/error only**, then correlate the timestamp with the Function invocation:

```sql
select created, status_code, timed_out, left(error_msg, 160) as error_msg
from net._http_response
where created > now() - interval '30 minutes'
  and (status_code >= 400 or timed_out or error_msg is not null)
order by created desc
limit 20;
```

This view can include failures from unrelated jobs. Avoid selecting request headers, full HTTP bodies or Vault decrypted values; these might expose credentials or private account data.

## 4. End-to-end delivery check

Create one **new test account you own** for each of the member, teacher, founder and investor roles. Verify its email, complete the application, approve it in **Applications**, then check the queue row is `sent` and the matching message arrives. Start with just one test account to rule out SMTP setup errors. Use a quiet period so the newest queue row is unambiguous; keep the test account IDs privately for the four checks. Verify the message's role, link, and club branding. An existing account promoted to teacher or founder should not receive another first-approval email. Do not approve applicants solely to test the worker.

If the queue grows while Cron says `succeeded`, check the function's Invocations tab and the named Vault key. If the function says `sent` but no message arrives, check spam and Gmail's sender account, then trace the recipient privately. `unrecorded > 0` means SMTP may have accepted the mail but the database failed to mark it sent: investigate before a manual retry because it may duplicate the email.

## Deployment checklist for a new project

- Deploy the Edge Function with legacy JWT preverification off; the function checks `approval_email_worker` itself.
- Set **Edge Functions → Secrets**: `APPROVAL_SMTP_EMAIL` and `APPROVAL_SMTP_APP_PASSWORD`.
- Create a named `approval_email_worker` secret API key. Store its value in Vault as `approval_email_worker_key`; never place it in the site.
- Enable `pg_cron` and `pg_net`, then run `supabase/schedule_approval_emails.sql` after checking its project URL.
- In a **restore rehearsal**, leave the schedule disabled and avoid sending restored approval jobs to real users. Use only fresh test accounts when validating mail delivery.
