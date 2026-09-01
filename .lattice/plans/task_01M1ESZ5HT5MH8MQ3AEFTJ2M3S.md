# AS-54: Chat: autolink bare http/https URLs in message bodies

Board request, verbatim (DM msg 367, 2026-09-01): 'urls in chat messages should resolve to links, like http://127.0.0.1:8348/ should be clickable'. Today only markdown-style links work — bare URLs render as literal text.

RENDER PATH (the real one, read before planning): message bodies are rendered client-side in apps/chat/public/app.js bodyNode() as a structure-first pipeline (AS-26 §6): tokenizeInline (apps/chat/public/markdown.js) over the whole body, then appendRefLeaf() runs three pure ref passes over every plain-text leaf in fixed order — AS-refs, msg-refs (tokenizeMsgRefs), file-refs (tokenizeFileRefs, both in apps/chat/public/msg-refs.js). Zero innerHTML anywhere; tokenizers emit text and structure, NEVER markup; DOM assembly is el()/createTextNode only. Markdown links [label](https://…) already work via the 'link' pattern in markdown.js with an http/https-only scheme allowlist.

THE WORK: a new pure tokenizer pass (tokenizeUrls or similar — pure module, no DOM/fetch/globals, importable from node:test, same pattern as msg-refs.js) that finds BARE absolute URLs in plain-text leaves and emits url tokens; app.js renders them as anchors with target=_blank rel=noopener, href set only from the matched slice.

SCOPE BOUNDARY (CTO calls, bake into the plan):
- http:// and https:// ONLY — same allowlist as markdown.js links. No scheme-less www. guessing, no mailto, and javascript:/data: etc. must be structurally impossible (fail the match, stay literal).
- Trailing-punctuation trim: sentence punctuation (. , ; : ! ?) at the URL end stays literal text; a trailing ')' is part of the URL only if a matching '(' occurs inside it (the '(see http://x/)' idiom).
- Round-trip invariant holds: concatenating token texts reproduces the input exactly.
- Runs on code-span inners too — consistent with the deliberate file-ref precedent (a backticked URL is a common idiom here).
- Ordering vs existing passes: verify no partial-capture interaction with FILE_RE (its lookbehind should already reject path segments inside URLs — prove it in tests, e.g. https://github.com/x/blob/main/README.md must yield ONE url token, no fileref) and with msg-ref continuation lists.
- Nested-anchor hazard: appendRefLeaf also runs on md-link inners (app.js line ~223). The URL pass must not build an <a> inside an existing <a> — decide the mechanism in the plan (skip the pass for link inners, or render as plain text there).

Tests in apps/chat/test following the existing node:test tokenizer-test pattern. Server, store, exports, and CLI output are untouched — this is a client render-path change only.
