# SPACE Web Push setup

Web Push sends opt-in alerts to a supported browser or installed club app while
it is closed. It reuses recipient-scoped rows in `public.notifications` for
direct messages, mentions, replies, course updates, official announcements
and administrator alerts. A new announcement also creates an inbox notification
for every approved club member, teacher, founder and administrator; old
announcements are not replayed. Removing an announcement removes its inbox
notifications and any unsent jobs.
It follows the existing member notification access rules: approved members,
teachers, founders and administrators can opt in; the separate investor portal
does not currently have a member notification inbox.
The lock screen payload contains a generic alert and destination only: never
message bodies, sender names, application details, profile data or Supabase
credentials. The service worker supplies its own generic display text.
Publishing the GitHub Pages files alone does not activate remote push: the
database migration, Edge Function secrets, function deployment and Cron job
below must all be completed in your Supabase project.

## 1. Database migration

In Supabase **SQL Editor**, run the entire
[`upgrade_web_push.sql`](upgrade_web_push.sql) file once, after
`upgrade_membership_collaboration.sql` and `upgrade_direct_messages.sql`.
It creates owner-only subscriptions and a private delivery outbox. It does
not send old notifications. An opted-in subscription remains active even when
the member has not visited for more than 30 days. The app refreshes its
endpoint and encryption keys when the member signs in again.

## 2. VAPID key pair

Generate one key pair on your own computer. With Node.js installed, run:

```sh
node -e "const e=require('node:crypto').createECDH('prime256v1');e.generateKeys();const d=e.getPrivateKey();console.log('PUSH_VAPID_PUBLIC_KEY='+e.getPublicKey().toString('base64url'));console.log('PUSH_VAPID_PRIVATE_KEY='+Buffer.concat([Buffer.alloc(32-d.length),d]).toString('base64url'))"
```

Copy each value directly to **Edge Functions → Secrets** under its exact
variable name. Keep `PUSH_VAPID_PRIVATE_KEY` private: never paste it into a
GitHub file, the website, a support chat or a SQL migration. Optionally set
`PUSH_VAPID_SUBJECT` to a public `mailto:` contact address or HTTPS URL; the
worker defaults to the club's GitHub Pages URL. The public key is returned by
GET `/functions/v1/send-push-notifications` once both keys are configured.
Keep the same pair for existing subscriptions. If rotated, members must
re-enable notifications on each device.

## 3. Private worker key

In **Project Settings → API Keys → Secret keys**, create a secret API key
named exactly `push_notification_worker`. Copy its `sb_secret_...` value.
In **Database → Vault**, create a secret named exactly
`push_notification_worker_key`, with that copied key as its value. This
named key has privileged project access; keep it only in Vault. The public
website does not use it.

## 4. Deploy the function

Deploy [`functions/send-push-notifications/index.ts`](functions/send-push-notifications/index.ts)
as the Edge Function named exactly `send-push-notifications`. The CLI command
from a linked Supabase project is:

```sh
supabase functions deploy send-push-notifications --no-verify-jwt
```

Alternatively choose **Edge Functions → Deploy a new function → Via Editor**,
paste the file and deploy, then turn **off** "Verify JWT with legacy secret"
in the function Details. GET is intentionally public and exposes only the
public key. POST is protected inside the function by the named secret API
key. The repository's `supabase/config.toml` should include:

```toml
[functions.send-push-notifications]
verify_jwt = false
```

Open the function's GET URL in a browser and confirm it returns a nonempty
`vapid_public_key`. Do not send a POST from the public website.

If **Enable device alerts** says the club notification service is unavailable,
check that GET URL first. A `404` with `Requested function was not found`
means the Edge Function has not been deployed to the project in `config.js`
under the exact name `send-push-notifications`; running the SQL migration
does not deploy it. A `401` or `403` means the public GET is being blocked;
turn off **Verify JWT with legacy secret** for this function. A successful GET
with an empty `vapid_public_key` means the VAPID secrets in step 2 are missing
or invalid. Refresh the site after correcting the setup, then tap **Enable
device alerts** again. The in-app inbox works independently of device push.

## 5. Schedule delivery

Enable **Database → Extensions → `pg_cron` and `pg_net`** if they are not
already enabled. Run the full
[`schedule_push_notifications.sql`](schedule_push_notifications.sql) file
in SQL Editor. Check **Integrations → Cron → Jobs** for
`innovatex-push-notification-worker`. It checks queued alerts each minute;
the Web Push provider and device may add further delay.
The worker sends up to 12 device deliveries per minute. A club-wide
announcement to many opted-in devices can take several runs; inbox and
Realtime alerts appear as soon as the announcement is published. The
announcement insert creates one notification per approved club account, so
for a substantially larger club, move that fan-out to a batched worker before
publishing high-volume announcements.

## 6. Test with two approved accounts

Sign in on an installed app, tap **Enable notifications**, and accept the
browser/system prompt. From another approved account send a direct message,
then close or background the recipient app. Check the recipient's device,
**Edge Functions → send-push-notifications → Logs**, and the private outbox:

```sql
select status,count(*) from public.push_outbox group by status;
```

Try a reply, mention and an administrator application alert too. A `404` or
`410` response automatically removes a dead device subscription. A denied
permission requires the member to change browser/device notification settings
before enabling again. On iPhone, install the site from Safari to the Home
Screen first; support and lock screen presentation depend on the OS, browser
and the user's settings. Signing out deletes that browser's subscription;
other devices remain opted in. Test the actual Android/iPhone lock screen
on a real device before promising it to members.

## Safety and operations

- Recipient selection comes from `public.notifications`; the worker accepts
  no user IDs, message bodies or destinations from the HTTP request.
- The database RLS exposes a push endpoint and encryption keys only to its
  approved owner. Outbox claim/finish RPCs accept only the service role.
- Push requests go only to known HTTPS push service hostnames for Chrome,
  Firefox, Apple and Windows. Unsupported browsers cannot register a device.
- The worker rechecks approval, recipient and unread status before sending,
  prunes old delivery jobs, retries transient failures and drops endpoints
  that the push provider reports as expired.
- Push providers and the OS, not GitHub Pages, deliver notifications. Device
  delivery and icon badge support can vary; an in-app alert remains available.

References: [Supabase Edge Function auth](https://supabase.com/docs/guides/functions/auth),
[Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions),
[Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
