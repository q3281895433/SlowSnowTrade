#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"
ARCH="${1:-x86_64}"
case "$ARCH" in
  x86_64) ARCH_FLAGS=(-arch x86_64); APP="$ROOT/build/SlowSnowTrade.app" ;;
  arm64) ARCH_FLAGS=(-arch arm64); APP="$ROOT/build/arm64/SlowSnowTrade.app" ;;
  universal) ARCH_FLAGS=(-arch x86_64 -arch arm64); APP="$ROOT/build/universal/SlowSnowTrade.app" ;;
  *) echo 'Usage: bash build-mac.sh [x86_64|arm64|universal]' >&2; exit 1 ;;
esac
CONTENTS="$APP/Contents"
RESOURCES="$CONTENTS/Resources"
MACOS="$CONTENTS/MacOS"

mkdir -p "$RESOURCES" "$MACOS" "$RESOURCES/assets"
cp "$ROOT/SlowSnowTrade/Web/index.html" "$ROOT/SlowSnowTrade/Web/styles.css" \
   "$ROOT/SlowSnowTrade/Web/app.js" "$ROOT/SlowSnowTrade/Web/trading.js" \
   "$ROOT/SlowSnowTrade/Web/chart.js" "$ROOT/SlowSnowTrade/Web/indicators.js" \
   "$ROOT/SlowSnowTrade/Web/window-manager.js" "$ROOT/SlowSnowTrade/Web/agent-analysis.js" "$RESOURCES/"
cp "$ROOT/SlowSnowTrade/Agent/review-system-prompt.txt" "$RESOURCES/"
cp "$ROOT/SlowSnowTrade/Web/assets/snowflakes.svg" "$RESOURCES/assets/"
cp "$ROOT/SlowSnowTrade/Web/assets/app-icon.png" "$RESOURCES/assets/"
rm -f "$RESOURCES/assets/snow-night.png"

ICONSET="$ROOT/build/AppIcon.iconset"
mkdir -p "$ICONSET"
for SIZE in 16 32 128 256 512; do
  sips -z "$SIZE" "$SIZE" "$ROOT/SlowSnowTrade/Web/assets/app-icon.png" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null
  RETINA_SIZE=$((SIZE * 2))
  sips -z "$RETINA_SIZE" "$RETINA_SIZE" "$ROOT/SlowSnowTrade/Web/assets/app-icon.png" --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RESOURCES/AppIcon.icns"

clang -fobjc-arc "${ARCH_FLAGS[@]}" -mmacosx-version-min=13.0 \
  -isysroot "$SDK_PATH" \
  -framework Cocoa -framework WebKit -framework Security \
  "$ROOT/SlowSnowTrade/Native/main.m" \
  -o "$MACOS/SlowSnowTrade"

cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>SlowSnowTrade</string>
    <key>CFBundleIdentifier</key><string>com.local.papertrade</string>
    <key>CFBundleName</key><string>SlowSnowTrade</string>
    <key>CFBundleDisplayName</key><string>SlowSnowTrade</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.6.1</string>
    <key>CFBundleVersion</key><string>9</string>
    <key>CFBundleIconFile</key><string>AppIcon.icns</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>LSApplicationCategoryType</key><string>public.app-category.finance</string>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP"
echo "Built $APP for $ARCH."
