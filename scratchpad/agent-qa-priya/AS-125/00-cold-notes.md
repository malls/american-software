# AS-125 review — cold notes (written BEFORE any run; agent:qa-priya on Opus, Fable fallback)

Static read of the diff. Edges I intend to probe beyond §3/§6:
- `:root { … }` subject: (c) treats pseudo-class-only subjects as matchable → `:root` counts as targeting. Can never be the div. Is `:root` in style.css? If so targeting set != 3.
- `*|div` namespace-prefixed universal/type subject: `|` is not stripped by (c) → returns false → a browser applies `*|div` to the div. Silent route (exotic).
- comma in an ancestor attribute value AHEAD of the base rule: `[title="a,b"] .roster-title { ws: normal }` then `.roster-title { ws: nowrap }` — split halves give spec (0,1,0) for the second half; real is (0,2,0). Equal-spec → later order wins → guard says nowrap, browser says normal. Plan §1.4 calls the direction "conservative"; I expect it is not in this arrangement.
- `@MEDIA`/`@FONT-FACE`/`@-moz-keyframes`: case-sensitive lists → throw (loud). Not a route past; a false throw.
- `[title="a]b"]` — `]` inside a value: attr-strip regex stops early. Exotic; check direction.
- `#r>div`, `#r+div`, `#r~div` (no spaces) → compound must be `div`.
- `.ROSTER-TITLE` uppercase → must be NOT targeting (class selectors are case-sensitive in HTML).
- `:where(.roster-title)` → UNSCORABLE throw must fire in walk before targets.
- `{ white-space: normal }` empty prelude — silently dropped (browser drops it too). Note only.
- G1 predicted T1 green — confirm stylesheet has no `[class` selectors (why H9 is load-bearing).
