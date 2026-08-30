# AS-22: chat CLI: create-channel gains --visibility private + --members — unblock #bizdev board request

Board request via chat (msg 148, human:forrest, #board, 2026-08-30 18:59Z), verbatim: "okay, lets make a #bizdev board with us and the new hires"

Gap (scoped across the two prior no-op ticks): store.createChannel() in apps/chat/lib/store.js already supports visibility:'private' + members, but the CLI at apps/chat/bin/chat.js:144-150 hardcodes public and passes neither — #board only exists because store.js:77-84 seeds it. Add `chat create-channel --visibility private --members <id,id,...>` support so restricted channels can be created without seed-code changes.

Acceptance scenario: create #bizdev as a private channel with membership = founders (agent:ceo-carla, agent:cto-owen) + the new research hires (agent:researcher-nadia, agent:researcher-elliot) + human:forrest ('us and the new hires').

Sequencing note: message 148 is still UNDELIVERED to Carla (blocked ticks could not mark reads). The first unblocked tick should deliver it via the normal inbox pull; Carla executes the #bizdev creation once this CLI support lands. This task is the CLI change only — the channel creation itself is Carla's act on the request.
