#!/bin/sh
# ============================================================================
# MinIO provisioning — runs ONCE as a short-lived init container.
#
# WHY A SCRIPT AND NOT AN INLINE COMPOSE ENTRYPOINT:
# The old version had the whole provisioning chain inside a Compose
# `entrypoint: >` YAML block. That means every `&&`, `$VAR` and quote is being
# parsed by THREE parsers (YAML, Compose interpolation, /bin/sh) and any one
# of them can silently mangle it. A real script file has exactly one parser.
#
# IDEMPOTENCY: this container is re-run every time you `docker compose up`.
# Every step below is written so a second run is a no-op, not a crash.
# ============================================================================

set -eu

# ---- Config (Compose passes these in; defaults mirror docker-compose.yml) ----
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"

MINIO_VIDEO_BUCKET="${MINIO_VIDEO_BUCKET:-video}"
MINIO_THUMBNAIL_BUCKET="${MINIO_THUMBNAIL_BUCKET:-thumbnails}"
MINIO_AVATAR_BUCKET="${MINIO_AVATAR_BUCKET:-avatars}"
MINIO_COVER_BUCKET="${MINIO_COVER_BUCKET:-covers}"

# Scoped service account for auth-service (avatar uploads).
# Falls back to root ONLY when explicitly unset AND provisioning is skipped —
# see the guard below. We never auto-fall-back to root silently.
MINIO_AUTH_ACCESS_KEY="${MINIO_AUTH_ACCESS_KEY:-}"
MINIO_AUTH_SECRET_KEY="${MINIO_AUTH_SECRET_KEY:-}"

AUTH_POLICY_NAME="${MINIO_AUTH_POLICY_NAME:-wideo11-auth-avatars}"
AUTH_POLICY_FILE="${MINIO_AUTH_POLICY_FILE:-/policies/auth-avatars.json}"

log() { echo "[minio-init] $*"; }
die() { echo "[minio-init] FATAL: $*" >&2; exit 1; }

# ============================================================================
# 0. HEALTH GATE — server "live" hone ka INTZAAR pehle, commands BAAD me
# ============================================================================
# Ye wahi race thi jisme container 134ms me exit 255 ho gaya tha: CRLF
# shebang (`#!/bin/sh\r`) ki wajah se script exec hi nahi ho pa rahi thi.
# Wo fix alag se kiya gaya (LF normalization). Ye gate defense-in-depth hai:
#
# Hinglish line-by-line:
#   `until curl -sf ...; do sleep 1; done`
#     until  = jab tak condition sach na ho, loop chalao
#     curl   = TCP handshake + HTTP request dono confirm karta hai
#     -s     = silent (progress meter nahi)
#     -f     = HTTP error (4xx/5xx) par non-zero exit — sirf 200 OK par
#              loop toot-ta hai, isliye "200 mila" hi asli confirmation hai
#     --connect-timeout 2 = sirf TCP connect ko max 2s do
#     --max-time 3       = poora probe max 3s. Ye zaroori hai: agar MinIO
#              TCP haath de de par HTTP par jawab hi na de, to curl bina
#              is flag ke ANTAK me hang ho sakta hai — attempt counter
#              aage badhega hi nahi aur 60s ka cap kaam nahi karega.
#     sleep 1 = har second me dobara poochho (server ko haath nahi lagate)
#   `${MINIO_ENDPOINT%/}` = endpoint ke aakhir ki trailing slash hata do,
#     warna `http://minio:9000//minio/health/live` ban jayega
#   attempt cap (60) = infinite hang se bachao — 60s ke baad `die` saaf
#     reason ke saath exit 1 karta hai, taaki failure chhupi hui na rahe
log "waiting for ${MINIO_ENDPOINT%/}/minio/health/live ..."
health_attempt=0
until curl -sf --connect-timeout 2 --max-time 3 "${MINIO_ENDPOINT%/}/minio/health/live" >/dev/null 2>&1; do
    health_attempt=$((health_attempt + 1))
    if [ "$health_attempt" -ge 60 ]; then
        die "MinIO health/live did not return 200 within 60s (${MINIO_ENDPOINT})"
    fi
    sleep 1
done
log "health/live OK — MinIO ab commands accept karega, provisioning shuru"

