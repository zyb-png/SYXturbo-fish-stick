#!/usr/bin/env sh
set -eu

APP_DIR=${APP_DIR:-/opt/manfei-seedance}
SERVICE_NAME=${SERVICE_NAME:-manfei-seedance}
REPO_URL=${REPO_URL:-https://github.com/zyb-png/SYXturbo-fish-stick.git}
PORT=${PORT:-80}

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 用户运行此脚本。"
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl git nodejs npm
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y ca-certificates curl git nodejs npm
elif command -v yum >/dev/null 2>&1; then
  yum install -y ca-certificates curl git nodejs npm
else
  echo "暂不支持此 Linux 发行版。"
  exit 1
fi

if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi

mkdir -p "$APP_DIR/data"
chmod 700 "$APP_DIR/data"

if [ ! -f "$APP_DIR/.env" ]; then
  if [ -f "$APP_DIR/.env.example" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  else
    cat > "$APP_DIR/.env" <<EOF
PORT=$PORT
APP_USERNAME=manfei
APP_PASSWORD=请改成强密码
MANFEI_API_BASE=
MANFEI_API_TOKEN=
APP_STATE_FILE=$APP_DIR/data/app-state.json
DB_FILE=$APP_DIR/data/manfei.sqlite
EOF
  fi
  chmod 600 "$APP_DIR/.env"
  echo "已创建 $APP_DIR/.env，请填写配置后重新运行此脚本。"
  exit 0
fi

cd "$APP_DIR"
npm ci --omit=dev

cat > "/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=Manfei Seedance Web Application
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/env node $APP_DIR/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME.service"
systemctl restart "$SERVICE_NAME.service"
systemctl --no-pager --full status "$SERVICE_NAME.service"
