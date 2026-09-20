#!/usr/bin/env bash
# Portal Protocol — release + publish update (R2-hosted, self-updater compatible)
#
# What this does:
#   1. bump version in src-tauri/tauri.conf.json   (pass new version as $1)
#   2. tauri build -> signs NSIS .exe (emits .exe.sig); script authors latest.json
#   3. upload latest.json + .exe.sig + .exe  to your Cloudflare R2 public bucket
#
# Prerequisites (one-time):
#   - Cloudflare R2 bucket created + made PUBLIC, e.g. "portal-protocol-updates"
#   - R2 API token (Administrator Read & Write, or custom R2 token with Edit)
#       -> gives CLOUDFLARE_API_TOKEN (wrangler uses this to push objects)
#   - `npx wrangler` available (runs via npm, no global install needed)
#   - Signing key present at src-tauri/keys/portal_protocol.key  (gitignored)
#
# Get your public endpoint from Cloudflare dashboard:
#   R2 -> <bucket> -> Settings -> "Public development URL" (enable public access first)
#   It looks like: https://<bucket>.r2.dev  (or a custom domain you set)
#   The endpoint in tauri.conf.json is that base + "/Portal-Protocol/latest.json"
#
# Usage:
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD=portalprotocol \
#   CLOUDFLARE_R2_BUCKET=portal-protocol-updates \
#   CLOUDFLARE_ACCOUNT_ID=your-account-id \
#   ./scripts/release-update.sh 0.3.0
#
# Set env for wrangler (R2 token) — see https://developers.cloudflare.com/r2/api/s3/api-tokens/
#   export CLOUDFLARE_API_TOKEN=...   (or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY for S3-style)
set -euo pipefail

NEW_VER="${1:-}"
if [ -z "$NEW_VER" ]; then
  echo "Usage: $0 <new-version>   e.g. $0 0.3.0" >&2
  exit 1
fi

# --- locate repo root (script lives in <repo>/scripts) ---
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- required env ---
: "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:?set TAURI_SIGNING_PRIVATE_KEY_PASSWORD (key password)}"
: "${CLOUDFLARE_R2_BUCKET:?set CLOUDFLARE_R2_BUCKET (R2 bucket name)}"
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID (Cloudflare account id)}"

# Signing key (gitignored). Tauri v2 wants the KEY CONTENT in
# TAURI_SIGNING_PRIVATE_KEY, not the -PATH variant.
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$ROOT/src-tauri/keys/portal_protocol.key")"

echo "==> Bumping version to $NEW_VER"
# crude but safe: replace the single "version": "x.y.z" in tauri.conf.json
node -e "const fs=require('fs');const p='src-tauri/tauri.conf.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version='$NEW_VER';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"

echo "==> Building (release) — this signs the installer (emits .exe.sig)"
export PATH="$PATH:$HOME/.cargo/bin"
npx tauri build

BUNDLE="src-tauri/target/release/bundle"
EXE=$(ls "$BUNDLE"/nsis/Portal*Protocol*"$NEW_VER"_x64-setup.exe 2>/dev/null | head -1)
SIG="$EXE.sig"
LATEST="$BUNDLE/nsis/latest.json"

[ -f "$EXE" ] || { echo "ERROR: installer not found at $BUNDLE/nsis/" >&2; exit 1; }
[ -f "$SIG" ] || { echo "ERROR: signature $SIG not found (signing failed?)" >&2; exit 1; }

# Tauri v2 CLI (2.11.x) emits the .sig but NOT latest.json — author it
# deterministically from the signature + the R2 endpoint base.
# NOTE: always re-author latest.json. Guarding on file-existence is a bug:
# on a 2nd publish the stale file from the previous run persists, so the old
# version number gets re-uploaded and clients think they're "on the latest".
echo "==> Authoring latest.json from signature"
node -e "
    const fs=require('fs');
    const cfg=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
    const endpoint=cfg.plugins.updater.endpoints[0];
    const base=endpoint.replace(/\/latest\.json$/,'');
    const sig=fs.readFileSync('$SIG','utf8').trim();
    const exe='$(basename "$EXE")';
    const out={version:'$NEW_VER',notes:'Portal Protocol $NEW_VER',pub_date:new Date().toISOString(),
      platforms:{'windows-x86_64':{signature:sig,url:base+'/'+exe}}};
    fs.writeFileSync('$LATEST', JSON.stringify(out,null,2)+'\n');
  "
[ -f "$LATEST" ] || { echo "ERROR: latest.json not created" >&2; exit 1; }

# --- signature guard: the key that SIGNED the installer must match the pubkey
# the app SHIPS (tauri.conf.json). A mismatch means every client rejects the
# update at install time — the silent bug that shipped 0.1.0-0.4.5. Abort here.
echo "==> Verifying signature keyid matches embedded pubkey"
node -e "
  const fs=require('fs');
  // minisign keyid = bytes[2..10] of the base64 body line (after the comment)
  const keyid=(b64)=>{
    const txt=Buffer.from(b64.trim(),'base64').toString('utf8');
    const body=txt.split('\n').find(l=>l.trim()&&!/^(un)?trusted comment:/.test(l));
    return Buffer.from(body,'base64').subarray(2,10).toString('hex');
  };
  const sigId=keyid(fs.readFileSync('$SIG','utf8'));
  const pubId=keyid(JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8')).plugins.updater.pubkey);
  if(sigId!==pubId){
    console.error('ERROR: signing key ('+sigId+') != app pubkey ('+pubId+').');
    console.error('Clients would reject this update. Re-key or fix the signing key; NOT uploading.');
    process.exit(1);
  }
  console.log('    ok: keyid '+sigId+' matches');
"

PREFIX="Portal-Protocol"   # folder inside the bucket; endpoint = https://<pub>/$PREFIX/latest.json

echo "==> Uploading to R2 bucket '$CLOUDFLARE_R2_BUCKET' (prefix $PREFIX)"
# wrangler makes the bucket programmatically reachable via S3-compatible endpoint.
npx wrangler r2 object put "$CLOUDFLARE_R2_BUCKET/$PREFIX/latest.json" --file "$LATEST" --remote
npx wrangler r2 object put "$CLOUDFLARE_R2_BUCKET/$PREFIX/$(basename "$SIG")" --file "$SIG" --remote
npx wrangler r2 object put "$CLOUDFLARE_R2_BUCKET/$PREFIX/$(basename "$EXE")" --file "$EXE" --remote

echo ""
echo "==> Published $NEW_VER"
echo "    Endpoint (set in tauri.conf.json 'plugins.updater.endpoints'):"
echo "    https://<YOUR-R2-PUBLIC-URL>/$PREFIX/latest.json"
echo "    Friends' apps will pick this up on next launch."