# ============================================================================
# 1. Wait for MinIO to actually accept requests
# ============================================================================
log "waiting for ${MINIO_ENDPOINT} ..."
attempt=0
until mc alias set local "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
        die "MinIO not reachable after 30 attempts (${MINIO_ENDPOINT})"
    fi
    sleep 2
done
log "alias 'local' configured"

# ============================================================================
# 2. Buckets
# ============================================================================
for bucket in "$MINIO_VIDEO_BUCKET" "$MINIO_THUMBNAIL_BUCKET" "$MINIO_AVATAR_BUCKET" "$MINIO_COVER_BUCKET"; do
    if mc mb --ignore-existing "local/${bucket}" >/dev/null 2>&1; then
        log "bucket ready: ${bucket}"
    else
        die "could not create/find bucket: ${bucket}"
    fi
done

# ============================================================================
# 3. Public-read policy on the avatars bucket ONLY
# ============================================================================
# WHY ONLY avatars: profile images must render in a plain <img src>. The
# `video` and `thumbnails` buckets stay PRIVATE — those are paid/tiered assets
# and must never be world-readable.
#
# This is done with ROOT on purpose. Doing it from auth-service would require
# granting it `s3:PutBucketPolicy`, which is exactly the kind of blast radius
# we are removing. See policies/README.md.
if mc anonymous set download "local/${MINIO_AVATAR_BUCKET}" >/dev/null 2>&1; then
    log "public-read policy applied: ${MINIO_AVATAR_BUCKET} (download)"
else
    die "could not set public-read policy on ${MINIO_AVATAR_BUCKET}"
fi

# Channel covers - same reasoning as avatars (they render in plain <img> /
# background-image on public channel pages). A SEPARATE bucket because covers
# are wide banners with a different size profile, and mixing them with profile
# avatars would make lifecycle/size rules impossible to express.
if mc anonymous set download "local/${MINIO_COVER_BUCKET}" >/dev/null 2>&1; then
    log "public-read policy applied: ${MINIO_COVER_BUCKET} (download)"
else
    die "could not set public-read policy on ${MINIO_COVER_BUCKET}"
fi

# Explicitly keep the paid buckets private. `mc anonymous set none` is the
# default state, but stating it makes the intent auditable and repairs a
# bucket that someone left open by hand.
for bucket in "$MINIO_VIDEO_BUCKET" "$MINIO_THUMBNAIL_BUCKET"; do
    mc anonymous set none "local/${bucket}" >/dev/null 2>&1 \
        && log "private (confirmed): ${bucket}" \
        || log "WARN: could not confirm ${bucket} is private — check manually"
done

# ============================================================================
# 4. Scoped IAM user for auth-service  (Phase A / gap #1)
# ============================================================================
# Root credentials are admin-everything. If they leak from anywhere, the whole
# storage cluster is compromised. auth-service only ever needs to read/write
# objects in ONE bucket, so it gets an account that can do exactly that and
# nothing else.
if [ -z "$MINIO_AUTH_ACCESS_KEY" ] || [ -z "$MINIO_AUTH_SECRET_KEY" ]; then
    die "MINIO_AUTH_ACCESS_KEY / MINIO_AUTH_SECRET_KEY are required.
     auth-service is configured to use the scoped service account, so the
     bucket-scoped credentials must be set in .env before starting the stack.
     (Generate with: openssl rand -base64 32 | tr -d '/+=' )"
fi

if [ ! -f "$AUTH_POLICY_FILE" ]; then
    die "policy file not found: ${AUTH_POLICY_FILE}"
fi

# `mc admin policy create` OVERWRITES an existing policy, so this is naturally
# idempotent AND self-updating: edit the JSON, re-run, the change is live.
if mc admin policy create local "$AUTH_POLICY_NAME" "$AUTH_POLICY_FILE" >/dev/null 2>&1; then
    log "policy applied: ${AUTH_POLICY_NAME}"
else
    die "could not create policy ${AUTH_POLICY_NAME} from ${AUTH_POLICY_FILE}"
fi

# `mc admin user add` succeeds whether the user is new OR already exists
# (verified against RELEASE.2024-06-12). That is exactly the behaviour we
# want: run it unconditionally so that rotating MINIO_AUTH_SECRET_KEY in .env
# actually PUSHES the new secret to MinIO. Probing first and skipping would
# silently break credential rotation.
if out="$(mc admin user add local "$MINIO_AUTH_ACCESS_KEY" "$MINIO_AUTH_SECRET_KEY" 2>&1)"; then
    log "IAM user ready: ${MINIO_AUTH_ACCESS_KEY}"
