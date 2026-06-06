#!/usr/bin/env sh
set -eu

APP_DIR=${APP_DIR:-/opt/manfei-seedance}
REPO_URL=${REPO_URL:-https://github.com/zyb-png/SYXturbo-fish-stick.git}

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 用户运行此脚本。"
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl git
  curl -fsSL https://get.docker.com | sh
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y ca-certificates curl git docker
  systemctl enable --now docker
elif command -v yum >/dev/null 2>&1; then
  yum install -y ca-certificates curl git docker
  systemctl enable --now docker
else
  echo "暂不支持此 Linux 发行版。"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose 插件不可用，请安装后重新运行。"
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
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "已创建 $APP_DIR/.env，请填写配置后运行："
  echo "cd $APP_DIR && docker compose up -d --build"
  exit 0
fi

cd "$APP_DIR"
docker compose up -d --build
docker compose ps

