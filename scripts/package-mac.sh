#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${1:-universal}"
bash "$ROOT/build-mac.sh" "$ARCH"
case "$ARCH" in
  x86_64) APP="$ROOT/build/SlowSnowTrade.app" ;;
  arm64|universal) APP="$ROOT/build/$ARCH/SlowSnowTrade.app" ;;
  *) exit 1 ;;
esac
mkdir -p "$ROOT/release"
STAGE="$(mktemp -d "${TMPDIR:-/tmp/}sst-dmg.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/SlowSnowTrade.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname SlowSnowTrade -srcfolder "$STAGE" -ov -format UDZO \
  "$ROOT/release/SlowSnowTrade-1.7.1-macOS-$ARCH.dmg"
