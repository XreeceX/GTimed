#!/bin/sh
# Copy-paste:
#   curl -fsSL https://raw.githubusercontent.com/XreeceX/GTimed/master/scripts/install.sh | sh
set -eu

REPO="${GTIMED_REPO:-XreeceX/GTimed}"
REF="${GTIMED_INSTALL_REF:-master}"

if ! command -v node >/dev/null 2>&1; then
  echo "GTimed needs Node.js 18 or newer."
  echo "Install it from https://nodejs.org then paste this command again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "GTimed needs npm (it comes with Node.js)."
  echo "Install Node from https://nodejs.org then paste this command again."
  exit 1
fi

URL="https://raw.githubusercontent.com/${REPO}/${REF}/scripts/install.mjs"
TMP="${TMPDIR:-/tmp}/gtimed-bootstrap-$$"
mkdir -p "$TMP"
# shellcheck disable=SC2064
trap 'rm -rf "$TMP"' EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$TMP/install.mjs"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TMP/install.mjs" "$URL"
else
  echo "Need curl or wget to download the installer."
  exit 1
fi

echo "Installing GTimed from GitHub (${REPO}@${REF})..."
exec node "$TMP/install.mjs" "$@"
