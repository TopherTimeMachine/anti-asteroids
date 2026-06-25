#!/usr/bin/env bash
# Stop running dev/prod instances of this app (server, client, npm/concurrently wrappers).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MY_PID=$$
KILLED=0
SEEN_PIDS=""

is_project_process() {
  local pid=$1
  local cwd cmd

  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)
  cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)

  [[ "$cwd" == "$PROJECT_ROOT" || "$cwd" == "$PROJECT_ROOT"/* ]] && return 0
  [[ "$cmd" == *"$PROJECT_ROOT"* ]] && return 0
  return 1
}

already_seen() {
  local pid=$1
  [[ " $SEEN_PIDS " == *" $pid "* ]]
}

mark_seen() {
  local pid=$1
  SEEN_PIDS+=" $pid"
}

try_kill() {
  local pid=$1
  local label=${2:-process}

  [[ -z "$pid" || "$pid" == "$MY_PID" ]] && return
  already_seen "$pid" && return
  kill -0 "$pid" 2>/dev/null || return
  is_project_process "$pid" || return

  if kill "$pid" 2>/dev/null; then
    mark_seen "$pid"
    echo "Killed PID $pid ($label)"
    KILLED=$((KILLED + 1))
  fi
}

kill_by_pattern() {
  local pattern=$1
  local label=$2
  local pid

  while read -r pid; do
    try_kill "$pid" "$label"
  done < <(pgrep -f "$pattern" 2>/dev/null || true)
}

kill_by_port() {
  local port=$1
  local pid

  while read -r pid; do
    try_kill "$pid" "port $port"
  done < <(lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null || true)
}

SERVER_PORT=3000
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  val=$(grep -E '^PORT=' "$PROJECT_ROOT/.env" | tail -1 | cut -d= -f2- | tr -d ' "'\''')
  [[ -n "$val" ]] && SERVER_PORT="$val"
fi

kill_by_port "$SERVER_PORT"
kill_by_port 5173

kill_by_pattern "tsx watch src/server/server.ts" "dev server"
kill_by_pattern "node dist/server/server.js" "prod server"
kill_by_pattern "node_modules/.bin/vite" "vite dev server"
kill_by_pattern "concurrently.*dev:client.*dev:server" "concurrently"
kill_by_pattern "npm run dev:server" "npm dev:server"
kill_by_pattern "npm run dev:client" "npm dev:client"
kill_by_pattern "npm run dev" "npm dev"

if [[ "$KILLED" -eq 0 ]]; then
  echo "No running instances found."
else
  echo "Stopped $KILLED process(es)."
fi
