# Back up SPACE from a Chromebook

Use a private GitHub Codespace for a manual backup on Supabase Free. This needs no Linux installation on the Chromebook. Check the remaining Codespaces allowance first; compute and stored files consume its quota. The helper reads production data but never restores, uploads, deletes, changes policies, deploys code or schedules jobs.

## 1. Open the browser terminal

Create a **private** repository named `space-backup-tools` with a README, then choose **Code → Codespaces → Create codespace on main**. Open **Terminal → New Terminal**. Run `node --version` and `docker version`. Node must be 20 or newer and Docker must show both Client and Server details.

Copy the reviewed SPACE source into a separate folder. Run this command once:

```bash
git clone --depth 1 https://github.com/Turkson225/Turk-Innovation-CLUB.git /workspaces/space-backup-source
```

If that folder already exists, do not delete it or rerun the clone blindly. Inspect it first. Use the latest reviewed helper from the repository rather than pasting credentials into a script.

## 2. Prepare two credentials privately

In the existing Supabase project:

1. Open **Project Settings → API Keys → Secret keys**. Create a dedicated key named `storage_backup`. Its value begins `sb_secret_`. This is a powerful server key that bypasses RLS; the backup helper uses it only for read operations. Never paste it into chat, Copilot, a source file or a screenshot. It is not the publishable key used by the website.
2. Click **Connect**. Choose the PostgreSQL **URI** connection string and **Session pooler**, on port **5432**. Copy the template, leaving `[YOUR-PASSWORD]` in place. Do not use the transaction pooler on port 6543.
3. Have the project's **database password** available. This is different from your SPACE account password and API key. Do not reset it merely to follow this guide if it is already available.

Run during a quiet period. The database and file operations are separate reads rather than one atomic snapshot, and downloading files uses Supabase egress.

## 3. Run the interactive helper

Paste only this command into the Codespaces terminal:

```bash
bash /workspaces/space-backup-source/scripts/backup_codespace.sh
```

The script checks its tools before asking for credentials. It creates a private temporary GPG home, so the backup does not depend on a pre-existing GPG directory or change the Codespace's commit-signing configuration. Its own agent and temporary home are cleaned up when the helper exits. If this initial encryption check fails, the safe startup error is shown before any credentials are entered. When each prompt appears, provide only the value it requests and press Enter. Credential input is hidden; an empty-looking prompt while pasting is expected. It asks for the Session pooler template, database password, and `storage_backup` key. The helper encodes the database password in the URI for you. Do not paste a block of following shell commands into a credential prompt.

The helper downloads the installed club Storage buckets, verifies file hashes and counts, then exports database roles, schema and data. It also saves a **reference-only** snapshot of the managed Auth/Storage/Realtime schemas and the source migration definitions. Source definitions do not establish that the live schema matches the repository.

It then asks for a new encryption passphrase to protect the archive. Keep that passphrase separately in your password manager; it is not your database password. The helper checks that the archive can be decrypted and read. Raw tool output is hidden and its temporary log is removed because it may contain credentials. A failed tool step prints a fixed `Safe diagnostic` code and explanation based on known errors, without copying log lines, connection strings or member data. `UNCLASSIFIED` means the cause is still unknown; do not assume the password is wrong. If a step fails, the helper stops and retains any incomplete private backup folder, which must not be treated as a completed backup. Send only the safe diagnostic code and the helper's fixed `Backup error:` message for troubleshooting, never credentials or a database dump.

## 4. Download the encrypted archive

On success the terminal prints a `.tar.gz.gpg` path under `/workspaces/space-backups` and its SHA-256 checksum.

1. In Codespaces choose **File → Open Folder**, enter `/workspaces/space-backups`, and open it.
2. Right-click the `.tar.gz.gpg` file in Explorer and choose **Download**. Download its checksum file too. Do not publish a forwarded HTTP port to serve the backup.
3. Keep two encrypted copies in access-controlled locations, along with the passphrase stored separately. Check the downloaded checksum and verify decryption before discarding the Codespace copy.
4. Stop the Codespace when finished. Once both downloaded copies are verified, delete the Codespace if it is no longer needed; stopped Codespaces still use storage allowance. Unencrypted source backups remain inside it until deletion.

Nothing needs to be committed or pushed to either repository. A successful archive check is evidence that this copy was exported and can be decrypted, **not** a passed disaster-recovery test.

If a database export fails, check it without downloading Storage again:

```bash
bash /workspaces/space-backup-source/scripts/backup_codespace.sh --check-database
```

This mode asks for only the connection template and database password. It attempts the same read-only roles export into a private temporary directory and removes that diagnostic export on exit. Share only its fixed `Safe diagnostic` code and error message. Passing this check is not a full backup; run the helper without the flag after the error is resolved.

## 5. Rehearse recovery separately

Create an empty test Supabase project and a private copy of the frontend configured for that test project. Keep the live frontend and its database configuration unchanged. Before importing or enabling restored code, review and omit outbound Cron jobs, webhooks and production email-worker credentials. A one-click clone can start copied external jobs immediately, so use the controlled logical restore described in [backup_restore.md](backup_restore.md).

Custom Auth triggers, Storage/Realtime policies, migration history and project settings need explicit review. The managed-schema reference is not an install script. Auth settings, SMTP, Vault encryption/secret handling, Edge Functions, Realtime publications, API keys and public URLs are not automatically recreated by this helper. Do not distribute a backup as fully recoverable until these gaps have been reconciled and tested.

Compare database record counts and file hashes/counts in the test project. Test sign-in, a course file, a profile photo, a DM attachment between its two participants, a finance receipt as administrator, a teacher signature and certificate, and a product image. Confirm unrelated members cannot download those private files. Record the backup date, source commit, test project, recovery duration, failures and final outcome. Do not delete production records to simulate a disaster.

## References

- [Supabase backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase backups and Free-plan exports](https://supabase.com/docs/guides/platform/backups)
- [Supabase API key handling](https://supabase.com/docs/guides/getting-started/api-keys)
- [GitHub Codespaces creation](https://docs.github.com/en/codespaces/developing-in-a-codespace/creating-a-codespace-for-a-repository)
- [VS Code Codespaces file downloads](https://code.visualstudio.com/docs/remote/codespaces)
