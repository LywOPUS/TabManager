import assert from 'node:assert/strict';
import {
  TAB_GROUP_NONE,
  isNativeUngrouped,
  planNativeGroups,
  resolveChromeTabIds,
  tabsForCurrentWindowOrganize,
  tabsForSelectedOrganize,
} from './liveOrganize.js';
import {
  leftoversForClassify,
  pickSeedGroupFromPreview,
  pickTopicGroupFromPreview,
  planHasWork,
  planLiveOrganize,
  planMatchedOrganize,
  planSelectedOrganize,
  tabsForPreviewGroup,
} from './liveOrganizePlan.js';

function live(id, url, title, extra = {}) {
  return { id, title, url, tabId: id, pinned: false, ...extra };
}

function previewGroup(name, tabs) {
  return {
    name,
    tabs,
    tabIds: tabs.map((t) => String(t.id)),
  };
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

const ytPreview = { groups: [previewGroup('YouTube', [yt1, yt2])], ungrouped: [] };
assert.deepEqual(resolveChromeTabIds(ytPreview.groups[0].tabs).sort((a, b) => a - b), [21, 22]);

const planned = planNativeGroups(windowTabs, ytPreview);
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

const planNoSiteAbsorb = planLiveOrganize(withOrphan, existing, { groups: [] });
assert.equal(planNoSiteAbsorb.absorb.length, 0, '空预览不再按站点并入散标签');
assert.equal(planNoSiteAbsorb.create.length, 0);
assert.equal(planHasWork(planNoSiteAbsorb), false);

const planAbsorbByName = planLiveOrganize(
  withOrphan,
  existing,
  { groups: [previewGroup('GitHub', [ghOrphan])] },
);
assert.deepEqual(planAbsorbByName.absorb[0], { groupId: 7, name: 'GitHub', tabIds: [41] });

const planCreateYt = planLiveOrganize(withOrphan, existing, ytPreview);
assert.equal(planCreateYt.create[0].name, 'YouTube');
assert.deepEqual(planCreateYt.create[0].tabIds.sort((a, b) => a - b), [21, 22]);

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
const topicPreview = { groups: [previewGroup('React', [reactGh, reactDocs])], ungrouped: [] };
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
const planXAliceEmpty = planLiveOrganize([xa1, xa2, xaNew, xbNew], xExisting, { groups: [] });
assert.equal(planXAliceEmpty.absorb.length, 0, '空预览不按作者启发式并入');

const planXAlice = planLiveOrganize(
  [xa1, xa2, xaNew, xbNew],
  xExisting,
  { groups: [previewGroup('X|alice', [xa1, xa2, xaNew])] },
);
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
const seedPreview = {
  groups: [
    previewGroup('X|alice', [seedAlice, seedAlice2]),
    previewGroup('YouTube', [yt1, yt2]),
  ],
  ungrouped: [seedBob],
};
const aliceGroup = pickSeedGroupFromPreview(seedPreview, seedAlice);
assert.equal(aliceGroup?.name, 'X|alice');
const planSeedAlice = planMatchedOrganize(
  [seedAlice, seedAlice2, seedBob, yt1, yt2],
  [],
  TAB_GROUP_NONE,
  tabsForPreviewGroup([seedAlice, seedAlice2, seedBob, yt1, yt2], aliceGroup),
  aliceGroup.name,
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
  seedPreview,
);
assert.ok(
  planWindowStillGroupsRest.create.some((g) => g.name === 'YouTube'),
  '整理当前窗口仍会处理其余模型组',
);

const planSeedAbsorb = planMatchedOrganize(
  [xa1, xa2, xaNew, xbNew],
  xExisting,
  TAB_GROUP_NONE,
  [xa1, xa2, xaNew],
  'X|alice',
);
assert.deepEqual(planSeedAbsorb.absorb[0]?.tabIds, [63]);
assert.ok(!planSeedAbsorb.absorb.some((a) => a.tabIds.includes(64)), '只收模型给出的 Alice');

const seedDocs = live(81, 'https://react.dev/learn', 'React', { groupId: TAB_GROUP_NONE });
const seedGhReact = live(82, 'https://github.com/facebook/react', 'facebook/react', {
  groupId: TAB_GROUP_NONE,
});
const seedGhNext = live(83, 'https://github.com/vercel/next.js', 'next', { groupId: TAB_GROUP_NONE });
const reactSeedPreview = {
  groups: [previewGroup('React', [seedDocs, seedGhReact])],
  ungrouped: [seedGhNext],
};
assert.equal(pickSeedGroupFromPreview(reactSeedPreview, seedDocs)?.name, 'React');
const planSeedReact = planMatchedOrganize(
  [seedDocs, seedGhReact, seedGhNext],
  [],
  TAB_GROUP_NONE,
  tabsForPreviewGroup([seedDocs, seedGhReact, seedGhNext], pickSeedGroupFromPreview(reactSeedPreview, seedDocs)),
  'React',
);
assert.equal(planSeedReact.create[0].name, 'React');
assert.deepEqual(planSeedReact.create[0].tabIds.sort((a, b) => a - b), [81, 82]);
assert.ok(!planSeedReact.create[0].tabIds.includes(83), '当前页 React 不收 next.js');

const groupedGhReact = live(84, 'https://github.com/facebook/react', 'facebook/react', { groupId: 7 });
const seedDocs2 = live(85, 'https://react.dev/learn', 'React', { groupId: TAB_GROUP_NONE });
const planSeedFromGrouped = planMatchedOrganize(
  [gh1, gh2, groupedGhReact, seedDocs2],
  existing,
  TAB_GROUP_NONE,
  [groupedGhReact, seedDocs2],
  'React',
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
const mixedPreview = {
  groups: [
    previewGroup('X|alice', [mixedX[0], mixedX[1]]),
    previewGroup('X|bob', [mixedX[2], mixedX[3]]),
  ],
  ungrouped: [],
};
const planRegroupX = planLiveOrganize(mixedX, mixedMeta, mixedPreview);
assert.deepEqual(
  planRegroupX.create.map((g) => g.name).sort(),
  ['X|alice', 'X|bob'],
  '已成组的光秃 X 也可以按模型拆成作者组',
);
assert.ok(!planRegroupX.create.some((g) => g.tabIds.includes(93) && g.name === 'X|alice'));

const peelGroup = pickSeedGroupFromPreview(mixedPreview, mixedX[0]);
const planSeedPeelX = planMatchedOrganize(
  mixedX,
  mixedMeta,
  TAB_GROUP_NONE,
  tabsForPreviewGroup(mixedX, peelGroup),
  peelGroup.name,
);
assert.equal(planSeedPeelX.create[0].name, 'X|alice');
assert.deepEqual(planSeedPeelX.create[0].tabIds.sort((a, b) => a - b), [91, 92]);
assert.ok(!planSeedPeelX.create[0].tabIds.includes(93), '从混合 X 组只抽 Alice');

assert.equal(pickTopicGroupFromPreview(reactSeedPreview, 'React')?.name, 'React');
assert.equal(pickTopicGroupFromPreview(reactSeedPreview, 'Vue'), null);
assert.equal(pickTopicGroupFromPreview({ groups: [previewGroup('React 文档', [seedDocs, seedGhReact])] }, 'React')?.name, 'React 文档');

const planByTopic = planMatchedOrganize(
  [seedDocs, seedGhReact, seedGhNext],
  [],
  TAB_GROUP_NONE,
  tabsForPreviewGroup([seedDocs, seedGhReact, seedGhNext], pickTopicGroupFromPreview(reactSeedPreview, 'React')),
  'React',
);
assert.equal(planByTopic.create[0].name, 'React');
assert.deepEqual(planByTopic.create[0].tabIds.sort((a, b) => a - b), [81, 82]);
assert.ok(!planByTopic.create[0].tabIds.includes(83));

const highlightedMix = [
  live(21, 'https://youtube.com/watch?v=1', 'yt1', { highlighted: true, groupId: TAB_GROUP_NONE }),
  live(22, 'https://youtube.com/watch?v=2', 'yt2', { highlighted: true, groupId: TAB_GROUP_NONE }),
  live(31, 'https://example.com/', 'ex', { highlighted: false, groupId: TAB_GROUP_NONE }),
];
assert.deepEqual(
  tabsForSelectedOrganize(highlightedMix).map((t) => t.id),
  [21, 22],
  '只收标签栏多选',
);

const planSel = planSelectedOrganize(
  [...dupGroups, yt1, yt2],
  [
    { groupId: 7, title: 'GitHub' },
    { groupId: 8, title: 'GitHub' },
  ],
  ytPreview,
);
assert.equal(planSel.merge.length, 0, '选中整理不合并未选中的同名组');
assert.equal(planSel.create[0].name, 'YouTube');
assert.deepEqual(planSel.create[0].tabIds.sort((a, b) => a - b), [21, 22]);
assert.ok(!planSel.create.some((g) => g.tabIds.includes(1)), '未选中的 GitHub 不动');

const planSelAbsorb = planSelectedOrganize(
  withOrphan,
  existing,
  { groups: [previewGroup('GitHub', [ghOrphan])] },
);
assert.deepEqual(planSelAbsorb.absorb[0], { groupId: 7, name: 'GitHub', tabIds: [41] });
assert.equal(planSelAbsorb.merge.length, 0);

const planTopicAbsorb = planMatchedOrganize(
  [xa1, xa2, xaNew, xbNew],
  xExisting,
  TAB_GROUP_NONE,
  [xa1, xa2, xaNew],
  'X|alice',
);
assert.deepEqual(planTopicAbsorb.absorb[0]?.tabIds, [63]);
assert.ok(!planTopicAbsorb.absorb.some((a) => a.tabIds.includes(64)));

console.log('liveOrganize plan ok');
