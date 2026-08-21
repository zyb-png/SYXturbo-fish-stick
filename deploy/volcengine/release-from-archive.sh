#!/usr/bin/env sh
set -eu

APP_DIR=${APP_DIR:-/opt/manfei-seedance}
SERVICE_NAME=${SERVICE_NAME:-manfei-seedance}
ARCHIVE=${1:-}

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 用户运行此脚本。"
  exit 1
fi

if [ -z "$ARCHIVE" ]; then
  echo "用法：sh deploy/volcengine/release-from-archive.sh /tmp/manfei-seedance.tar.gz"
  exit 1
fi

if [ ! -f "$ARCHIVE" ]; then
  echo "找不到打包文件：$ARCHIVE"
  exit 1
fi

TMP_DIR=$(mktemp -d /tmp/manfei-release-XXXXXX)
tar -xzf "$ARCHIVE" -C "$TMP_DIR"

mkdir -p "$APP_DIR"
cp "$TMP_DIR/index.html" "$APP_DIR/index.html"
cp "$TMP_DIR/admin.html" "$APP_DIR/admin.html"
cp "$TMP_DIR/app.js" "$APP_DIR/app.js"
cp "$TMP_DIR/admin.js" "$APP_DIR/admin.js"
cp "$TMP_DIR/styles.css" "$APP_DIR/styles.css"
cp "$TMP_DIR/server.mjs" "$APP_DIR/server.mjs"
cp "$TMP_DIR/package.json" "$APP_DIR/package.json"
cp "$TMP_DIR/package-lock.json" "$APP_DIR/package-lock.json"

cd "$APP_DIR"
npm ci --omit=dev
systemctl restart "$SERVICE_NAME.service"
systemctl is-active "$SERVICE_NAME.service"

rm -rf "$TMP_DIR"
