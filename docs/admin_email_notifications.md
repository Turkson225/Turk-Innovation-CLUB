# Administrator email alerts in SPACE

Open **Administration → System health → Administrator email alerts**. Set the administrator inbox, confirm the address, choose categories and save. Select **Send test to saved inbox** and check both the delivery audit and that inbox. Saving settings and requesting a test require fresh administrator authenticator verification. Enabling email starts collecting new eligible events; older activity is not replayed.

| Category | What generates an alert |
| --- | --- |
| Important updates | Club announcements and chapter creation or operating-status changes |
| Alerts | Urgent announcements and reports submitted for moderation |
| Errors | At least three distinct accounts report upload or device notification problems in a recent 30-minute window, confirmed by two samples |
| Security | Account suspensions and audited account role, teaching access, or club/chapter office changes |
| Service status | An approval email or push queue develops, or no longer shows, overdue jobs or recent failed jobs. Two polls at least one minute apart confirm the change. Pending or locked work is considered overdue after ten minutes; failed jobs created within the last hour are counted. |

Each email has a type and severity in the subject. The body includes the event, time in UTC, affected area, suggested next action, reference, and a link to a known SPACE page. Email includes aggregate counts and fixed wording. Member identities, report content, IP addresses, filenames, provider responses and credentials stay out of email and the delivery audit. The log distinguishes SMTP acceptance from receipt in an inbox. It has 90 days of history with per-attempt outcomes; acceptance is not inbox confirmation. A provider may later suppress, bounce or filter an accepted message.

Similar events within a 15-minute UTC window share a single delivery job. The worker gives events a short grouping delay, prioritizes high severity, limits reservations to 12 per rolling hour, and expires unsent alerts after 24 hours. Temporary failures that are safe to retry get up to three retries after the first attempt, with delays of 5, 20 and 60 minutes. Uncertain dispatches are marked **Delivery unconfirmed** for review; they are not resent automatically. Changing the destination or preferences cancels work still in the queue, including reserved work that has not started sending. It never redirects a pending alert to a new inbox. An email already handed to SMTP may still arrive.

The control panel displays the last worker check-in and any sender configuration issue. The service monitor checks delivery queues and reports available in the database. It does not examine all Auth failures, inspect infrastructure logs, or independently monitor site availability. If the project or the mail worker is unreachable, this email path cannot alert about its own outage.

## Set up delivery in Supabase

1. In the existing Supabase project, open **SQL Editor → New query** and run the entire [administrator email migration](../supabase/migrations/20261120000000_admin_email_notifications.sql) after the SPACE security hardening migration. Do not replay the historical baseline on a live project. No inbox is configured or enabled by the migration.
2. Under **Project Settings → API Keys**, create a **secret** API key named `admin_notification_worker`. Add that key to **Vault** under `admin_notification_worker_key`. Also add your project’s API URL (for example `https://yourproject.supabase.co`) as `admin_notification_project_url`. Never place the key in the application, in the repository, or in SQL history. The worker only accepts this named key.
3. The worker can reuse the existing **Edge Function secrets** `APPROVAL_SMTP_EMAIL` and `APPROVAL_SMTP_APP_PASSWORD` as its Gmail sender. For a separate sender, set both `ADMIN_SMTP_EMAIL` and `ADMIN_SMTP_APP_PASSWORD` instead. These are sender credentials, separate from the administrator recipient address in SPACE. Supabase Auth SMTP settings are independent. Optionally set `ADMIN_MAIL_SITE_URL` to your verified public HTTPS URL, including the app’s path. The default is the same dedicated SPACE domain used by the approval worker.
4. In the Edge Functions editor deploy `send-admin-notification-emails` using the complete [function source](../supabase/functions/send-admin-notification-emails/index.ts). Use that exact function name. Turn off **Verify JWT with legacy secret** for this function only; the function verifies the named secret key itself. CLI alternative: `supabase functions deploy send-admin-notification-emails` from this repository after linking your project (the setting is already in [config.toml](../supabase/config.toml)).
5. Enable `pg_cron` and `pg_net` if they are not enabled. In SQL Editor, run the entire [schedule SQL](../supabase/schedule_admin_email_notifications.sql). The job `space-admin-email-worker` runs every two minutes. Running the schedule setup again replaces the schedule of the same named job.
6. Deploy the matching SPACE frontend, sign in as an administrator, then open **System health → Administrator email alerts**. Set your address, select the categories and enable email. Request one test, allow a worker cycle, and refresh the audit. Check for **Accepted by mail server** and verify the actual email and SPACE link in your inbox.

To pause notifications, clear **Enable administrator emails** and save. That cancels pending work and leaves its audit records. The registration invitation and membership approval emails are separate systems.

For local checks, run `npm run check:admin-mail`. Its SQL, UI and worker checks use synthetic records and a mocked mail transport. A live test is required to confirm sender credentials and inbox delivery.
