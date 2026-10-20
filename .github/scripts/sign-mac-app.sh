#!/usr/bin/env bash
set -euo pipefail

# Re-signs the app inside an ad-hoc Mac installer with a Developer ID, notarizes and staples the app
# and the disk image, and checks that Gatekeeper accepts both. Without a certificate, it passes the
# ad-hoc installer through unchanged unless REQUIRE_DEVELOPER_ID is true.
#
# Locally, MAC_SIGN_WITH_LOGIN_KEYCHAIN=true signs with the Developer ID already in your keychain,
# and SKIP_NOTARIZATION=true stops after signing.

APP_NAME='Bitcoin Control Center.app'
CSC_LINK="${CSC_LINK:-}"
CSC_KEY_PASSWORD="${CSC_KEY_PASSWORD:-}"
APPLE_API_KEY_P8="${APPLE_API_KEY_P8:-}"
APPLE_API_KEY_ID="${APPLE_API_KEY_ID:-}"
APPLE_API_ISSUER="${APPLE_API_ISSUER:-}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"
REQUIRE_DEVELOPER_ID="${REQUIRE_DEVELOPER_ID:-false}"
MAC_SIGN_WITH_LOGIN_KEYCHAIN="${MAC_SIGN_WITH_LOGIN_KEYCHAIN:-false}"
SKIP_NOTARIZATION="${SKIP_NOTARIZATION:-false}"
# Keep the secrets out of the environment of every tool this script runs.
export -n CSC_LINK CSC_KEY_PASSWORD APPLE_API_KEY_P8
OUTPUT="${GITHUB_OUTPUT:-/dev/null}"
# Apple's Developer ID G2 intermediate, which links the certificate to Apple's root.
INTERMEDIATE_URL='https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer'
INTERMEDIATE_SHA256='f16cd3c54c7f83cea4bf1a3e6a0819c8aaa8e4a1528fd144715f350643d2df3a'

if [[ -z "$CSC_LINK" && "$MAC_SIGN_WITH_LOGIN_KEYCHAIN" != true ]]; then
  # A configured signer must never silently fall back to an ad-hoc signature.
  if [[ -n "$APPLE_TEAM_ID" || "$REQUIRE_DEVELOPER_ID" == true ]]; then
    echo "::error::A Developer ID signature is required, but CSC_LINK is missing."
    exit 1
  fi
  mkdir -p "$(dirname "$SIGNED_DMG")"
  cp "$UNSIGNED_DMG" "$SIGNED_DMG"
  {
    echo "mode=ad-hoc; not notarized"
    echo "notarized=false"
  } >> "$OUTPUT"
  echo "::warning::No Developer ID is configured, so the Mac installer keeps its ad-hoc signature and macOS will block it."
  exit 0
fi

