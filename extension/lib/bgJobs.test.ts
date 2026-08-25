import assert from 'node:assert/strict';
import { organizeStatusText, parseOrganizeJobResult, runOrganizeJob } from './bgJobs.js';

assert.equal(organizeStatusText('文件已齐，正在加载模型'), '正在加载模型');
assert.equal(organizeStatusText('下载中 42% · 1/3 个文件'), '正在加载模型');
assert.equal(organizeStatusText('加载 MiniLM-L6（内置）…'), '加载 MiniLM-L6（内置）…');
assert.equal(organizeStatusText('编码 3/16'), '编码 3/16');

const unknown = await runOrganizeJob('nope');
assert.equal(unknown.ok, false);
assert.equal(unknown.reason, 'stale_sw');
assert.match(String(unknown.error), /不支持的整理操作/);
assert.equal('preview' in unknown, false);

{
  const parsed = parseOrganizeJobResult({
    ok: true,
    apply: { created: 2, absorbTabs: 1 },
    source: 'browser-embed',
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.apply?.created, 2);
    assert.equal(parsed.source, 'browser-embed');
  }
  const fail = parseOrganizeJobResult({ ok: false, reason: 'too_few' });
  assert.equal(fail.ok, false);
  if (!fail.ok) assert.equal(fail.reason, 'too_few');
}

console.log('bgJobs ok');