else
    die "could not create/refresh IAM user: ${out}"
fi

# Attaching an already-attached policy is NOT idempotent in mc - it exits 1
# with "The specified policy change is already in effect". Treating that as
# fatal would break the container on every single restart. So we check the
# CURRENT state first and only attach when it is genuinely missing.
if mc admin user info local "$MINIO_AUTH_ACCESS_KEY" 2>/dev/null | grep -q "$AUTH_POLICY_NAME"; then
    log "policy already attached (idempotent): ${AUTH_POLICY_NAME}"
elif mc admin policy attach local "$AUTH_POLICY_NAME" --user "$MINIO_AUTH_ACCESS_KEY" >/dev/null 2>&1; then
    log "policy attached to ${MINIO_AUTH_ACCESS_KEY}"
else
    die "could not attach ${AUTH_POLICY_NAME} to ${MINIO_AUTH_ACCESS_KEY}"
fi

# ============================================================================
# 5. Verify the scoped account is actually RESTRICTED
# ============================================================================
# A policy that is attached but wrong still logs in successfully, so a
# successful login proves nothing. What we actually want to prove is that the
# account CANNOT do the things it must not do. This is the assertion that
# would catch a policy that was accidentally written too broad.
verify_denied() {
    desc="$1"
    shift
    if "$@" >/dev/null 2>&1; then
        die "LEAK: ${MINIO_AUTH_ACCESS_KEY} was ALLOWED to ${desc} — policy is too broad"
    fi
    log "denied (as expected): ${desc}"
}

alias_app() {
    # Reuse the same binary/alias name the audit commands use, but with the
    # scoped credentials so we are testing the scoped account.
    mc alias set scoped "$MINIO_ENDPOINT" "$MINIO_AUTH_ACCESS_KEY" "$MINIO_AUTH_SECRET_KEY" >/dev/null 2>&1 \
        || die "scoped account cannot authenticate at all — check the credentials"
    log "scoped account authenticates OK"
}

alias_app

# The whole point: allowed in its own buckets, refused everywhere else.
for own in "$MINIO_AVATAR_BUCKET" "$MINIO_COVER_BUCKET"; do
    mc ls "scoped/${own}" >/dev/null 2>&1 \
        || die "scoped account cannot list its OWN bucket (${own}) — policy too narrow"
    log "allowed (as expected): list own bucket ${own}"
done

# Bucket enumeration (`ListAllMyBuckets`) is always allowed in S3, but it must
# NOT disclose the buckets this account has no rights on. Asserting the
# CONTENT is what makes this meaningful — a bare "did it exit 0" check would
# pass while leaking every bucket name.
enum_out="$(mc ls scoped 2>&1 || true)"
for hidden in "$MINIO_VIDEO_BUCKET" "$MINIO_THUMBNAIL_BUCKET"; do
    case "$enum_out" in
        *"$hidden"*)
            die "LEAK: bucket enumeration exposed '${hidden}' to ${MINIO_AUTH_ACCESS_KEY}"
            ;;
    esac
done
log "denied (as expected): enumeration hides ${MINIO_VIDEO_BUCKET} + ${MINIO_THUMBNAIL_BUCKET}"

# Both public-image buckets must round trip, not just avatars - covers was
# added later and an untested second bucket is exactly how a policy gap hides.
for own in "$MINIO_AVATAR_BUCKET" "$MINIO_COVER_BUCKET"; do
    printf '\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\x0aIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\x0d\x0a\x2d\xb4\x00\x00\x00\x00IEND\xaeB\x60\x82' > /tmp/probe.png
    if mc cp /tmp/probe.png "scoped/${own}/provisioning-check/probe.png" >/dev/null 2>&1 \
        && mc stat "scoped/${own}/provisioning-check/probe.png" >/dev/null 2>&1 \
        && mc cp "scoped/${own}/provisioning-check/probe.png" /tmp/roundtrip.png >/dev/null 2>&1 \
        && cmp -s /tmp/probe.png /tmp/roundtrip.png \
        && mc rm "scoped/${own}/provisioning-check/probe.png" >/dev/null 2>&1; then
        log "allowed (as expected): put/stat/get/delete round trip in ${own}"
    else
        die "scoped account cannot complete an object round trip in ${own} - uploads to that bucket would break"
    fi
