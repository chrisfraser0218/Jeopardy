#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"
if [[ -x .runtime/node/bin/node ]]; then
  export PATH="$PWD/.runtime/node/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 24.11 or newer from https://nodejs.org, then follow README.md."
  exit 1
fi
if [[ ! -d node_modules || ! -f dist/index.html ]]; then
  echo "First install and build the app: npm ci && npm run build"
  exit 1
fi
exec npm start
