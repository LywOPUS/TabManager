import assert from 'node:assert/strict';
import { clusterPreview, __test__ } from './browserEmbedClassify.js';
import { GEMMA_CLUSTER, MINILM_CLUSTER, getClusterParams } from './browserModels.js';

const { nameCluster, isShellTab, isWeakNameToken, cleanTitle, usefulPathWords, embedText, isUrlTitle } = __test__;

assert.equal(isWeakNameToken('was'), true);
assert.equal(isWeakNameToken('How'), true);
assert.equal(isWeakNameToken('Best'), true);
assert.equal(isWeakNameToken('Godot'), false);
assert.equal(isShellTab({ title: 'YouTube' }), true);
assert.equal(isShellTab({ title: '主页 / X' }), true);
assert.equal(isShellTab({ title: 'The ultimate introduction to Godot' }), false);
assert.ok(!usefulPathWords('https://www.youtube.com/watch?v=vZkAbeMLcvc').includes('vZkAbeMLcvc'));

const kingdom = { id: 'k', title: '(6) How Kingdom Was Made and Why The Creator Sold the IP - YouTube', url: 'https://youtube.com/watch?v=aaa' };
const balatro = { id: 'b', title: '(6) How Balatro Was Made and Why The Creator Expected to Sell Only 6 Copies - YouTube', url: 'https://youtube.com/watch?v=bbb' };
const named = nameCluster([kingdom, balatro], new Map([['was', 2], ['how', 2], ['made', 2], ['kingdom', 1], ['balatro', 1]]), 2, kingdom.title);
assert.ok(!/^was$/i.test(named), `制作访谈组不该叫 Was，实际：${named}`);
assert.ok(!/^how$/i.test(named), `不该叫 How，实际：${named}`);

const godotA = { id: 'g1', title: 'The ultimate introduction to Godot Control nodes', url: 'https://youtube.com/watch?v=g1' };
const godotB = { id: 'g2', title: 'Should You Use CSG to Make Levels? (Godot 4)', url: 'https://youtube.com/watch?v=g2' };
const godotName = nameCluster([godotA, godotB], new Map([['godot', 2], ['control', 1], ['csg', 1]]), 2, godotA.title);
assert.match(godotName, /godot/i);

function vec(vals) {
  return Float32Array.from(vals);
}
const lostA = { id: 'l1', title: '构建紧密的游戏因果系统 – Lostgarden', url: 'https://lostgarden.com/tight' };
const lostB = { id: 'l2', title: '便利贴设计文档 – Lostgarden', url: 'https://lostgarden.com/postit' };
const tiboA = { id: 't1', title: 'Thibaud Goiffon', url: 'https://gotibo.fr/' };
const tiboB = { id: 't2', title: 'Tibo making Wild Cosmos', url: 'https://bsky.app/profile/heytibo' };
const gmail = { id: 'm1', title: 'Inbox', url: 'https://mail.google.com/' };

const preview = clusterPreview(
  [lostA, lostB, tiboA, tiboB, gmail],
  [
    vec([1, 0, 0]),
    vec([0.98, 0.05, 0]),
    vec([0, 1, 0]),
    vec([0.05, 0.98, 0]),
    vec([0, 0, 1]),
  ],
);
assert.equal(preview.groups.length, 2, `应聚成两主题组，实际 ${preview.groups.map((g) => g.name).join(',')}`);
assert.equal(preview.ungrouped.map((t) => t.id).join(), 'm1');
const lost = preview.groups.find((g) => g.tabs.some((t) => t.id === 'l1'));
const tibo = preview.groups.find((g) => g.tabs.some((t) => t.id === 't1'));
assert.ok(lost.tabs.map((t) => t.id).sort().join() === 'l1,l2');
assert.ok(tibo.tabs.map((t) => t.id).sort().join() === 't1,t2');

