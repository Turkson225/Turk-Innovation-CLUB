#!/usr/bin/env bash
# Read-only source backup. Restore only to a separately reviewed test project.
set +x
set -Eeuo pipefail
umask 077

SOURCE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
BACKUP_BASE=/workspaces/space-backups
PROJECT_REF=xsbpxjiuiqpfrvhqmlsa
export SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
TOOL_LOG=''
ARCHIVE_PARTIAL=''
CHECKSUM_PARTIAL=''
SPACE_GPG_DIR=''

cleanup() {
  local status=$?
  set +x
  unset SESSION_TEMPLATE DATABASE_PASSWORD SOURCE_DB_URL SUPABASE_SECRET_KEY
  if [[ -n "$SPACE_GPG_DIR" ]]; then
    gpgconf --homedir "$SPACE_GPG_DIR" --kill gpg-agent >/dev/null 2>&1 || true
    rm -rf -- "$SPACE_GPG_DIR"
  fi
  [[ -z "$TOOL_LOG" ]] || rm -f -- "$TOOL_LOG"
  if (( status != 0 )); then
    [[ -z "$ARCHIVE_PARTIAL" ]] || rm -f -- "$ARCHIVE_PARTIAL"
    [[ -z "$CHECKSUM_PARTIAL" ]] || rm -f -- "$CHECKSUM_PARTIAL"
    printf '\nBackup stopped. Keep any private backup folder for investigation; this is not a completed recovery test.\n' >&2
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fail() { printf 'Backup error: %s\n' "$1" >&2; exit 1; }
secret_prompt() {
  printf '%s' "$2" >&2
  IFS= read -r -s "$1" || fail 'Could not read private input.'
  printf '\n' >&2
  [[ -n "${!1}" ]] || fail 'Private input was empty.'
}
quiet_run() {
  local label=$1
  shift
  printf '%s...\n' "$label"
  if ! "$@" >"$TOOL_LOG" 2>&1; then
    fail "$label failed. Raw tool output is withheld because it may contain credentials."
  fi
  : >"$TOOL_LOG"
}

[[ -t 0 ]] || fail 'Run this file from the Codespaces interactive terminal.'
for tool in node docker npx gpg gpgconf tar git sha256sum mktemp date; do
  command -v "$tool" >/dev/null 2>&1 || fail "Required tool is missing: $tool"
done
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || fail 'Node.js 20 or newer is required.'
[[ -d /workspaces && -w /workspaces ]] || fail 'The Codespaces /workspaces directory is unavailable.'
[[ ! -L "$BACKUP_BASE" ]] || fail 'The backup directory must not be a symbolic link.'
mkdir -p -- "$BACKUP_BASE"
BACKUP_BASE="$(cd -- "$BACKUP_BASE" && pwd -P)"
case "$BACKUP_BASE/" in "$SOURCE_ROOT/"*) fail 'Backups must be outside the source repository.';; esac
if git -C "$BACKUP_BASE" rev-parse --show-toplevel >/dev/null 2>&1; then
  fail 'The backup directory must be outside every Git repository.'
fi
TOOL_LOG="$(mktemp "$BACKUP_BASE/.space-backup-tool.XXXXXX")"
quiet_run 'Checking Docker server' docker info
printf 'Checking encryption agent...\n'
# Fresh Codespaces may have no default GPG home, or use it for commit signing.
# A short, private home keeps this backup independent of that configuration.
SPACE_GPG_DIR="$(mktemp -d /tmp/space-backup-gpg.XXXXXX)"
chmod 700 -- "$SPACE_GPG_DIR"
if ! gpgconf --homedir "$SPACE_GPG_DIR" --launch gpg-agent >"$TOOL_LOG" 2>&1; then
  # This check runs before credentials and uses a new empty GPG home.
  cat -- "$TOOL_LOG" >&2
  fail 'The isolated encryption agent could not start. Share only the startup error shown above.'
fi
: >"$TOOL_LOG"
printf 'Preparing the official Supabase CLI before asking for credentials...\n'
if ! CLI_VERSION="$(npx --yes supabase@latest --version 2>"$TOOL_LOG")"; then
  fail 'Supabase CLI preparation failed.'
