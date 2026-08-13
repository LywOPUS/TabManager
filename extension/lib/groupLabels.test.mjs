import assert from 'node:assert/strict';
import {
  canonicalSite,
  contentTitle,
  finalizeGroupName,
  finalizePreview,
  isJunkGroupName,
  siteLabel,
  suggestGroups,
} from './groupLabels.js';

function tab(id, url, title) {
  return { id, url, title };
}

const x1 = tab('1', 'https://x.com/alice/status/1', 'Alice 在 X 上的帖子');
const x2 = tab('2', 'https://twitter.com/bob/status/2', 'Bob 在 X 上的帖子');
const x3 = tab('3', 'https://x.com/carol', 'Carol 在 X 上');
const gh1 = tab('4', 'https://github.com/a/b', 'a/b');
const gh2 = tab('5', 'https://github.com/c/d', 'c/d');

assert.equal(canonicalSite('twitter.com'), 'x.com');
assert.equal(siteLabel('twitter.com'), 'X');
assert.equal(siteLabel('x.com'), 'X');
assert.equal(isJunkGroupName('上的'), true);
assert.equal(isJunkGroupName('的帖'), true);
assert.equal(isJunkGroupName('X'), false);

assert.equal(finalizeGroupName('上的', [x1, x2]), 'X');
assert.equal(finalizeGroupName('帖子', [x1, x2, x3]), 'X');
assert.equal(finalizeGroupName('github.com', [gh1, gh2]), 'GitHub');

const peeled = finalizePreview({
  groups: [{ name: '上的', tabs: [x1, x2], tabIds: ['1', '2'] }],
  ungrouped: [],
});
assert.equal(peeled.groups.length, 1);
assert.equal(peeled.groups[0].name, 'X');
assert.equal(peeled.groups[0].tabs.length, 2);

const merged = finalizePreview({
  groups: [
    { name: '上的', tabs: [x1, x2], tabIds: ['1', '2'] },
    { name: '帖子', tabs: [x3, x1], tabIds: ['3', '1'] },
  ],
  ungrouped: [],
});
assert.equal(merged.groups.length, 1);
assert.equal(merged.groups[0].name, 'X');
assert.deepEqual(merged.groups[0].tabIds.sort(), ['1', '2', '3']);

const siteMode = suggestGroups([x1, x2, gh1, gh2]);
const names = siteMode.groups.map((g) => g.name).sort();
assert.deepEqual(names, ['GitHub', 'X']);

const mixed = finalizePreview({
  groups: [{
    name: 'AI 资讯',
    tabs: [x1, gh1, gh2, tab('6', 'https://github.com/e/f', 'e/f')],
    tabIds: ['1', '4', '5', '6'],
  }],
  ungrouped: [],
});
assert.equal(mixed.groups[0].name, 'AI 资讯');

const gpt = suggestGroups([
  tab('7', 'https://chatgpt.com/', 'ChatGPT'),
  tab('8', 'https://chat.openai.com/', 'ChatGPT'),
]);
assert.equal(gpt.groups.length, 1);
assert.equal(gpt.groups[0].name, 'ChatGPT');

const busyGh = suggestGroups([
  tab('10', 'https://github.com/facebook/react', 'react'),
  tab('11', 'https://github.com/facebook/relay', 'relay'),
  tab('12', 'https://github.com/vercel/next.js', 'next'),
  tab('13', 'https://github.com/vercel/swr', 'swr'),
]);
const busyNames = busyGh.groups.map((g) => g.name).sort();
assert.deepEqual(busyNames, ['facebook', 'vercel']);

const reactDocs = tab('14', 'https://react.dev/learn', 'React');
const crossSite = finalizePreview(
  suggestGroups([
    tab('15', 'https://github.com/facebook/react', 'facebook/react'),
    reactDocs,
  ]),
);
assert.equal(crossSite.groups.length, 1);
assert.equal(crossSite.groups[0].name, 'React');
assert.deepEqual(crossSite.groups[0].tabIds.sort(), ['14', '15']);

const keepSite = finalizePreview(
  suggestGroups([
    tab('16', 'https://github.com/facebook/react', 'react'),
    tab('17', 'https://github.com/facebook/relay', 'relay'),
    tab('18', 'https://react.dev/learn', 'React'),
  ]),
);
assert.ok(
  keepSite.groups.some((g) => g.name === 'GitHub' && g.tabs.length === 2),
  '已有两枚 GitHub 时不要抽走一条去凑跨站主题',
);
assert.ok(!keepSite.groups.some((g) => g.name === 'React'));

const zhTopic = finalizePreview(
  suggestGroups([
    tab('19', 'https://zhihu.com/p/1', '机器学习入门'),
    tab('20', 'https://medium.com/@x/ml', '机器学习实战'),
  ]),
);
assert.equal(zhTopic.groups[0].name, '机器学习');

const stillGithub = finalizePreview(suggestGroups([gh1, gh2]));
assert.deepEqual(stillGithub.groups.map((g) => g.name), ['GitHub']);

assert.equal(contentTitle(x1), '');
assert.equal(
  contentTitle(tab('xbody', 'https://x.com/alice/status/9', 'Alice on X: React 19 is out')),
  'React 19 is out',
);

const busyX = suggestGroups([
  tab('a1', 'https://x.com/alice/status/1', 'Alice 在 X 上的帖子'),
  tab('a2', 'https://x.com/alice/status/2', 'Alice 在 X 上的帖子'),
  tab('b1', 'https://x.com/bob/status/1', 'Bob 在 X 上的帖子'),
  tab('b2', 'https://twitter.com/bob/status/2', 'Bob 在 X 上的帖子'),
]);
assert.deepEqual(busyX.groups.map((g) => g.name).sort(), ['@alice', '@bob']);
const busyXFinal = finalizePreview(busyX);
assert.deepEqual(busyXFinal.groups.map((g) => g.name).sort(), ['@alice', '@bob']);

const quietX = suggestGroups([x1, x2, x3]);
assert.deepEqual(quietX.groups.map((g) => g.name), ['X']);

const xReact = tab('xr', 'https://x.com/alice/status/9', 'Alice on X: React 19 is out');
const fromX = finalizePreview(suggestGroups([xReact, reactDocs]));
assert.equal(fromX.groups[0].name, 'React');
assert.deepEqual(fromX.groups[0].tabIds.sort(), ['14', 'xr']);

console.log('groupLabels ok');
