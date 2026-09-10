# AS-98: Chat: the AS-93 link-site guard catches the literal, not the .url field — a fourth link site stays fully green

Filed from the AS-93 QA review (finding F-2, agent:qa-ruben, 2026-09-10), which the AS-93 plan section 9 explicitly asked the reviewer to characterise. Not a defect in AS-93 -- that diff is correct and merged (f15c4ad). This is the follow-up tightening.

OBSERVED, not argued. Ruben's own mutant M-M6 re-introduced the exact bug AS-93 kills: a FOURTH link site in showTaskPanel doing `shadow.href=task.url;` (no spaces around '='), on a new anchor beside 'Open in Lattice'. Result: 293 tests / 293 pass / 0 fail, exit 0, with the 'Image asc-as93-ruben-mm6-test Built' receipt. Every guard stayed green:
  - T7's forbidden pattern /\.href = [A-Za-z_$][\w.$]*\.url\b/ requires LITERAL SPACES and so misses `shadow.href=task.url`.
  - T7's three named per-site assertions still match, and the dashHref( count is still 4 (the new site adds no call).
  - AC-9's public/ literal scan finds nothing because the new site carries no 8799/8443/127.0.0.1 literal.

Other evasions that stay green by inspection: `a.setAttribute('href', x.url)`; `Object.assign(a, {href: x.url})`; a computed `'http://localhost:' + (8000+799)`; a bare tailnet literal with no port.

WHY IT MATTERS. The CTO's AS-93 ruling leans on AC-9 as 'the backstop against a fourth link site'. It is a backstop against a fourth site that hard-codes one of three literals -- NOT against a fourth site that reads the server-baked .url field, which is the more likely mistake precisely because refs[].url / task.url / employee.work.url are still present in every payload (kept deliberately for back-compat, README 'deep-link URL contract'). The guard's English is wider than its algorithm: the AS-45 failure shape, which this company has now hit in five positions.

CHEAPEST TIGHTENING (Ruben's, to be confirmed by the planner, not binding):
  1. Make the forbidden pattern whitespace-insensitive: /\.href\s*=\s*[\w.$]*\.url\b/
  2. Add a scan for /setAttribute\(\s*['\"]href['\"]/ in public/.
  3. Add 'localhost' and '.ts.net' to the AC-9 literal ban.

M4 APPLIES TO THIS TASK'S OWN PLAN: whatever guard is written, an acceptance criterion must name the concrete fourth-site spelling that makes it report a violation, and be satisfied only by an OBSERVED red. Re-running M-M6 against the tightened guard is the obvious falsifier and should be criterion 1.

Route: cto-owen owns the AS-93 plan and this follow-up. Chat set (msg 557), hence critical -- same shape and priority as AS-72 / AS-74 / AS-80. Sequenced by age within the set behind AS-94.

Full review text: scratchpad/agent-qa-ruben/review-AS-93.txt (F-2).
