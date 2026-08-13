import assert from 'node:assert/strict';
import { suggestGroups, finalizePreview } from './groupLabels.js';
import {
  TAB_GROUP_NONE,
  isNativeUngrouped,
  planNativeGroups,
  resolveChromeTabIds,
  tabsForCurrentWindowOrganize,
} from './liveOrganize.js';
import { leftoversForClassify, planHasWork, planLiveOrganize, planSeedOrganize } from './liveOrganizePlan.js';

function live(id, url, title, extra = {}) {
  return { id, title, url, tabId: id, pinned: false, ...extra };
}

const gh1 = live(11, 'https://github.com/a/b', 'a/b', { groupId: 7 });
const gh2 = live(12, 'https://github.com/c/d', 'c/d', { groupId: 7 });
const yt1 = live(21, 'https://youtube.com/watch?v=1', 'yt1', { groupId: TAB_GROUP_NONE });
const yt2 = live(22, 'https://youtube.com/watch?v=2', 'yt2', { groupId: TAB_GROUP_NONE });

const windowTabs = [
  gh1,
  gh2,
  yt1,
  yt2,
  live(31, 'https://example.com/', 'ex', { groupId: TAB_GROUP_NONE }),
  live(99, 'chrome://extensions', 'ext', { groupId: TAB_GROUP_NONE }),
  live(8, 'https://pinned.example/', 'pin', { pinned: true, groupId: TAB_GROUP_NONE }),
];

assert.equal(isNativeUngrouped({ groupId: TAB_GROUP_NONE }), true);
assert.equal(isNativeUngrouped({ groupId: 7 }), false);

const ungrouped = tabsForCurrentWindowOrganize(windowTabs);
assert.deepEqual(
  ungrouped.map((t) => t.id).sort((a, b) => a - b),
  [21, 22, 31],
);

const preview = finalizePreview(suggestGroups(ungrouped.map((t) => live(t.id, t.url, t.url))));
assert.equal(preview.groups.length, 1);
assert.equal(preview.groups[0].name, 'YouTube');
assert.deepEqual(resolveChromeTabIds(preview.groups[0].tabs).sort((a, b) => a - b), [21, 22]);

const planned = planNativeGroups(windowTabs, preview);
assert.deepEqual(
  planned.map((g) => ({ name: g.name, tabIds: [...g.tabIds].sort((a, b) => a - b) })),
  [{ name: 'YouTube', tabIds: [21, 22] }],
);

const existing = [{ groupId: 7, title: 'GitHub' }];
assert.deepEqual(
  leftoversForClassify(windowTabs, existing).map((t) => t.id).sort((a, b) => a - b),
  [21, 22, 31],
  '未成组 YouTube / example 对不上已有 GitHub',
);

const ghOrphan = live(41, 'https://github.com/e/f', 'e/f', { groupId: TAB_GROUP_NONE });
const withOrphan = [...windowTabs, ghOrphan];
assert.ok(
  leftoversForClassify(withOrphan, existing).every((t) => t.id !== 41),
  '同站未成组仍可按站点对上已有 GitHub（单条并入）',
);

const planAbsorb = planLiveOrganize(
  withOrphan,
  existing,
  finalizePreview(suggestGroups(tabsForCurrentWindowOrganize(withOrphan))),
);
assert.deepEqual(planAbsorb.absorb[0], { groupId: 7, name: 'GitHub', tabIds: [41] });
assert.equal(planAbsorb.create[0].name, 'YouTube');
assert.ok(planHasWork(planAbsorb));

const planOnlyAbsorb = planLiveOrganize([gh1, gh2, ghOrphan], existing, { groups: [] });
assert.equal(planOnlyAbsorb.absorb.length, 1);
assert.equal(planOnlyAbsorb.create.length, 0);
assert.ok(planHasWork(planOnlyAbsorb), '单条同站未成组也应并入');

const dupGroups = [
  live(1, 'https://github.com/a/1', 'a1', { groupId: 7 }),
  live(2, 'https://github.com/a/2', 'a2', { groupId: 7 }),
  live(3, 'https://github.com/b/1', 'b1', { groupId: 8 }),
  live(4, 'https://github.com/b/2', 'b2', { groupId: 8 }),
];
const planMerge = planLiveOrganize(
  dupGroups,
  [
    { groupId: 7, title: 'GitHub' },
    { groupId: 8, title: 'GitHub' },
  ],
  { groups: [] },
);
assert.equal(planMerge.merge[0].keepGroupId, 7);
assert.deepEqual(planMerge.merge[0].tabIds.sort((a, b) => a - b), [3, 4]);

const reactGh = live(51, 'https://github.com/facebook/react', 'facebook/react', {
  groupId: TAB_GROUP_NONE,
});
const reactDocs = live(52, 'https://react.dev/learn', 'React', { groupId: TAB_GROUP_NONE });
const topicPreview = finalizePreview(suggestGroups([reactGh, reactDocs]));
assert.equal(topicPreview.groups.length, 1);
assert.equal(topicPreview.groups[0].name, 'React');
const planTopic = planLiveOrganize([gh1, gh2, reactGh, reactDocs], existing, topicPreview);
assert.equal(planTopic.create[0].name, 'React');
assert.deepEqual(planTopic.create[0].tabIds.sort((a, b) => a - b), [51, 52]);
assert.ok(
  !planTopic.absorb.some((a) => a.tabIds.includes(51)),
  '跨站主题不并入已有 GitHub',
);