if [[ ! "$APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "::error::Set APPLE_TEAM_ID to the 10-character Apple Team ID of the Developer ID certificate."
  exit 1
fi
if [[ "$SKIP_NOTARIZATION" != true && ( -z "$APPLE_API_KEY_P8" || -z "$APPLE_API_KEY_ID" || -z "$APPLE_API_ISSUER" ) ]]; then
  echo "::error::Notarization needs APPLE_API_KEY_P8, APPLE_API_KEY_ID, and APPLE_API_ISSUER."
  exit 1
fi

umask 077
WORKSPACE="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/mac-signing.XXXXXX")"
KEYCHAIN=''
ORIGINAL_KEYCHAINS=()
MOUNTS=()
cleanup() {
  for mount in ${MOUNTS[@]+"${MOUNTS[@]}"}; do
    hdiutil detach "$mount" -force > /dev/null 2>&1 || true
  done
  if [[ -n "$KEYCHAIN" ]]; then
    security list-keychains -d user -s ${ORIGINAL_KEYCHAINS[@]+"${ORIGINAL_KEYCHAINS[@]}"} || true
    security delete-keychain "$KEYCHAIN" || true
  fi
  rm -rf "$WORKSPACE"
}
trap cleanup EXIT

# Copy the app out of the read-only installer before any key is loaded.
UNSIGNED_MOUNT="$WORKSPACE/unsigned"
mkdir "$UNSIGNED_MOUNT"
hdiutil attach "$UNSIGNED_DMG" -readonly -nobrowse -noautoopen -mountpoint "$UNSIGNED_MOUNT" > /dev/null
MOUNTS+=("$UNSIGNED_MOUNT")
APP="$WORKSPACE/$APP_NAME"
ditto "$UNSIGNED_MOUNT/$APP_NAME" "$APP"
hdiutil detach "$UNSIGNED_MOUNT" > /dev/null
MOUNTS=()

if [[ "$MAC_SIGN_WITH_LOGIN_KEYCHAIN" != true ]]; then
  # A throwaway keychain holds the certificate only for this run.
  KEYCHAIN="$WORKSPACE/signing.keychain-db"
  KEYCHAIN_PASSWORD="$(openssl rand -hex 24)"
  while IFS= read -r keychain; do
    ORIGINAL_KEYCHAINS+=("$(sed -E 's/^[[:space:]]*"(.*)"$/\1/' <<< "$keychain")")
  done < <(security list-keychains -d user)
  security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
  security set-keychain-settings -lut 21600 "$KEYCHAIN"
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
  printf '%s' "$CSC_LINK" | base64 --decode > "$WORKSPACE/certificate.p12"
  security import "$WORKSPACE/certificate.p12" -k "$KEYCHAIN" -P "$CSC_KEY_PASSWORD" -x -T /usr/bin/codesign > /dev/null
  rm "$WORKSPACE/certificate.p12"
  curl -fsSL "$INTERMEDIATE_URL" -o "$WORKSPACE/DeveloperIDG2CA.cer"
  echo "$INTERMEDIATE_SHA256  $WORKSPACE/DeveloperIDG2CA.cer" | shasum -a 256 --check --status
  security import "$WORKSPACE/DeveloperIDG2CA.cer" -k "$KEYCHAIN" > /dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" > /dev/null
  security list-keychains -d user -s "$KEYCHAIN" ${ORIGINAL_KEYCHAINS[@]+"${ORIGINAL_KEYCHAINS[@]}"}
fi

# Select by certificate hash, so codesign can't pick a different identity with a similar name.
IDENTITY="$(security find-identity -v -p codesigning ${KEYCHAIN:+"$KEYCHAIN"} |
  awk -v team="($APPLE_TEAM_ID)\"" '/"Developer ID Application: / && index($0, team) { print $2; exit }')"
if [[ ! "$IDENTITY" =~ ^[0-9A-F]{40}$ ]]; then
  echo "::error::No valid Developer ID Application certificate for team $APPLE_TEAM_ID was found."
  exit 1
fi

sign() {
  codesign --force --timestamp --sign "$IDENTITY" ${KEYCHAIN:+--keychain "$KEYCHAIN"} "$@"
}

notarize() {
  local file="$1" result status id
  # The key and issuer are passed by file and argument, never printed.
  result="$(xcrun notarytool submit "$file" --key "$WORKSPACE/notary.p8" --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER" --wait --timeout 60m --output-format json)" || true
  status="$(jq -r '.status // empty' <<< "$result" 2> /dev/null || true)"
  id="$(jq -r '.id // empty' <<< "$result" 2> /dev/null || true)"
  if [[ "$status" != Accepted ]]; then
    # A new Apple team's first submissions can take over an hour; later ones take minutes.
    echo "::error::Apple notarization of $(basename "$file") ended with status '${status:-unknown}': $(jq -r '.message // empty' <<< "$result" 2> /dev/null || true)"
    if [[ -n "$id" ]]; then
      xcrun notarytool log "$id" --key "$WORKSPACE/notary.p8" --key-id "$APPLE_API_KEY_ID" \
        --issuer "$APPLE_API_ISSUER" || true
    fi
    exit 1
  fi
  echo "Apple notarized $(basename "$file") (submission $id)."
}

# Sign from the inside out: every Mach-O file, deepest first, then nested frameworks and helper apps,
# then the app itself. Executables get the hardened runtime and the app's entitlements.
while IFS= read -r file; do
  kind="$(file -b "$file")"
  if [[ "$kind" == *'Mach-O'*'executable'* ]]; then
    sign --options runtime --entitlements "$ENTITLEMENTS" "$file"
  elif [[ "$kind" == *'Mach-O'* ]]; then
    sign "$file"
  fi
