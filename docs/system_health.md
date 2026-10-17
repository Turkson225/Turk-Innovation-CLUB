# SPACE system health and recovery

In an approved administrator account, open **Administration → System health** (on a phone: **More → Administration → System health**). Other roles cannot query the health RPC or read the private incident table. Apply `supabase/upgrade_guidance_system_health.sql` once, after the existing club migrations, then refresh. It is safe to rerun. Course navigation works with the existing course migrations; this new migration adds cross-device welcome progress, aggregate checks and minimal issue reports.

## What the page verifies

- Approval-email jobs: pending/retry, processing, failed, overdue by ten minutes, accepted sends in the past 24 hours and last recorded send.
- Push jobs: registered subscriptions, pending/retry, overdue and failed jobs created in the past 24 hours, plus last recorded send.
- Schema presence for course and private-application tools, bucket presence and expected public/private visibility.
- Matching active Supabase Cron jobs, if `cron.job` is available. External schedulers and custom job names are not detected.
- Unreviewed upload and notification-setup problem reports from this website version onward. A report contains an authenticated account ID, one of two fixed categories, an allowlisted error category and timestamps. The administrator RPC exposes counts and timestamps only. It never returns filenames, chat text, emails, push endpoints, signature paths, SMTP/VAPID credentials or raw provider errors.

The incident table keeps at most two rows per account, suppresses repeated reports within one minute and removes those rows if the associated account is deleted. It is a latest-problem registry, not an upload audit log. Existing failures before this version and failures never reported by a client cannot be reconstructed. Permission denial by the browser's user is not reported as a platform failure. A member can generate a report about a genuine attempt or deliberately submit one; reports are triage signals rather than proof of an outage.

**Mark these reports reviewed** means an administrator has reviewed that snapshot. It does not repair the cause. Reports received after the snapshot remain unreviewed. A later fresh report about the same category reopens it.

## Approval emails

1. Inspect the counts and the last send time. Pending work is normal briefly; overdue or failed jobs need investigation.
2. In Supabase, open **Edge Functions → send-approval-emails → Logs**. Check the deployed function, its named API key, Vault entry and private Edge Function SMTP secrets. The Auth SMTP configuration is separate from the approval worker.
3. Check **Integrations → Cron → Jobs** for the active `innovatex-approval-email-worker` job. A job's presence alone does not prove a successful HTTP call.
4. Fix the recorded cause first. Retry-state jobs are retried automatically by the configured worker. For failed jobs, inspect their private `last_error` in the Supabase SQL Editor and use the existing worker's documented retry process; do not bulk reset delivery jobs from a browser.
5. Verify a new, consenting test account's email, submit its application and approve it. Check the worker result and actual inbox, including spam. Avoid sending a test to real applicants or replaying all historical approvals. Delivery is at least once: an interrupted worker can cause a duplicate if the provider accepted a message before the database was updated.

A worker's `sent` status records SMTP provider acceptance. It cannot prove that the recipient read or even received the inbox message. Signup verification and password-reset emails are Supabase Auth deliveries and are not represented by the approval outbox.

## Device notifications

1. Open **Notifications** in the main account tab. Check device support, installation requirements, permission and registration.
2. Review the deployed push function, public VAPID key, private keys and worker logs in Supabase. Check its schedule.
3. Use consenting test accounts to create a new notification. Verify the in-app inbox, device registration, worker status and lock-screen display separately.
4. Browser permission denial, an unsupported browser and a device's sleep/focus settings can prevent display without indicating a server outage. Separate-account preview tabs deliberately do not take ownership of the main account's push subscription.

## Upload problems

1. Identify the failing feature with the affected member; do not request their password, API secrets or private chat/document contents.
2. Check the bucket's presence, visibility, accepted file types and size limits. Most club buckets must be private; `club-founder-portraits` is intentionally public.
3. Confirm enrollment/teaching access for course files. Use the existing documented policy migrations rather than disabling row-level security.
4. Retry a small supported file in the affected feature, then verify its authorized download and deny access from another account. Mark the report reviewed after investigating.

The health page does not test Auth SMTP credentials, deployed Edge Function code, secret values, actual lock-screen display, file downloads, database restoration or Storage restoration. Staging and backup setup remain separate work. The page sends no test emails or notifications automatically and does not retry delivery jobs or change Storage policies.
