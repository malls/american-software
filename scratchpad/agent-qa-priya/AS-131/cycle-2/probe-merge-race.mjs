// AS-131 cycle-2 residual probe (qa-priya): pure-function demonstration of the merge race.
// Sequence: page fetch for the OLDER page is answered by the server (root 26 with replies [27]);
// before the client merges it, a LIVE reply 41 on root 26 arrives and applyMessage stores it as an
// orphan threads[26]=[41]; then mergeOlderPage installs the server's list — [27] — for the fresh
// root 26, discarding 41. maxLoadedId already counts 41, so a since= catch-up will not re-deliver it.
import { applyMessage, mergeOlderPage, maxLoadedId, findLoaded } from '/Users/forrest/Code/american-software-company/.worktrees/AS-131/apps/chat/public/live.js';
const msg = (id, threadRootId = null) => ({ id, conversationId: 7, threadRootId, authorId: 'a', body: `m${id}`, createdAt: 't' });
const data = { conversation: { id: 7 }, messages: [msg(38), msg(40)].map((m) => ({ ...m, replyCount: 0 })), threads: {}, hasMore: true, nextBefore: 38 };
// server builds the page: root 26 with [27]
const page = { messages: [{ ...msg(26), replyCount: 1 }, { ...msg(28), replyCount: 0 }], threads: { 26: [msg(27, 26)] }, hasMore: true, nextBefore: 26 };
// live reply 41 on 26 lands first
console.log('applyMessage(41 on 26) ->', applyMessage(data, msg(41, 26)), 'orphan threads[26] =', data.threads[26].map((m) => m.id), 'maxLoadedId =', maxLoadedId(data));
mergeOlderPage(data, page);
console.log('after mergeOlderPage: threads[26] =', data.threads[26].map((m) => m.id), '| root 26 replyCount =', data.messages.find((m) => m.id === 26).replyCount, '| findLoaded(41) =', findLoaded(data, 41), '| maxLoadedId =', maxLoadedId(data));
console.log('RESULT: live reply 41', data.threads[26].some((m) => m.id === 41) ? 'kept' : 'DROPPED by the merge (residual; since=maxLoadedId will not re-deliver it because maxLoadedId already advanced past 41)');
