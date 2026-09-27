# Back up the club's uploaded files

Supabase's database backups contain Storage **metadata**, but not the actual uploaded bytes. The club uses four **private** buckets and, after `upgrade_founder_portraits.sql`, one **public** founder portrait bucket:

| Bucket | Typical files |
| --- | --- |
| `club-documents` | Collaborative project documents and versions |
| `club-media` | Profile photos, activity images, chat images |
| `club-learning` | Teacher course materials and slides |
| `club-course-evidence` | Learner project evidence files and attachments |
| `club-founder-portraits` | Public founder portraits uploaded with consent |

Keep a **database backup and a Storage file backup together**, taken during a quiet period. This matters because a document or profile row can change while the file downloader is running. Supabase's [database backup documentation](https://supabase.com/docs/guides/platform/backups) and [Storage download guide](https://supabase.com/docs/guides/storage/management/download-objects) explain the separation.

## Download and verify

Run this on a trusted computer with Node.js 20 or later. The script only makes Storage **GET/POST list requests** and writes to a new directory outside the Git repository. It never uploads or deletes anything remotely. The POST request is Supabase's read-only file-list operation.

1. In Supabase **Project Settings → API Keys**, create a dedicated secret key named `storage_backup` (format `sb_secret_...`). It bypasses row level security; keep it off GitHub, chat, browser code, and screenshots. The site's publishable key cannot read every private object. Supabase's [API key guide](https://supabase.com/docs/guides/getting-started/api-keys) describes server-side handling.
2. In a local shell, change into the `Turk-Innovation-CLUB` checkout and set the configuration. This example creates a separate dated backup folder next to the checkout:

   ```bash
   mkdir -p ../club-storage-backups
   export SUPABASE_URL='https://xsbpxjiuiqpfrvhqmlsa.supabase.co'
   export BACKUP_DIR="$(cd ../club-storage-backups && pwd)/run-$(date -u +%Y%m%dT%H%M%SZ)"
   read -rsp 'Paste the storage_backup secret key: ' SUPABASE_SECRET_KEY
   export SUPABASE_SECRET_KEY
   printf '\n'
   node scripts/backup_storage.mjs
   unset SUPABASE_SECRET_KEY
   ```

   The `read -s` option keeps the key out of shell history and terminal output. Enter the key only on a computer you control. Do not put it in `config.js` or a GitHub Actions workflow.
3. A successful run finishes with `manifest.json`. It lists the bucket settings, totals, start and finish time. `files.jsonl` has one JSON line per object: original bucket/path, Storage list metadata, download headers, byte count, and SHA-256. File bytes are under `objects/<bucket>/<original path>`. The original path, including each user's folder, is preserved. If the script exits nonzero or `manifest.json` is missing, the directory is **incomplete**; rerun into a *new* directory.
4. Run `node scripts/verify_storage_backup.mjs "$BACKUP_DIR"`. This offline check hashes every file, verifies all bucket and manifest counts, detects missing or unexpected objects, and confirms the expected bucket visibility settings. The portrait bucket is optional only if its migration has not been applied; the script warns when it is absent. Keep the verifier result with the backup record. If verification fails, rerun the backup into a new directory.

Before downloading, the script pages through the bucket list and refuses to run if it finds an unknown `club-` bucket or any of the four core buckets missing. The founder portrait bucket is included when installed; if absent, verify whether its migration has been applied. When a new club bucket is added, update the `BUCKETS` array in `scripts/backup_storage.mjs`, the verifier's expected buckets, and the bucket table above. The script then pages through all root and nested folders (100 entries per request) and checks downloaded sizes against the listing. Empty buckets have zero file entries in `files.jsonl` and zero counts in `manifest.json`. This is **not** an atomic point-in-time snapshot: schedule it during low activity; if a file changes mid-run, the size check fails, but an equal-size replacement could go unnoticed. For large collections, Supabase recommends an [S3-compatible bulk client](https://supabase.com/docs/guides/storage/management/download-objects) such as rclone or Cyberduck, using credentials from **Storage → Configuration → S3**. Those are separate credentials from the `sb_secret_...` API key.

Store copies in at least two access-controlled locations, preferably encrypted and off-site, with a retention period your club can manage. Uploaded images, chat files, and learning documents may include personal or unpublished information. Keep the private bucket settings and access policies private on restore. Files in the repository's `assets/` directory are source assets tracked by Git; this script is for Supabase Storage only.

## Database metadata and restore

Keep a matching database backup, including `public` tables, `auth` data, and the `storage.buckets` and `storage.objects` metadata. Supabase's [backup and restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) describes the three CLI dumps: roles, schema, and data. On a trusted computer with Supabase CLI and Docker installed, obtain the source database connection URI from the Dashboard's **Connect** panel, enter it privately as `SOURCE_DB_URL`, and run the three commands below. Set `BACKUP_DIR` to the completed Storage backup directory so the database and file copies remain paired. The connection URI contains a database password; avoid saving it in a script, shell history, chat, or Git repository.

```bash
mkdir -m 700 "$BACKUP_DIR/database"
supabase db dump --db-url "$SOURCE_DB_URL" -f "$BACKUP_DIR/database/roles.sql" --role-only
supabase db dump --db-url "$SOURCE_DB_URL" -f "$BACKUP_DIR/database/schema.sql"
supabase db dump --db-url "$SOURCE_DB_URL" -f "$BACKUP_DIR/database/data.sql" --use-copy --data-only -x 'storage.buckets_vectors' -x 'storage.vector_indexes'
unset SOURCE_DB_URL
```

Check all three files exist and are nonempty; protect them like the Storage backup because they contain member records. On paid projects, **Database → Backups** is another source of database recovery points, but it does not copy uploaded bytes. A downloaded file manifest does not capture every Postgres Storage field, such as ownership and row timestamps; the database backup is the authoritative source for those fields. Do not edit `storage.objects` directly to recreate files: Supabase says Storage operations must use its API.

For a recovery rehearsal, create an **empty separate project**, restore the database using Supabase's [CLI restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), and check that the four private buckets and (if installed) public portrait bucket retain the right limits and policies. The source project's Vault secrets, SMTP settings, Edge Function deployment, Cron schedule and public site configuration require separate review in a new project. **Disable or omit outbound Cron/email in the rehearsal** so restored approval jobs do not email real applicants. Then restore file bytes through Supabase's [Storage migration procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore#migrating-storage-objects) or an authenticated S3 client. Keep the original `bucket/path` from `files.jsonl` and the MIME/cache values from its metadata. A re-upload can reset object metadata such as owner and timestamps; verify those details and the application's signed downloads in the test project. If the restored database already contains Storage object rows, coordinate file recovery with Supabase's documented migration flow rather than writing directly to `storage.objects`. Never use `aws s3 sync --delete` in a restore: that deletes objects absent from the local copy.

After the rehearsal, compare object counts for each bucket in `manifest.json` with the test project's Storage bucket listing. Verify a document version, a profile photo, a chat image, a teacher slide, a learner's submitted evidence, and a public founder portrait if its migration is installed. Check that an unapproved account cannot create a signed URL or download a private object directly; an already issued signed URL is a temporary bearer link and must not be shared. Record the backup date, source/test project references, any ownership changes, and test outcome. Rotate the `storage_backup` key if its confidentiality is in doubt. An offline hash pass only confirms the copied bytes; the separate-project restore is the proof that the system can recover.
