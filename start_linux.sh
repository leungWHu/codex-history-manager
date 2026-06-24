#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8765}"
CODEX_HOME_ARG=()

if [[ -n "${CODEX_HOME:-}" ]]; then
  CODEX_HOME_ARG=(--codex-home "$CODEX_HOME")
fi

if ! command -v conda >/dev/null 2>&1; then
  echo "conda was not found. Install conda or add it to PATH first." >&2
  exit 1
fi

declare -a ENV_PATHS=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  line="${line/\*/ }"
  env_path="$(awk '{print $NF}' <<<"$line")"
  [[ -z "$env_path" ]] && continue
  ENV_PATHS+=("$env_path")
done < <(conda env list)

if [[ "${#ENV_PATHS[@]}" -eq 0 ]]; then
  echo "No conda environments found." >&2
  exit 1
fi

echo "Select conda environment:"
for i in "${!ENV_PATHS[@]}"; do
  env_path="${ENV_PATHS[$i]}"
  env_name="$(basename "$env_path")"
  printf "  %2d) %s (%s)\n" "$((i + 1))" "$env_name" "$env_path"
done

read -r -p "Enter number [1]: " choice
choice="${choice:-1}"

if ! [[ "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#ENV_PATHS[@]} )); then
  echo "Invalid selection: $choice" >&2
  exit 1
fi

SELECTED_PATH="${ENV_PATHS[$((choice - 1))]}"

echo "Starting Codex History Viewer..."
echo "Conda env: $(basename "$SELECTED_PATH") ($SELECTED_PATH)"
echo "Host: $HOST"
echo "Port: $PORT"
echo "URL: http://$HOST:$PORT"
if [[ "${#CODEX_HOME_ARG[@]}" -gt 0 ]]; then
  echo "Codex home: $CODEX_HOME"
fi
echo "Keep this window open while using the web page."
echo

exec conda run --no-capture-output -p "$SELECTED_PATH" python -u server.py --host "$HOST" --port "$PORT" "${CODEX_HOME_ARG[@]}" "$@"
