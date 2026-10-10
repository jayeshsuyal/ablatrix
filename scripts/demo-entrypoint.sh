#!/bin/sh
set -eu
umask 077

data_dir=${ABLATRIX_DATA_DIR:-/data}
if [ -L "$data_dir" ]; then
  echo "Ablatrix data directory must not be a symbolic link." >&2
  exit 73
fi
mkdir -p -- "$data_dir"
data_dir=$(CDPATH= cd -- "$data_dir" && pwd -P)
if [ -L "$data_dir/.runtime.lock" ]; then
  echo "Ablatrix runtime lock must not be a symbolic link." >&2
  exit 73
fi
if ! command -v flock >/dev/null 2>&1; then
  echo "Ablatrix hosted runtime requires util-linux flock." >&2
  exit 69
fi

# This descriptor remains open in the parent for the child's entire lifetime.
# Kernel ownership survives PID namespace changes and is released after a crash.
exec 9>"$data_dir/.runtime.lock"
if ! flock -n 9; then
  echo "Ablatrix data directory is in use by another app or maintenance command." >&2
  exit 75
fi
if [ -e "$data_dir/.restore-in-progress" ]; then
  echo "A previous restore was interrupted. Inspect it or restore into a new empty data directory before starting." >&2
  exit 75
fi

# Hosted configuration fixes these legacy paths beneath the same locked root.
# Never remove them before obtaining the shared app/maintenance lock.
rm -f -- "$data_dir/ablatrix.sqlite.lock" "$data_dir/feedback-loop.sqlite.lock"
export ABLATRIX_DATA_DIR="$data_dir"
export ABLATRIX_RUNTIME_LOCK_HELD=1
export ABLATRIX_RUNTIME_LOCK_FD=9

if [ "$#" -eq 0 ]; then
  set -- node --import tsx server/index.ts
fi

child=
interrupted=0
forward_term() { interrupted=1; if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null || :; fi; }
forward_int() { interrupted=1; if [ -n "$child" ]; then kill -INT "$child" 2>/dev/null || :; fi; }
trap forward_term TERM
trap forward_int INT
"$@" &
child=$!

# A trapped signal interrupts wait before the child has finished draining.
# Keep the lock held, and wait again until the actual child exit is available.
while :; do
  interrupted=0
  if wait "$child"; then code=0; else code=$?; fi
  # Reap again even if the child exited immediately after the signal. The first
  # wait may report the parent's interrupted wait rather than the child's code.
  if [ "$interrupted" -eq 1 ]; then continue; fi
  if ! kill -0 "$child" 2>/dev/null; then break; fi
done
exit "$code"
