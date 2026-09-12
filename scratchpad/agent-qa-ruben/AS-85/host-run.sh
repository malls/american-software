#!/bin/bash
# counted host run: $1 = apps/chat dir to run from, $2 = output file
cd "$1" || exit 2
node --test test/*.test.js > "$2" 2>&1
echo "exit=$?" >> "$2"
tail -12 "$2"
