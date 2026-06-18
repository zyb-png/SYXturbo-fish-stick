#!/bin/bash
set -Eeuo pipefail

PORT="${PORT:-5000}"
COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"
NODE_ENV=development
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"

cd "${COZE_WORKSPACE_PATH}"

port_pids() {
    local port="$1"
    if command -v ss >/dev/null 2>&1; then
        ss -H -lntp 2>/dev/null | awk -v port="${port}" '$4 ~ ":"port"$"' | grep -o 'pid=[0-9]*' | cut -d= -f2 | paste -sd' ' - || true
        return
    fi

    if command -v lsof >/dev/null 2>&1; then
        lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | paste -sd' ' - || true
    fi
}

port_is_free() {
    [[ -z "$(port_pids "$1")" ]]
}

prepare_port() {
    if port_is_free "${DEPLOY_RUN_PORT}"; then
        echo "Port ${DEPLOY_RUN_PORT} is free."
        return
    fi

    local pids
    pids="$(port_pids "${DEPLOY_RUN_PORT}")"
    if [[ "${KILL_EXISTING_PORT:-false}" == "true" ]]; then
        echo "Port ${DEPLOY_RUN_PORT} in use by PIDs: ${pids} (SIGKILL)"
        for pid in ${pids}; do
            kill -9 "${pid}" || true
        done
        sleep 1
        if port_is_free "${DEPLOY_RUN_PORT}"; then
            echo "Port ${DEPLOY_RUN_PORT} cleared."
            return
        fi
    fi

    echo "Port ${DEPLOY_RUN_PORT} is busy; selecting the next free port."
    while ! port_is_free "${DEPLOY_RUN_PORT}"; do
        DEPLOY_RUN_PORT=$((DEPLOY_RUN_PORT + 1))
    done
    echo "Using port ${DEPLOY_RUN_PORT}."
}

echo "Clearing port ${PORT} before start."
prepare_port
echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for dev..."

./node_modules/.bin/next dev --port "${DEPLOY_RUN_PORT}" --hostname 0.0.0.0
