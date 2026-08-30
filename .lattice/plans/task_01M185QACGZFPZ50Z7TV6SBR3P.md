# AS-3: Chat app: tighten markRead bounds + make CLI reads side-effect-free

Two non-blocking findings from the AS-2 QA review (qa-priya): (1) store.markRead accepts an upTo watermark beyond the current max message id — should clamp or reject; (2) CLI 'chat history @identity' and 'chat read @identity' get-or-create the DM conversation row on what should be a pure read. Neither violates any AS-2 acceptance criterion; both are small correctness/hygiene fixes in apps/chat/lib/store.js and apps/chat/bin/chat.js.