done

# The write-denial checks below need a real source file. Recreate it here
# rather than relying on the loop's cleanup: if the file were missing, `mc cp`
# would fail for the wrong reason (no such file) and the check would report a
# false PASS. This is the same trap as the `head -1` exit-code bug - a check
# that fails for an unrelated reason is worse than no check at all.
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\x0aIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\x0d\x0a\x2d\xb4\x00\x00\x00\x00IEND\xaeB\x60\x82' > /tmp/probe.png
[ -s /tmp/probe.png ] || die "could not create the probe file - denial checks would be meaningless"

verify_denied "read the private video bucket" \
    mc ls "scoped/${MINIO_VIDEO_BUCKET}"
verify_denied "write into the private video bucket" \
    mc cp /tmp/probe.png "scoped/${MINIO_VIDEO_BUCKET}/evil.png"
verify_denied "read the private thumbnails bucket" \
    mc ls "scoped/${MINIO_THUMBNAIL_BUCKET}"
verify_denied "write into the private thumbnails bucket" \
    mc cp /tmp/probe.png "scoped/${MINIO_THUMBNAIL_BUCKET}/evil.png"
verify_denied "create a new bucket" \
    mc mb "scoped/should-never-exist"
verify_denied "delete the avatars bucket" \
    mc rb "scoped/${MINIO_AVATAR_BUCKET}"
verify_denied "delete the covers bucket" \
    mc rb "scoped/${MINIO_COVER_BUCKET}"
verify_denied "change the avatars bucket policy" \
    mc anonymous set download "scoped/${MINIO_AVATAR_BUCKET}"
verify_denied "change the covers bucket policy" \
    mc anonymous set download "scoped/${MINIO_COVER_BUCKET}"
verify_denied "read the IAM admin API" \
    mc admin user info local "$MINIO_ROOT_USER"

# ============================================================================
# 4b. The TRANSCODE service account
# ============================================================================
#
# Separate from `MINIO_AUTH_ACCESS_KEY` on purpose, and NOT a reuse of it.
#
# `transcoding-service` was running on `MINIO_ROOT_USER` - the full-storage
# takeover credential - in the one service that reads every user's source video
# and writes HLS renditions. It had the widest key of anything in the stack.
#
# It cannot share the auth-service account either: that account is scoped to
# `avatars` and `covers`, and granting it `video` would put source media in the
# hands of the service that mints profile-image URLs. Least privilege means the
# transcoder gets its OWN account, scoped to the one bucket it needs and
# provably nothing else.
TRANSCODE_POLICY_NAME="${MINIO_TRANSCODE_POLICY_NAME:-wideo11-transcode-video}"
TRANSCODE_POLICY_FILE="${MINIO_TRANSCODE_POLICY_FILE:-/policies/transcode-video.json}"

if [ -z "${MINIO_TRANSCODE_ACCESS_KEY:-}" ] || [ -z "${MINIO_TRANSCODE_SECRET_KEY:-}" ]; then
    die "MINIO_TRANSCODE_ACCESS_KEY / MINIO_TRANSCODE_SECRET_KEY are required.
      transcoding-service will NOT be given MINIO_ROOT credentials - a service that
      reads every user's source media does not need storage-wide access.
      Generate a secret with: openssl rand -base64 32 | tr -d '/+='"
fi

if [ ! -f "$TRANSCODE_POLICY_FILE" ]; then
    die "policy file not found: ${TRANSCODE_POLICY_FILE}"
fi

if mc admin policy create local "$TRANSCODE_POLICY_NAME" "$TRANSCODE_POLICY_FILE" >/dev/null 2>&1; then
    log "policy applied: ${TRANSCODE_POLICY_NAME}"
else
    die "could not create policy ${TRANSCODE_POLICY_NAME} from ${TRANSCODE_POLICY_FILE}"
fi

# Unconditional, for the same reason as the auth account: it is what makes a
# secret rotation in .env actually PUSH the new value to MinIO.
if out="$(mc admin user add local "$MINIO_TRANSCODE_ACCESS_KEY" "$MINIO_TRANSCODE_SECRET_KEY" 2>&1)"; then
    log "transcode IAM user ready: ${MINIO_TRANSCODE_ACCESS_KEY}"
else
    die "could not create/refresh transcode IAM user: ${out}"
