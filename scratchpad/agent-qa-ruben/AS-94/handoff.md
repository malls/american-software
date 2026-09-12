**Need: a host shell (board or live session) to bootstrap the dashboard launchd job and quote four observations back on AS-94.** Code + docs are on `feat/AS-94-dashboard-launchd` (PR https://github.com/malls/american-software/pull/1), reviewed; the guard is green in the compose suite with a `Built` receipt. Nothing is installed yet — a tick cannot run `launchctl`. ~5 minutes.

```sh
cd /Users/forrest/Code/american-software-company           # MAIN checkout, on master
ls ~/Library/LaunchAgents/                                   # expect the watcher plist; no lattice-dashboard plist yet
tailscale serve status                                       # expect :8443 -> http://127.0.0.1:8799 (the L2 leg; quote it)

# A. stop the live-session dashboard that currently owns :8799 (at review time pid 52536,
#    started with no args; a SECOND dashboard on :8805, pid 78002, is unrelated — leave it)
lsof -nP -iTCP:8799 -sTCP:LISTEN
pgrep -fl 'lattice dashboard'
kill <pid from lsof>; sleep 1; lsof -nP -iTCP:8799 -sTCP:LISTEN   # must print nothing

# B. render, lint, install (identical to apps/chat/watch/README.md "Lattice dashboard > Install")
REPO_ROOT="$(git rev-parse --show-toplevel)"; LATTICE_BIN="$(command -v lattice)"; LABEL=com.american-software.lattice-dashboard
mkdir -p "$REPO_ROOT/apps/chat/data/logs"
sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" -e "s|__LATTICE_BIN__|$LATTICE_BIN|g" \
    -e "s|__PATH__|$(dirname "$LATTICE_BIN"):/usr/bin:/bin|g" \
    "$REPO_ROOT/apps/chat/watch/$LABEL.plist.template" > ~/Library/LaunchAgents/$LABEL.plist
plutil -lint ~/Library/LaunchAgents/$LABEL.plist             # AC-1 host half: expect "OK"
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/$LABEL.plist

# C. the four AC-3 observations — quote each line verbatim
launchctl print gui/$(id -u)/$LABEL | grep -E 'state|pid|last exit'          # (1) state = running
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8799/              # (2) 200
kill $(lsof -nP -iTCP:8799 -sTCP:LISTEN -t); date +%T                         # (3) kill the pid, note the time
for i in $(seq 1 30); do sleep 1; curl -s -o /dev/null -w "%{http_code} after ${i}s\n" http://127.0.0.1:8799/ && break; done   # (4) 200 again within 30 s

# D. AC-4 — single owner: the manual copy must FAIL to bind; quote its error
lattice dashboard --host 127.0.0.1 --port 8799

# E. bonus, one line: does SIGHUP keep the pid or relaunch it?  (either is fine; say which)
lattice restart; sleep 2; launchctl print gui/$(id -u)/$LABEL | grep -E 'state|pid'
```

Then, from the phone, open any `AS-n` link in chat: it should resolve at `https://forrests-newer-macbook.tail3f3c29.ts.net:8443/#/task/…`. Reply here (or on the PR) with the quotes from B (plutil), C (four lines), D (the bind error), E, and the `tailscale serve status` line. If D does **not** fail — the CLI picks another port or otherwise "succeeds" — say so: the README's AC-4 sentence is then wrong and the task comes back for a wording fix before merge. If `tailscale serve status` shows no `:8443` mapping, that is a separate host record, not this task.

Note from review (F1, non-blocking): the template is `--host 127.0.0.1 --port 8799` explicitly; the pre-existing pid 52536 was started with no args and holds 8799 by CLI default, which is why step A identifies it by port, not argv.
