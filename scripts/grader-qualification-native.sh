#!/bin/sh
set -eu
# Clear preload/lookup hooks before the Node runtime is created. Do not load .env.
unset NODE_OPTIONS NODE_PATH
qualification_script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec node --experimental-transform-types "$qualification_script_dir/grader-qualification-live.ts" "$@"
