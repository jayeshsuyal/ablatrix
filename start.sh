#!/bin/sh
set -eu
cd "$(dirname "$0")"
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 10)) { console.error("Ablatrix requires Node.js 24.10 or later."); process.exit(1); }'
if [ ! -d node_modules ]; then npm ci; fi
npm run build
npm start
