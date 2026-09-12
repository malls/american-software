| case | value | exit | db created | stderr (first line) |
|---|---|---|---|---|
| unset | undefined | 0 | yes | (none) |
| empty | "" | 0 | yes | (none) |
| ws-only | "  " | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS '  ' — a positive integer of milliseconds (AS-83). |
| 0 | "0" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS '0' — a positive integer of milliseconds (AS-83). |
| 1 | "1" | 0 | yes | (none) |
| 3000 | "3000" | 0 | yes | (none) |
| ceil | "2147483647" | 0 | yes | (none) |
| ceil+1 | "2147483648" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS '2147483648' — above 2147483647 ms, the Node timer ceiling; a larger delay is clamped to 1 ms (AS-113). |
| 2^32 | "4294967296" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS '4294967296' — above 2147483647 ms, the Node timer ceiling; a larger delay is clamped to 1 ms (AS-113). |
| huge | "99999999999999999999" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS '99999999999999999999' — above 2147483647 ms, the Node timer ceiling; a larger delay is clamped to 1 ms (AS-113). |
| 1e9 | "1e9" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS '1e9' — a positive integer of milliseconds (AS-83). |
| +5 | "+5" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS '+5' — a positive integer of milliseconds (AS-83). |
| -5 | "-5" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS '-5' — a positive integer of milliseconds (AS-83). |
|  5 | " 5" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS ' 5' — a positive integer of milliseconds (AS-83). |
| 5  | "5 " | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS '5 ' — a positive integer of milliseconds (AS-83). |
| 1.5 | "1.5" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS '1.5' — a positive integer of milliseconds (AS-83). |
| 0x10 | "0x10" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS '0x10' — a positive integer of milliseconds (AS-83). |
| 1_000 | "1_000" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS '1_000' — a positive integer of milliseconds (AS-83). |
| Infinity | "Infinity" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS 'Infinity' — a positive integer of milliseconds (AS-83). |
| NaN | "NaN" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS 'NaN' — a positive integer of milliseconds (AS-83). |
| 007 | "007" | 0 | yes | (none) |
| ceil-leading-zero | "02147483647" | 0 | yes | (none) |
| ceil+1-leading-zero | "02147483648" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS '02147483648' — above 2147483647 ms, the Node timer ceiling; a larger delay is clamped to 1 ms (AS-113). |
| arabic-digit | "٥" | 1 | no | chat: invalid CHAT_PROBE_TIMEOUT_MS '٥' — a positive integer of milliseconds (AS-83). |