const xGodot1 = { id: 'x1', title: 'Fence rails in #godot', url: 'https://x.com/pebble/status/1' };
const xGodot2 = { id: 'x2', title: 'Shaders Bible #godot', url: 'https://x.com/shaders/status/2' };
const xAi1 = { id: 'x3', title: 'MCP is an API but shittier', url: 'https://x.com/sick/status/3' };
const xAi2 = { id: 'x4', title: 'used grok 4.6 for a full day', url: 'https://x.com/kun/status/4' };
const xPreview = clusterPreview(
  [xGodot1, xGodot2, xAi1, xAi2],
  [vec([1, 0]), vec([0.97, 0.1]), vec([0, 1]), vec([0.1, 0.97])],
);
assert.equal(xPreview.groups.length, 2, 'X 不应整站一组');
assert.ok(xPreview.groups.every((g) => g.name !== 'X'), `套话站不要光秃 X：${xPreview.groups.map((g) => g.name)}`);

assert.equal(isUrlTitle('https://youtube.com/watch?v=1'), true);
assert.equal(isWeakNameToken('http'), true);
assert.equal(isWeakNameToken('https'), true);
assert.equal(isShellTab({ title: 'https://www.youtube.com/watch?v=abc', url: 'https://www.youtube.com/watch?v=abc' }), true);
assert.ok(!embedText({ title: 'https://www.youtube.com/watch?v=abc', url: 'https://www.youtube.com/watch?v=abc' }).includes('http'));

const urlA = { id: 'u1', title: 'https://www.youtube.com/watch?v=aaa', url: 'https://www.youtube.com/watch?v=aaa' };
const urlB = { id: 'u2', title: 'https://www.youtube.com/watch?v=bbb', url: 'https://www.youtube.com/watch?v=bbb' };
const urlName = nameCluster([urlA, urlB], new Map([['http', 2], ['https', 2], ['www', 2], ['youtube', 2]]), 2, urlA.title);
assert.ok(!/http/i.test(urlName), `网址标题组不该叫 Http，实际：${urlName}`);

const urlPreview = clusterPreview([urlA, urlB], [vec([1, 0]), vec([0.99, 0])]);
assert.ok(
  urlPreview.groups.every((g) => !/http/i.test(g.name)) && urlPreview.ungrouped.length + urlPreview.groups.length >= 1,
  `网址标题不该产出 Http 组：${urlPreview.groups.map((g) => g.name)}`,
);

const gemmaP = getClusterParams('onnx-community/embeddinggemma-300m-ONNX');
assert.ok(gemmaP.floor > MINILM_CLUSTER.floor);
assert.ok(gemmaP.cap > MINILM_CLUSTER.cap);
const gemmaPrefix = 'task: clustering | query: ';
assert.equal(
  embedText({ title: 'Inbox', url: 'https://mail.google.com/' }, gemmaPrefix, gemmaP.prefixMinBody).startsWith(gemmaPrefix),
  false,
  '短标题不加 Gemma 指令前缀',
);
assert.equal(
  embedText(
    { title: 'The ultimate introduction to Godot Control nodes', url: 'https://youtube.com/watch?v=g1' },
    gemmaPrefix,
    gemmaP.prefixMinBody,
  ).startsWith(gemmaPrefix),
  true,
  '长标题保留 Gemma 前缀',
);
const midA = { id: 'a', title: 'Alpha topic one', url: 'https://ex.com/a' };
const midB = { id: 'b', title: 'Alpha topic two', url: 'https://ex.com/b' };
const midVecs = [vec([1, 0]), vec([0.65, 0.76])];
assert.equal(clusterPreview([midA, midB], midVecs, MINILM_CLUSTER).groups.length, 1, 'MiniLM 封顶 0.62，0.65 应成组');
assert.equal(clusterPreview([midA, midB], midVecs, GEMMA_CLUSTER).groups.length, 0, 'Gemma 门槛更高，0.65 不成组');

console.log('browserEmbedClassify cluster/name ok');
