#!/bin/sh
# Plan §1.4 normaliser, plus one rule the plan lacked: the app's ids are UUIDs
# (lib/db newId), not ULIDs, so a UUID rule is appended. Usage: normalise.sh <file>
sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/<ts>/g; s/\b(t=)[0-9]+/\1<t>/g; s/v1=[0-9a-f]{64}/v1=<sig>/g; s/\b[0-9A-HJKMNP-TV-Z]{26}\b/<ulid>/g; s/\b(acct|cus|in|ii)_[A-Za-z0-9]+/\1_<id>/g; s/127\.0\.0\.1:[0-9]+/127.0.0.1:<port>/g; s/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<uuid>/g' "$1"