fi

if mc admin user info local "$MINIO_TRANSCODE_ACCESS_KEY" 2>/dev/null | grep -q "$TRANSCODE_POLICY_NAME"; then
    log "policy already attached (idempotent): ${TRANSCODE_POLICY_NAME}"
elif mc admin policy attach local "$TRANSCODE_POLICY_NAME" --user "$MINIO_TRANSCODE_ACCESS_KEY" >/dev/null 2>&1; then
    log "policy attached to ${MINIO_TRANSCODE_ACCESS_KEY}"
else
    die "could not attach ${TRANSCODE_POLICY_NAME} to ${MINIO_TRANSCODE_ACCESS_KEY}"
fi

# ============================================================================
# 5b. Prove the TRANSCODE account is restricted
# ============================================================================
#
# Same reasoning as the auth account's denials, and it matters more here. A
# transcode account that could read `avatars`, or delete a bucket, would be a
# quieter problem than the auth one: nothing would look wrong until it was used.
#
# Asserted by ATTEMPTING and expecting denial, not by reading the policy back -
# the policy is the intent, the denial is the behaviour.
#
# The alias is set under an explicit guard because this script runs `set -eu`:
# an unguarded `mc alias set ... >/dev/null 2>&1` that failed would kill the
# whole container with NO message, which is exactly what happened - the init
# exited 1 having printed nothing after "policy attached".
# `MINIO_ENDPOINT` ALREADY carries the scheme (`http://minio:9000`), exactly as
# the `local` and `scoped` aliases above use it. Prefixing another `http://` here
# produced `http://http://minio:9000` and mc rejected it - which is the kind of
# error that is invisible until something like this guard prints it.
if ! out="$(mc alias set transcode "$MINIO_ENDPOINT" "$MINIO_TRANSCODE_ACCESS_KEY" "$MINIO_TRANSCODE_SECRET_KEY" 2>&1)"; then
    die "could not authenticate the transcode account against ${MINIO_ENDPOINT}: ${out}"
fi

verify_denied_transcode() {
    desc="$1"
    shift
    if "$@" >/dev/null 2>&1; then
        die "SECURITY: the transcode account CAN $desc. Its policy is too broad - fix"
    fi
    log "denied as expected: $desc"
}

verify_denied_transcode "read the avatars bucket" \
    mc ls "transcode/${MINIO_AVATAR_BUCKET}"
verify_denied_transcode "write into the avatars bucket" \
    mc cp /tmp/probe.png "transcode/${MINIO_AVATAR_BUCKET}/evil.png"
verify_denied_transcode "read the covers bucket" \
    mc ls "transcode/${MINIO_COVER_BUCKET}"
verify_denied_transcode "write into the covers bucket" \
    mc cp /tmp/probe.png "transcode/${MINIO_COVER_BUCKET}/evil.png"
verify_denied_transcode "read the thumbnails bucket" \
    mc ls "transcode/${MINIO_THUMBNAIL_BUCKET}"
verify_denied_transcode "create a new bucket" \
    mc mb "transcode/should-never-exist"
verify_denied_transcode "delete the video bucket" \
    mc rb "transcode/${MINIO_VIDEO_BUCKET}"
verify_denied_transcode "change the video bucket policy" \
    mc anonymous set download "transcode/${MINIO_VIDEO_BUCKET}"
verify_denied_transcode "read the IAM admin API" \
    mc admin user info local "$MINIO_ROOT_USER"
# so it can only be removed once every check has run.
rm -f /tmp/probe.png /tmp/roundtrip.png

# Clean up if the "create a new bucket" check somehow succeeded before dying.
mc rb --force "scoped/should-never-exist" >/dev/null 2>&1 || true

# ============================================================================
# 6. Summary
# ============================================================================
log "------------------------------------------------------------"
log "buckets:      ${MINIO_VIDEO_BUCKET} (private), ${MINIO_THUMBNAIL_BUCKET} (private)"
log "              ${MINIO_AVATAR_BUCKET} (public-read), ${MINIO_COVER_BUCKET} (public-read)"
log "scoped user:  ${MINIO_AUTH_ACCESS_KEY}  policy=${AUTH_POLICY_NAME}"
log "root creds:   provisioning only — do not hand these to a service"
log "------------------------------------------------------------"
log "storage provisioned successfully"

exit 0
