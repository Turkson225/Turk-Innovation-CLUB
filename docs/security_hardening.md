# Security hardening — 27 October 2026

The browser update preserves remembered member accounts and separate account tabs.
Approved administrators enrol a TOTP authenticator, or verify their existing factor,
before the workspace opens. Role changes and finance approval/closing require a
TOTP verification within 15 minutes after the database migration is installed.
An expired step-up returns the administrator to verification; retry the original
action afterward. Changes are never silently replayed.

## Existing Supabase project: activation

1. Deploy the matching frontend and test authenticator enrolment with the owner
   admin before applying SQL. Keep project-owner dashboard access for recovery.
2. In SQL Editor run the entire
   `supabase/migrations/20261027010000_security_hardening.sql` file. It is transactional
   and rerunnable. It retains accounts, messages, files and business records.
   Confirm your current schema has the legacy upgrades in `legacy-migrations.json`.
   Do not replay the fresh-database baseline over an existing project.
3. Test an AAL1 admin session: privileged RPCs and direct writes must be denied.
   Verify the authenticator and repeat: approved admin actions must work.
4. Redeploy `send-approval-emails` to activate corrected club branding and password
   sign-in instructions. Preserve its named-secret authentication and existing secrets.

TOTP enrolment and verification must be enabled in Supabase Auth. If an admin loses
their authenticator, the Supabase project owner must verify their identity and remove
the lost factor through the supported Auth administration flow. Never publish service
keys or disable database safeguards as a recovery shortcut. Infrastructure-owner MFA,
CAPTCHA/password protections and rate-limit settings need dashboard verification.

## Database migrations going forward

Historical SQL is immutable and checksummed. `npm run check:migrations` verifies the
manifest and generated baseline. A fresh project uses the timestamped files in
`supabase/migrations/` in order. Existing projects must first verify their schema and
adopt the baseline using `supabase migration repair --status applied 20261027000000`
with the correct linked project; use `supabase db push --dry-run` before pushing.
If history differs, reconcile it in staging first. Add future changes as new timestamped
migrations, never by replaying older upgrades. The security suite builds the full
baseline and checks RLS, administrator guards, role denial and bulk abuse limits.

Message limits cover direct table inserts and RPCs. Conversation writes share a
40/minute, 400/hour, 2,000/day sender limit; DMs also have a 20/minute recipient-pair
limit. Publications have separate 10/minute, 100/hour, 300/day limits. Notifications
have independent fan-out quotas. Atomic counters reset in place; failed batches roll
back rather than partially saving. These limits do not replace Auth bot protection.

## Dedicated origin and HTTP headers

The static entry pages enforce CSP through meta tags, permit only hashed inline
fallback scripts, and use local pinned Supabase and font files. GitHub Pages does
not apply our Worker headers. Full framing protection and isolation from other
projects on `turkson225.github.io` remain pending until a separate host is activated.

`hosting/security-worker.mjs` and `hosting/wrangler.toml` provide a dedicated Cloudflare
Worker origin that reads the public GitHub deployment and sets CSP `frame-ancestors`,
X-Frame-Options, nosniff, referrer and permissions headers. Deploy from `hosting` with
`npx wrangler deploy` using your own hosting account. The returned workers.dev URL is
the dedicated origin; no purchased domain is required. Add its exact app and password
recovery URLs to Supabase Auth redirect allowlists, update OAuth/calendar authorized
origins if used, and test recovery, verification, PWA push, maps and document previews.
Set the primary site URL only after those tests pass. Browser storage and installed
push subscriptions do not transfer between origins: members sign in and enable alerts
on the new origin. Keep the old site available during the transition.

Custom map providers may need explicit additions to connect-src. Update the shared
policy and regenerate HTML with `node scripts/apply_security_policy.mjs`. Preserve
hashes for approved inline fallbacks. Rebuild local dependencies with `npm ci && npm run vendor`.

## Remaining operational evidence

Run authenticated tests using separate member, teacher, founder, treasurer, pending
and admin test accounts against staging. Restore a paired database and uploaded-file
backup into an isolated project, verify file hashes and permissions, then record the
recovery time. Existing `docs/backup_restore.md` and backup/verification scripts cover
the procedure. Live restoration, owner MFA, worker deliveries and production load
capacity cannot be established from repository-only checks and are not claimed here.
