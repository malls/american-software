---
actor_id: agent:fix-dev
name: Dev Fixture
title: Software Engineer
class: ic
reports_to: agent:fix-cto
team: engineering
hired: 2026-01-04
status: active
---

# Dev Fixture

An ic with a valid reporting line. Repointing `reports_to` at a nonexistent id
is the AS-33 §6 F2 mutation: it must flip `check-org` from exit 0 to exit 1.