done < <(find "$APP/Contents" -type f | awk -F/ '{ print NF "\t" $0 }' | sort -rn | cut -f2-)
while IFS= read -r bundle; do
  if [[ "$bundle" == *.app ]]; then
    sign --options runtime --entitlements "$ENTITLEMENTS" "$bundle"
  else
    sign "$bundle"
  fi
done < <(find "$APP/Contents" -depth -type d \( -name '*.framework' -o -name '*.app' \))
sign --options runtime --entitlements "$ENTITLEMENTS" "$APP"

codesign --verify --deep --strict "$APP"
DETAILS="$(codesign --display --verbose=2 "$APP" 2>&1)"
if ! grep -Fxq "TeamIdentifier=$APPLE_TEAM_ID" <<< "$DETAILS" || ! grep -q 'flags=.*(runtime)' <<< "$DETAILS"; then
  echo "::error::The app is not signed by team $APPLE_TEAM_ID with the hardened runtime."
  exit 1
fi

if [[ "$SKIP_NOTARIZATION" != true ]]; then
  printf '%s' "$APPLE_API_KEY_P8" > "$WORKSPACE/notary.p8"
  # Staple the app as well as the disk image, so the copy in Applications opens offline too.
  ditto -c -k --keepParent "$APP" "$WORKSPACE/app.zip"
  notarize "$WORKSPACE/app.zip"
  xcrun stapler staple -q "$APP"
  xcrun stapler validate -q "$APP"
fi

# Swap the signed app into a writable copy of the installer, keeping its window layout.
WRITABLE="$WORKSPACE/writable.dmg"
hdiutil convert "$UNSIGNED_DMG" -format UDRW -o "$WRITABLE" > /dev/null
SECTORS="$(hdiutil resize -limits "$WRITABLE" | awk '{ print $2 }')"
hdiutil resize -sectors "$((SECTORS + 262144))" "$WRITABLE" > /dev/null
WRITABLE_MOUNT="$WORKSPACE/writable"
mkdir "$WRITABLE_MOUNT"
hdiutil attach "$WRITABLE" -readwrite -nobrowse -noautoopen -mountpoint "$WRITABLE_MOUNT" > /dev/null
MOUNTS+=("$WRITABLE_MOUNT")
rm -rf "${WRITABLE_MOUNT:?}/$APP_NAME"
ditto "$APP" "$WRITABLE_MOUNT/$APP_NAME"
hdiutil detach "$WRITABLE_MOUNT" > /dev/null
MOUNTS=()
mkdir -p "$(dirname "$SIGNED_DMG")"
rm -f "$SIGNED_DMG"
hdiutil convert "$WRITABLE" -format UDZO -imagekey zlib-level=9 -o "$SIGNED_DMG" > /dev/null
sign "$SIGNED_DMG"
codesign --verify --strict "$SIGNED_DMG"

if [[ "$SKIP_NOTARIZATION" == true ]]; then
  {
    echo "mode=Developer ID ($APPLE_TEAM_ID); not notarized"
    echo "notarized=false"
  } >> "$OUTPUT"
  echo "::warning::Signed with Developer ID but not notarized, so macOS will still block the installer."
  exit 0
fi

notarize "$SIGNED_DMG"
xcrun stapler staple -q "$SIGNED_DMG"
xcrun stapler validate -q "$SIGNED_DMG"
spctl --assess --type open --context context:primary-signature -vv "$SIGNED_DMG" 2>&1 | tee "$WORKSPACE/dmg-assessment"
grep -q 'source=Notarized Developer ID' "$WORKSPACE/dmg-assessment"
spctl --assess --type execute -vv "$APP" 2>&1 | tee "$WORKSPACE/app-assessment"
grep -q 'source=Notarized Developer ID' "$WORKSPACE/app-assessment"

{
  echo "mode=Developer ID ($APPLE_TEAM_ID); notarized and stapled"
  echo "notarized=true"
} >> "$OUTPUT"
