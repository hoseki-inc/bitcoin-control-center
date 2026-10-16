#!/usr/bin/env bash
set -euo pipefail

# A configured signer must never silently fall back to a temporary key.
if [[ -z "$STARTOS_DEV_KEY" && -n "$STARTOS_SIGNER_PUBKEY" ]]; then
  echo "::error::STARTOS_SIGNER_PUBKEY is configured but STARTOS_DEV_KEY is missing."
  exit 1
fi
EXPECTED_PUBKEY="$(printf '%s' "$STARTOS_SIGNER_PUBKEY" | tr '[:upper:]' '[:lower:]')"
if [[ -n "$STARTOS_DEV_KEY" && ! "$EXPECTED_PUBKEY" =~ ^[0-9a-f]{64}$ ]]; then
  echo "::error::Set STARTOS_SIGNER_PUBKEY to the 64-character hex Ed25519 public key of STARTOS_DEV_KEY."
  exit 1
fi

umask 077
WORKSPACE="$(mktemp -d "$RUNNER_TEMP/startos-signing.XXXXXX")"
trap 'rm -rf "$WORKSPACE"' EXIT
mkdir -m 700 "$WORKSPACE/.startos"
KEY="$WORKSPACE/.startos/build.key.pem"

start-cli s9pk inspect "$UNSIGNED" commitment > /dev/null
start-cli s9pk inspect "$UNSIGNED" manifest | jq -S . > "$WORKSPACE/unsigned-manifest.json"

if [[ -z "$STARTOS_DEV_KEY" ]]; then
  # Generate with start-cli itself so rehearsals exercise its PKCS#8 v2 key format.
  start-cli --id-key-path "$KEY" init-key > /dev/null
  MODE="temporary clean-install key"
else
  printf '%s' "$STARTOS_DEV_KEY" > "$KEY"
  MODE="permanent signing key"
fi
chmod 600 "$KEY"

# start-cli understands its private-key format, including PKCS#8 v2. Decode only the
# public PEM wrapper here; older OpenSSL private-key readers reject valid StartOS keys.
KEY_PUBKEY="$(start-cli --id-key-path "$KEY" pubkey | sed '/^-----/d' | base64 --decode | tail -c 32 | od -An -tx1 -v | tr -d ' \n')"
if [[ ! "$KEY_PUBKEY" =~ ^[0-9a-f]{64}$ ]]; then
  echo "::error::Could not read the StartOS signing public key."
  exit 1
fi
if [[ -n "$EXPECTED_PUBKEY" && "$KEY_PUBKEY" != "$EXPECTED_PUBKEY" ]]; then
  echo "::error::STARTOS_DEV_KEY does not match STARTOS_SIGNER_PUBKEY."
  exit 1
fi

mkdir -p "$(dirname "$SIGNED")"
cp "$UNSIGNED" "$SIGNED"
# start-cli (verified with 2.3.0) re-signs when editing the manifest. The identity
# expression preserves the manifest, and the workspace selects our signing key.
(cd "$WORKSPACE" && start-cli s9pk edit "$SIGNED" manifest '.' > /dev/null)

start-cli s9pk inspect "$SIGNED" commitment > /dev/null
start-cli s9pk inspect "$SIGNED" manifest | jq -S . > "$WORKSPACE/signed-manifest.json"
if ! cmp -s "$WORKSPACE/unsigned-manifest.json" "$WORKSPACE/signed-manifest.json"; then
  echo "::error::Signing changed the package manifest."
  exit 1
fi

# Check the signature's public key for temporary and permanent signing alike.
# The header is a 3-byte magic and version, followed by the 32-byte public key.
SIGNER="$(od -An -tx1 -v -j 3 -N 32 "$SIGNED" | tr -d ' \n')"
if [[ "$SIGNER" != "$KEY_PUBKEY" ]]; then
  echo "::error::The package is not signed by the selected StartOS key."
  exit 1
fi

echo "mode=$MODE" >> "$GITHUB_OUTPUT"
if [[ "$MODE" == "temporary clean-install key" ]]; then
  echo "::warning::This package was re-signed with a fresh temporary key for clean-install testing, not signer-continuous upgrades or StartOS registry publication."
fi
