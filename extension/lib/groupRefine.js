/**
 * 本地聚类之后：只把每组几条代表标题发给远程，起名并剔掉跑题项。
 * 失败由调用方忽略，保留聚类结果。
 */
import { registrableDomain } from './groupHeuristics.js';
import { ensureRemoteHostPermission } from './settings.js';

const REFINE_SYSTEM =
  '你是浏览器标签分组校对。输入是已经按主题聚好的组，每组只有几个代表标题。'
  + '对每组：1) name 用 2–8 字中文主题，不要标题残词（Was/How/Best/Ultimate），不要裸域名（除非整组只是同一工具站且无更好主题）；'
  + '2) reject 列出预告片、纯音乐/氛围音乐、网站首页空壳、和该组主题明显无关的 id。'
  + '同主题跨站用同一个 name。不要发明输入里没有的组。'
  + '只输出 JSON：{"groups":[{"key":"g0","name":"Godot教程","reject":["id3"]}]}。';

function sampleTabs(tabs, n = 5) {
  const list = tabs || [];
  if (list.length <= n) return list;
  const out = [];
  const seen = new Set();
  const step = (list.length - 1) / (n - 1);
  for (let i = 0; i < n; i += 1) {
    const t = list[Math.round(i * step)];
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

export function compactRefinePayload(preview) {
  return (preview?.groups || []).map((g, i) => ({
    key: `g${i}`,
    name: g.name,
    samples: sampleTabs(g.tabs, 5).map((t) => ({
      id: String(t.id),
      title: String(t.title || '').slice(0, 80),
      domain: registrableDomain(t.url) || '',
    })),
  }));
}

export function applyGroupRefine(preview, parsed) {
  const specs = new Map();
  for (const s of parsed?.groups || []) {
    const key = String(s?.key || '').trim();
    if (key) specs.set(key, s);
  }
  const groups = [];
  const extra = [];
  for (let i = 0; i < (preview?.groups || []).length; i += 1) {
    const g = preview.groups[i];
    const spec = specs.get(`g${i}`) || specs.get(g.key) || specs.get(g.name);
    const reject = new Set((spec?.reject || []).map((id) => String(id)));
    const keep = [];
    for (const t of g.tabs || []) {
      if (reject.has(String(t.id))) extra.push(t);
      else keep.push(t);
    }
    if (keep.length < 2) {
      extra.push(...keep);
      continue;
    }
    const name = String(spec?.name || g.name || '主题').trim().slice(0, 24) || g.name;
    groups.push({
      key: name,
      name,
      tabs: keep,
      tabIds: keep.map((t) => t.id),
    });
  }
  const seen = new Set();
  const ungrouped = [];
  for (const t of [...(preview?.ungrouped || []), ...extra]) {
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    ungrouped.push(t);
  }
  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.name.localeCompare(b.name, 'zh'));
  return { groups, ungrouped };
}

async function openAIChat(root, apiKey, body, timeoutMs = 35000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${root}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${String(apiKey).trim()}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  const s = String(text).trim();
  if (s.startsWith('{')) return s;
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no json');
  return m[0];
}

/**
 * @returns {Promise<object>} 校对后的 preview
 */
export async function refineGroupsOpenAI(preview, { baseUrl, apiKey, model, onStatus } = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('未配置 API Key');
  if (!preview?.groups?.length) return preview;
  const hostOk = await ensureRemoteHostPermission(baseUrl);
  if (!hostOk) throw new Error('未授予 OpenAI 兼容接口主机权限');

  const payload = compactRefinePayload(preview);
  onStatus?.(`远程起名 / 剔脏（${payload.length} 组代表标题）…`);
  const root = String(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const body = {
    model: model || 'gpt-4o-mini',
    temperature: 0.15,
    messages: [
      { role: 'system', content: REFINE_SYSTEM },
      { role: 'user', content: JSON.stringify({ groups: payload }) },
    ],
  };
  let res = await openAIChat(root, key, { ...body, response_format: { type: 'json_object' } });
  if (res.status === 400) res = await openAIChat(root, key, body);
  if (!res.ok) {
    const hint = (await res.text().catch(() => '')).slice(0, 80);
    throw new Error(`openai ${res.status}${hint ? `: ${hint}` : ''}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(extractJson(text));
  const next = applyGroupRefine(preview, parsed);
  if (!next.groups.length) return preview;
  return next;
}
