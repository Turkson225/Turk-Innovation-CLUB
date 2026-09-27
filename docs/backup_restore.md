# Back up the club's uploaded files

Supabase's database backups contain Storage **metadata**, but not the actual uploaded bytes. The club currently uses four **private** buckets:

| Bucket | Typical files |
| --- | --- |
| `club-documents` | Collaborative project documents and versions |
| `club-media` | Profile photos, activity images, chat images |
| `club-learning` | Teacher course materials and slides |
| `club-course-evidence` | Learner project evidence files and attachments |

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
4. Compare `total_objects` in `manifest.json` with the number of lines in `files.jsonl`, and spot-check hashes against the files. For a single example, read the `path` and `sha256` from a line, then run `sha256sum "${BACKUP_DIR}/objects/club-media/<path>"`. Test a restore to a separate Supabase project before relying on this procedure.

Before downloading, the script pages through the bucket list and refuses to run if it finds an unknown `club-` bucket or a missing expected bucket. When a new club bucket is added, update the `BUCKETS` array in `scripts/backup_storage.mjs`, the bucket table above, and the restore checks below. The script then pages through all root and nested folders (100 entries per request) and checks downloaded sizes against the listing. Empty buckets have zero file entries in `files.jsonl` and zero counts in `manifest.json`. This is **not** an atomic point-in-time snapshot: schedule it during low activity; if a file changes mid-run, the size check fails, but an equal-size replacement could go unnoticed. For large collections, Supabase recommends an [S3-compatible bulk client](https://supabase.com/docs/guides/storage/management/download-objects) such as rclone or Cyberduck, using credentials from **Storage → Configuration → S3**. Those are separate credentials from the `sb_secret_...` API key.

Store copies in at least two access-controlled locations, preferably encrypted and off-site, with a retention period your club can manage. Uploaded images, chat files, and learning documents may include personal or unpublished information. Keep the private bucket settings and access policies private on restore. Files in the repository's `assets/` directory are source assets tracked by Git; this script is for Supabase Storage only.

## Database metadata and restore

Keep a matching database backup, including `public` tables, `auth` data, and the `storage.buckets` and `storage.objects` metadata. Supabase's [backup and restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) describes database dump and restore with the CLI. Paid project backups are available in **Database → Backups**. A downloaded file manifest does not capture every Postgres Storage field, such as ownership and row timestamps; the database backup is the authoritative source for those fields. Do not edit `storage.objects` directly to recreate files: Supabase says Storage operations must use its API.

For a recovery rehearsal, create an **empty separate project**, restore the database and club migrations, check that the four buckets remain private with the right limits and policies, then restore file bytes through Supabase's [Storage migration procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore#migrating-storage-objects) or an authenticated S3 client. Keep the original `bucket/path` from `files.jsonl` and the MIME/cache values from its metadata. A re-upload can reset object metadata such as owner and timestamps; verify those details and the application's signed downloads in the test project. If the restored database already contains Storage object rows, coordinate file recovery with Supabase's documented migration flow rather than writing directly to `storage.objects`. Never use `aws s3 sync --delete` in a restore: that deletes objects absent from the local copy.

After the rehearsal, verify a document version, a profile photo, a chat image, a teacher slide, and a learner's submitted evidence through the club UI using approved accounts with the right roles. Check at least one signed URL remains private to an unapproved account. Record the backup date and test outcome, and rotate the `storage_backup` key if its confidentiality is in doubt.
