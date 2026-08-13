import assert from 'node:assert/strict';
import { suggestGroups, finalizePreview } from './groupLabels.js';
import {
  TAB_GROUP_NONE,
  isNativeUngrouped,
  planNativeGroups,
  resolveChromeTabIds,
  tabsForCurrentWindowOrganize,
} from './liveOrganize.js';
import { leftoversForClassify, planHasWork, planLiveOrganize } from './liveOrganizePlan.js';

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

console.log('liveOrganize plan ok');