fi
[[ "$CLI_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'The Supabase CLI did not return a supported version.'
printf 'Using Supabase CLI %s.\n' "$CLI_VERSION"
for file in backup_storage.mjs verify_storage_backup.mjs; do
  [[ -f "$SOURCE_ROOT/scripts/$file" ]] || fail 'A required backup script is missing.'
done
SOURCE_COMMIT="$(git -C "$SOURCE_ROOT" rev-parse HEAD)" || fail 'Source commit could not be recorded.'
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
export BACKUP_DIR="$BACKUP_BASE/run-$STAMP"
ARCHIVE_NAME="SPACE-$STAMP.tar.gz.gpg"
ARCHIVE_FINAL="$BACKUP_BASE/$ARCHIVE_NAME"
ARCHIVE_PARTIAL="$ARCHIVE_FINAL.partial"
CHECKSUM_PARTIAL="$ARCHIVE_FINAL.sha256.partial"
[[ ! -e "$BACKUP_DIR" && ! -e "$ARCHIVE_FINAL" && ! -e "$ARCHIVE_PARTIAL" && ! -e "$ARCHIVE_FINAL.sha256" && ! -e "$CHECKSUM_PARTIAL" ]] || fail 'A backup with this timestamp already exists. Wait a moment and rerun.'

printf '\nUse a quiet period: database and uploaded files are captured separately.\n'
printf 'In Supabase Connect, copy the Session pooler URI on port 5432 with [YOUR-PASSWORD] unchanged.\n'
secret_prompt SESSION_TEMPLATE 'Paste the Session pooler URI template (hidden): '
secret_prompt DATABASE_PASSWORD 'Enter the database password (hidden): '
if ! SOURCE_DB_URL="$(SPACE_DB_TEMPLATE="$SESSION_TEMPLATE" SPACE_DB_PASSWORD="$DATABASE_PASSWORD" node --input-type=module - <<'NODE'
try {
  const url = new URL(process.env.SPACE_DB_TEMPLATE);
  const password = process.env.SPACE_DB_PASSWORD;
  if (url.protocol !== 'postgresql:' ||
      url.username !== 'postgres.xsbpxjiuiqpfrvhqmlsa' ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com$/.test(url.hostname) ||
      url.port !== '5432' || url.pathname !== '/postgres' || url.hash ||
      decodeURIComponent(url.password) !== '[YOUR-PASSWORD]' || !password) {
    throw new Error('Invalid connection');
  }
  const options = [...url.searchParams.keys()];
  if (new Set(options).size !== options.length ||
      options.some(key => !['sslmode', 'connect_timeout'].includes(key))) {
    throw new Error('Unsupported connection options');
  }
  const sslmode = url.searchParams.get('sslmode') || 'require';
  if (!['require', 'verify-ca', 'verify-full'].includes(sslmode)) throw new Error('TLS required');
  const timeout = url.searchParams.get('connect_timeout');
  if (timeout !== null && (!/^[1-9]\d{0,2}$/.test(timeout) || Number(timeout) > 120)) {
    throw new Error('Invalid connection timeout');
  }
  // Encode the literal '%' too; URL.password alone does not do that.
  url.password = encodeURIComponent(password);
  if (decodeURIComponent(url.password) !== password) throw new Error('Invalid encoding');
  url.searchParams.set('sslmode', sslmode);
  process.stdout.write(url.href);
} catch {
  process.stderr.write('Connection template could not be validated. Use the specified project and Session pooler on port 5432.\n');
  process.exit(1);
}
NODE
)"; then
  fail 'Connection details were rejected; no source request was made.'
fi
unset SESSION_TEMPLATE DATABASE_PASSWORD
secret_prompt SUPABASE_SECRET_KEY 'Paste the storage_backup secret API key, sb_secret_... (hidden): '
[[ "$SUPABASE_SECRET_KEY" == sb_secret_* && ${#SUPABASE_SECRET_KEY} -gt 12 ]] || fail 'A secret API key beginning sb_secret_ is required.'
export SUPABASE_SECRET_KEY

quiet_run 'Downloading uploaded files' node "$SOURCE_ROOT/scripts/backup_storage.mjs"
unset SUPABASE_SECRET_KEY
printf 'Verifying every downloaded file...\n'
if ! node "$SOURCE_ROOT/scripts/verify_storage_backup.mjs" "$BACKUP_DIR" >"$BACKUP_DIR/storage-verification.txt" 2>&1; then
  fail 'Downloaded-file verification failed. See the private storage-verification.txt report.'
fi
cat -- "$BACKUP_DIR/storage-verification.txt"
mkdir -m 700 -- "$BACKUP_DIR/database" "$BACKUP_DIR/source"
quiet_run 'Exporting database roles' npx --yes "supabase@$CLI_VERSION" db dump --db-url "$SOURCE_DB_URL" -f "$BACKUP_DIR/database/roles.sql" --role-only
quiet_run 'Exporting application schema' npx --yes "supabase@$CLI_VERSION" db dump --db-url "$SOURCE_DB_URL" -f "$BACKUP_DIR/database/schema.sql"
quiet_run 'Exporting database records' npx --yes "supabase@$CLI_VERSION" db dump --db-url "$SOURCE_DB_URL" -f "$BACKUP_DIR/database/data.sql" --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes
quiet_run 'Capturing managed-schema reference' npx --yes "supabase@$CLI_VERSION" db dump --db-url "$SOURCE_DB_URL" -f "$BACKUP_DIR/database/managed-schema-reference.sql" --schema auth,storage,realtime
unset SOURCE_DB_URL
for file in roles.sql schema.sql data.sql managed-schema-reference.sql; do
  [[ -s "$BACKUP_DIR/database/$file" ]] || fail 'A database export is empty or missing.'
done
printf 'Copying tracked SQL definitions and recovery instructions...\n'
git -C "$SOURCE_ROOT" archive HEAD supabase docs/backup_restore.md docs/backup_chromebook.md | tar -xf - -C "$BACKUP_DIR/source"
mkdir -- "$BACKUP_DIR/source/backup-tools"
cp -- "$SOURCE_ROOT/scripts/backup_storage.mjs" "$SOURCE_ROOT/scripts/verify_storage_backup.mjs" "${BASH_SOURCE[0]}" "$BACKUP_DIR/source/backup-tools/"
cat >"$BACKUP_DIR/BACKUP_STATUS.txt" <<EOF
STATUS: BACKUP_CAPTURED_RESTORE_NOT_TESTED
Source project: $PROJECT_REF
Source commit: $SOURCE_COMMIT
Supabase CLI: $CLI_VERSION
Started UTC: $STAMP
Capture finished UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)

Storage byte/hash verification passed before this archive was created.
Database exports and file downloads are separate captures, not one atomic snapshot.
managed-schema-reference.sql is REFERENCE ONLY. Do not blindly restore managed schemas.
Custom Auth triggers and Storage/Realtime policies require a reviewed restore plan.
Auth/SMTP settings, API keys, Vault/encryption keys, Edge Functions and publications
require separate recovery review. Do not enable restored outbound jobs or email schedules.
Rehearse restoration into a separate project and verify permissions and downloads.
This archive is not proof that live recovery or production capacity has passed.
EOF

printf '\nChoose a strong archive passphrase and keep it separately from the backup.\n'
printf 'GPG will ask for it to encrypt, then again to verify the encrypted archive.\n'
export GPG_TTY="$(tty)"
tar -czf - -C "$BACKUP_BASE" "$(basename -- "$BACKUP_DIR")" |
  gpg --homedir "$SPACE_GPG_DIR" --pinentry-mode loopback --no-symkey-cache --symmetric --cipher-algo AES256 --output "$ARCHIVE_PARTIAL"
printf 'Checking that the encrypted archive can be decrypted and read...\n'
gpg --homedir "$SPACE_GPG_DIR" --pinentry-mode loopback --no-symkey-cache --decrypt "$ARCHIVE_PARTIAL" | tar -tzf - >/dev/null
CHECKSUM="$(sha256sum -- "$ARCHIVE_PARTIAL")"
CHECKSUM="${CHECKSUM%% *}"
printf '%s  %s\n' "$CHECKSUM" "$ARCHIVE_NAME" >"$CHECKSUM_PARTIAL"
mv -- "$ARCHIVE_PARTIAL" "$ARCHIVE_FINAL"
mv -- "$CHECKSUM_PARTIAL" "$ARCHIVE_FINAL.sha256"
printf '\nEncrypted archive was decrypted and its contents listed successfully.\n'
printf 'Archive: %s\nChecksum: %s.sha256\n' "$ARCHIVE_FINAL" "$ARCHIVE_FINAL"
printf 'Private plaintext copy retained: %s\n' "$BACKUP_DIR"
printf 'Download the archive and checksum in Codespaces Explorer; never commit backups or credentials.\n'
printf 'Verify the downloaded copy before deleting the private plaintext or Codespace.\n'
printf 'Recovery status: RESTORE NOT TESTED.\n'