const xa1 = live(61, 'https://x.com/alice/status/1', 'Alice 在 X 上的帖子', { groupId: 9 });
const xa2 = live(62, 'https://x.com/alice/status/2', 'Alice 在 X 上的帖子', { groupId: 9 });
const xaNew = live(63, 'https://x.com/alice/status/3', 'Alice 在 X 上的帖子', { groupId: TAB_GROUP_NONE });
const xbNew = live(64, 'https://x.com/bob/status/1', 'Bob 在 X 上的帖子', { groupId: TAB_GROUP_NONE });
const xExisting = [{ groupId: 9, title: 'X|alice' }];
const planXAlice = planLiveOrganize([xa1, xa2, xaNew, xbNew], xExisting, { groups: [] });
assert.deepEqual(planXAlice.absorb[0]?.tabIds, [63]);
assert.ok(!planXAlice.absorb.some((a) => a.tabIds.includes(64)), 'Bob 不并进 X|alice');

const seedAlice = live(71, 'https://x.com/alice/status/1', 'Alice 在 X 上的帖子', {
  groupId: TAB_GROUP_NONE,
});
const seedAlice2 = live(72, 'https://x.com/alice/status/2', 'Alice 在 X 上的帖子', {
  groupId: TAB_GROUP_NONE,
});
const seedBob = live(73, 'https://x.com/bob/status/1', 'Bob 在 X 上的帖子', {
  groupId: TAB_GROUP_NONE,
});
const planSeedAlice = planSeedOrganize(
  [seedAlice, seedAlice2, seedBob, yt1, yt2],
  [],
  TAB_GROUP_NONE,
  seedAlice,
);
assert.equal(planSeedAlice.create[0].name, 'X|alice');
assert.deepEqual(planSeedAlice.create[0].tabIds.sort((a, b) => a - b), [71, 72]);
assert.ok(
  !planSeedAlice.create.some((g) => g.tabIds.includes(73) || g.tabIds.includes(21)),
  '按当前页归组不整理 Bob / YouTube',
);
assert.equal(planSeedAlice.merge.length, 0);

const planWindowStillGroupsRest = planLiveOrganize(
  [seedAlice, seedAlice2, seedBob, yt1, yt2],
  [],
  finalizePreview(suggestGroups([seedAlice, seedAlice2, seedBob, yt1, yt2])),
);
assert.ok(
  planWindowStillGroupsRest.create.some((g) => g.name === 'YouTube'),
  '整理当前窗口仍会处理其余站点',
);

const planSeedAbsorb = planSeedOrganize(
  [xa1, xa2, xaNew, xbNew],
  xExisting,
  TAB_GROUP_NONE,
  xa1,
);
assert.deepEqual(planSeedAbsorb.absorb[0]?.tabIds, [63]);
assert.ok(!planSeedAbsorb.absorb.some((a) => a.tabIds.includes(64)), '种子已在 X|alice 时仍只收 Alice');

const seedDocs = live(81, 'https://react.dev/learn', 'React', { groupId: TAB_GROUP_NONE });
const seedGhReact = live(82, 'https://github.com/facebook/react', 'facebook/react', {
  groupId: TAB_GROUP_NONE,
});
const seedGhNext = live(83, 'https://github.com/vercel/next.js', 'next', { groupId: TAB_GROUP_NONE });
const planSeedReact = planSeedOrganize(
  [seedDocs, seedGhReact, seedGhNext],
  [],
  TAB_GROUP_NONE,
  seedDocs,
);
assert.equal(planSeedReact.create[0].name, 'React');
assert.deepEqual(planSeedReact.create[0].tabIds.sort((a, b) => a - b), [81, 82]);
assert.ok(!planSeedReact.create[0].tabIds.includes(83), '当前页 React 不收 next.js');

const groupedGhReact = live(84, 'https://github.com/facebook/react', 'facebook/react', { groupId: 7 });
const seedDocs2 = live(85, 'https://react.dev/learn', 'React', { groupId: TAB_GROUP_NONE });
const planSeedFromGrouped = planSeedOrganize(
  [gh1, gh2, groupedGhReact, seedDocs2],
  existing,
  TAB_GROUP_NONE,
  seedDocs2,
);
assert.equal(planSeedFromGrouped.create[0].name, 'React');
assert.deepEqual(planSeedFromGrouped.create[0].tabIds.sort((a, b) => a - b), [84, 85]);
assert.ok(!planSeedFromGrouped.create[0].tabIds.includes(11), '抽走 GitHub 里的 React，留下其余 GitHub');

const mixedX = [
  live(91, 'https://x.com/alice/status/1', 'Alice 在 X 上的帖子', { groupId: 10 }),
  live(92, 'https://x.com/alice/status/2', 'Alice 在 X 上的帖子', { groupId: 10 }),
  live(93, 'https://x.com/bob/status/1', 'Bob 在 X 上的帖子', { groupId: 10 }),
  live(94, 'https://x.com/bob/status/2', 'Bob 在 X 上的帖子', { groupId: 10 }),
];
const mixedMeta = [{ groupId: 10, title: 'X' }];
const mixedPreview = finalizePreview(suggestGroups(mixedX));
const planRegroupX = planLiveOrganize(mixedX, mixedMeta, mixedPreview);
assert.deepEqual(
  planRegroupX.create.map((g) => g.name).sort(),
  ['X|alice', 'X|bob'],
  '已成组的光秃 X 也可以拆成作者组',
);
assert.ok(!planRegroupX.create.some((g) => g.tabIds.includes(93) && g.name === 'X|alice'));

const planSeedPeelX = planSeedOrganize(mixedX, mixedMeta, TAB_GROUP_NONE, mixedX[0]);
assert.equal(planSeedPeelX.create[0].name, 'X|alice');
assert.deepEqual(planSeedPeelX.create[0].tabIds.sort((a, b) => a - b), [91, 92]);
assert.ok(!planSeedPeelX.create[0].tabIds.includes(93), '从混合 X 组只抽 Alice');

console.log('liveOrganize plan ok');
