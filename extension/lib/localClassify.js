import { registrableDomain } from './groupHeuristics.js';
import { finalizePreview, suggestGroups } from './groupLabels.js';
import { classifyWithBrowserEmbed } from './browserEmbedClassify.js';
import { classifyWithGeminiNano } from './geminiClassify.js';
import { ensureRemoteHostPermission } from './settings.js';

/**
 * classifyMode: site | browser | gemini | ollama | openai
 * groupQuality: fast | enhanced
 *   fast     = 单次分类 + 分批近义名合并（无第二轮模型、无后处理）
 *   enhanced = 主题提示加强 + 域名回填后处理 +（OpenAI）近义组模型合并
 */
export async function suggestGroupsSmart(items, options = {}) {
  const {
    classifyMode = 'site',
    useLocalModel = false, // 兼容旧调用
    groupQuality = 'fast',
    browserModelId,
    preferWebGPU = true,
    baseUrl,
    model,
    apiKey,
    remoteBaseUrl,
    remoteModel,
    onStatus,
  } = options;

  const enhanced = groupQuality === 'enhanced';
  let mode = classifyMode;
  if (!options.classifyMode && useLocalModel) mode = 'ollama';

  const finish = (preview, source, extra = {}) => ({
    preview: finalizePreview(preview),
    source,
    ...extra,
  });

  if (!items.length || mode === 'site') {
    return finish(suggestGroups(items), 'heuristic');
  }

  if (mode === 'gemini') {
    try {
      const preview = await classifyWithGeminiNano(items, { onStatus });
      if (!preview.groups.length) {
        onStatus?.('Gemini 组不足，回退站点分组');
        return finish(suggestGroups(items), 'heuristic-fallback');
      }
      return finish(enhanced ? postProcessPreview(items, preview) : preview, 'gemini-nano');
    } catch (e) {
      console.warn('gemini nano fallback', e);
      onStatus?.(`Gemini Nano 不可用（${e.message || e}），已回退站点`);
      return finish(suggestGroups(items), 'heuristic-fallback', { error: String(e?.message || e) });
    }
  }

  if (mode === 'browser') {
    try {
      const preview = await classifyWithBrowserEmbed(items, {
        onStatus,
        modelId: browserModelId,
        preferWebGPU,
      });
      if (!preview.groups.length) {
        onStatus?.('语义组不足，回退站点分组');
        return finish(suggestGroups(items), 'heuristic-fallback');
      }
      return finish(enhanced ? postProcessPreview(items, preview) : preview, 'browser-embed');
    } catch (e) {
      console.warn('browser embed fallback', e);
      onStatus?.('浏览器模型不可用，已回退站点分组');
      return finish(suggestGroups(items), 'heuristic-fallback', { error: String(e?.message || e) });
    }
  }

  if (mode === 'ollama') {
    try {
      onStatus?.('正在请求本地 Ollama…');
      const preview = await classifyWithOllama(items, {
        baseUrl,
        model,
        onStatus,
        enhanced,
      });
      if (!preview.groups.length && !preview.ungrouped.length) {
        throw new Error('empty model result');
      }
      return finish(enhanced ? postProcessPreview(items, preview) : preview, 'local-model');
    } catch (e) {
      console.warn('ollama fallback', e);
      onStatus?.('Ollama 不可用，已回退站点分组');
      return finish(suggestGroups(items), 'heuristic-fallback', { error: String(e?.message || e) });
    }
  }

  if (mode === 'openai') {
    try {
      const endpoint = remoteBaseUrl || baseUrl;
      onStatus?.('检查 OpenAI 主机权限…');
      const hostOk = await ensureRemoteHostPermission(endpoint);
      if (!hostOk) {
        const err = '未授予 OpenAI 兼容接口主机权限';
        onStatus?.(err);
        return finish(suggestGroups(items), 'heuristic-fallback', { error: err });
      }
      onStatus?.(enhanced ? '增强模式：请求 OpenAI 兼容接口…' : '快速模式：请求 OpenAI 兼容接口…');
      const preview = await classifyWithOpenAI(items, {
        baseUrl: endpoint,
        apiKey,
        model: remoteModel || model,
        onStatus,
        enhanced,
      });
      if (!preview.groups.length && !preview.ungrouped.length) {
        throw new Error('empty model result');
      }
      return finish(enhanced ? postProcessPreview(items, preview) : preview, 'openai');
    } catch (e) {
      console.warn('openai fallback', e);
      onStatus?.(`OpenAI 兼容接口不可用（${e.message || e}），已回退站点`);
      return finish(suggestGroups(items), 'heuristic-fallback', { error: String(e?.message || e) });
    }
  }

  return finish(suggestGroups(items), 'heuristic');
}

// 分批：输出 token 有限，全量上百个 id 易截断 JSON。
const MODEL_BATCH = 40;
// 主题组上限提示（按规模动态收紧，避免碎组）
function targetGroupHint(n) {
  if (n <= 12) return '2–4';
  if (n <= 40) return '3–6';
  if (n <= 80) return '4–8';
  return '5–10';
}

const CLASSIFY_SYSTEM_FAST =
  '你是标签分类助手。把标签分到少量中文主题组。只输出 JSON：'
  + '{"groups":[{"name":"主题","ids":["id1"]}],"ungrouped":["id2"]}。'
  + 'ids 必须来自输入，且每个 id 只出现一次；同主题放一组；无法判断的放 ungrouped。';

const CLASSIFY_SYSTEM_ENHANCED =
  '你是浏览器标签主题分类助手。按「用户意图/主题」分组，而不是机械按域名。'
  + '规则：'
  + '1) 同主题可跨站点合并（如多个文档站都是「React 文档」）；'
  + '2) 组名用简短中文主题（2–8 字），不要用裸域名当组名，除非整组确实是同一站点且无更好主题；'
  + '3) 少而清晰：优先合并相近主题，避免一对一碎组；'
  + '4) 每个 id 只能出现一次，且必须来自输入；无法判断的放 ungrouped；'
  + '5) 只输出 JSON：{"groups":[{"name":"主题","ids":["id1"]}],"ungrouped":["id2"]}。';

function compactItems(items) {
  return items.map((t) => ({
    id: t.id,
    title: (t.title || '').slice(0, 80),
    domain: registrableDomain(t.url) || '',
  }));
}

function classifyUserContent(items, enhanced) {
  const compact = compactItems(items);
  if (!enhanced) return JSON.stringify(compact);
  const domains = new Map();
  for (const t of compact) {
    if (!t.domain) continue;
    domains.set(t.domain, (domains.get(t.domain) || 0) + 1);
  }
  const topDomains = [...domains.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([d, n]) => `${d}×${n}`);
  return JSON.stringify({
    hint: `共 ${items.length} 个标签，建议分成 ${targetGroupHint(items.length)} 个主题组。高频域名：${topDomains.join('、') || '无'}。`,
    tabs: compact,
  });
}

function classifySystem(enhanced) {
  return enhanced ? CLASSIFY_SYSTEM_ENHANCED : CLASSIFY_SYSTEM_FAST;
}

async function classifyWithOllama(items, { baseUrl, model, onStatus, enhanced }) {
  if (items.length <= MODEL_BATCH) return ollamaRequest(items, { baseUrl, model, enhanced });
  const parts = [];
  const total = Math.ceil(items.length / MODEL_BATCH);
  for (let b = 0; b < total; b += 1) {
    onStatus?.(`Ollama 分批分类 ${b + 1}/${total}…`);
    const batch = items.slice(b * MODEL_BATCH, (b + 1) * MODEL_BATCH);
    parts.push(await ollamaRequest(batch, { baseUrl, model, enhanced }));
  }
  return mergeBatchedPreviews(parts);
}

async function ollamaRequest(items, { baseUrl, model, enhanced }) {
  const body = {
    model: model || 'qwen2.5:0.5b',
    stream: false,
    format: 'json',
    options: { temperature: enhanced ? 0.15 : 0.2, num_predict: enhanced ? 1400 : 1024 },
    messages: [
      { role: 'system', content: classifySystem(enhanced) },
      { role: 'user', content: classifyUserContent(items, enhanced) },
    ],
  };
  const root = String(baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  let res;
  try {
    res = await fetch(`${root}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const data = await res.json();
  const text = data?.message?.content || data?.response || '';
  return parseModelPreview(text, items);
}

async function classifyWithOpenAI(items, { baseUrl, apiKey, model, onStatus, enhanced }) {
  if (!String(apiKey || '').trim()) throw new Error('未配置 API Key');
  let preview;
  if (items.length <= MODEL_BATCH) {
    preview = await openAIRequest(items, { baseUrl, apiKey, model, enhanced });
  } else {
    const parts = [];
    const total = Math.ceil(items.length / MODEL_BATCH);
    for (let b = 0; b < total; b += 1) {
      onStatus?.(`OpenAI 兼容分批分类 ${b + 1}/${total}…`);
      const batch = items.slice(b * MODEL_BATCH, (b + 1) * MODEL_BATCH);
      parts.push(await openAIRequest(batch, { baseUrl, apiKey, model, enhanced }));
    }
    preview = mergeBatchedPreviews(parts);
  }
  if (enhanced && preview.groups.length >= 4) {
    onStatus?.('合并近义主题组…');
    preview = await mergeSynonymGroupsOpenAI(preview, { baseUrl, apiKey, model });
  }
  return preview;
}

async function openAIChat(root, apiKey, body, timeoutMs = 45000) {
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

async function openAIRequest(items, { baseUrl, apiKey, model, enhanced }) {
  const root = String(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const baseBody = {
    model: model || 'gpt-4o-mini',
    temperature: enhanced ? 0.15 : 0.2,
    messages: [
      { role: 'system', content: classifySystem(enhanced) },
      { role: 'user', content: classifyUserContent(items, enhanced) },
    ],
  };
  let res = await openAIChat(root, apiKey, {
    ...baseBody,
    response_format: { type: 'json_object' },
  });
  // 部分中转不支持 response_format：去掉后重试，靠 extractJson 解析
  if (res.status === 400) {
    res = await openAIChat(root, apiKey, baseBody);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const hint = errText.slice(0, 80);
    throw new Error(`openai ${res.status}${hint ? `: ${hint}` : ''}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return parseModelPreview(text, items);
}

/** 把「前端 / 前端开发」这类近义组名并到同一桶（不调模型） */
function normalizeGroupName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[「」『』"'`]/g, '')
    .replace(/\s+/g, '')
    .replace(/(相关|专题|合集|系列|分组|标签|页面|网站|站点)$/g, '')
    .replace(/(开发|学习|教程|文档|资料|资源|研究|项目)$/g, '')
    .replace(/[·.•\-_/|]+/g, '');
}

function mergeBatchedPreviews(parts) {
  const byNorm = new Map(); // norm -> group
  const ungrouped = [];
  for (const part of parts) {
    for (const g of part.groups || []) {
      const norm = normalizeGroupName(g.name) || g.name;
      let m = byNorm.get(norm);
      if (!m) {
        m = { key: g.name, name: g.name, tabIds: [], tabs: [] };
        byNorm.set(norm, m);
      } else if (g.name.length < m.name.length) {
        // 保留更短、更干净的组名
        m.name = g.name;
        m.key = g.name;
      }
      m.tabs.push(...g.tabs);
      m.tabIds.push(...g.tabIds);
    }
    ungrouped.push(...(part.ungrouped || []));
  }
  // 去重 tab（跨批偶发重复 id）
  for (const g of byNorm.values()) {
    const seen = new Set();
    const tabs = [];
    for (const t of g.tabs) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      tabs.push(t);
    }
    g.tabs = tabs;
    g.tabIds = tabs.map((t) => t.id);
  }
  const groups = [...byNorm.values()].filter((g) => g.tabs.length >= 2);
  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.name.localeCompare(b.name, 'zh'));
  const used = new Set(groups.flatMap((g) => g.tabIds));
  const rest = [];
  const seenU = new Set();
  for (const t of ungrouped) {
    if (used.has(t.id) || seenU.has(t.id)) continue;
    seenU.add(t.id);
    rest.push(t);
  }
  return { groups, ungrouped: rest };
}

/**
 * OpenAI：把近义组名再压一轮（组很多时）。失败则原样返回。
 * 输入仅组名列表，成本低。
 */
async function mergeSynonymGroupsOpenAI(preview, { baseUrl, apiKey, model }) {
  if (!preview.groups || preview.groups.length < 4) return preview;
  const names = preview.groups.map((g) => g.name);
  const root = String(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const body = {
    model: model || 'gpt-4o-mini',
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content:
          '你负责合并近义的标签分组名。输入是一组中文/英文组名。'
          + '把意思相同或高度相近的名字归到同一 canonical（选最短清晰者）。'
          + '不要发明输入里没有语义的新主题；不要过度合并无关主题。'
          + '只输出 JSON：{"merges":[{"canonical":"前端","aliases":["前端开发","前端相关"]}]}。'
          + '无需合并的名字可以不出现，或 aliases 为空。',
      },
      { role: 'user', content: JSON.stringify({ names }) },
    ],
    response_format: { type: 'json_object' },
  };
  try {
    let res = await openAIChat(root, apiKey, body, 25000);
    if (res.status === 400) {
      const { response_format: _, ...noFmt } = body;
      res = await openAIChat(root, apiKey, noFmt, 25000);
    }
    if (!res.ok) return preview;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(extractJson(text));
    const aliasToCanon = new Map();
    for (const m of parsed.merges || []) {
      const canon = String(m.canonical || '').trim();
      if (!canon) continue;
      aliasToCanon.set(normalizeGroupName(canon), canon);
      for (const a of m.aliases || []) {
        const al = String(a || '').trim();
        if (al) aliasToCanon.set(normalizeGroupName(al), canon);
      }
    }
    if (!aliasToCanon.size) return preview;
    const byCanon = new Map();
    for (const g of preview.groups) {
      const canon = aliasToCanon.get(normalizeGroupName(g.name)) || g.name;
      let m = byCanon.get(canon);
      if (!m) {
        m = { key: canon, name: canon, tabIds: [], tabs: [] };
        byCanon.set(canon, m);
      }
      m.tabs.push(...g.tabs);
      m.tabIds.push(...g.tabIds);
    }
    const groups = [...byCanon.values()].filter((g) => g.tabs.length >= 2);
    groups.sort((a, b) => b.tabs.length - a.tabs.length || a.name.localeCompare(b.name, 'zh'));
    return { groups, ungrouped: preview.ungrouped || [] };
  } catch (e) {
    console.warn('synonym merge skipped', e);
    return preview;
  }
}

function parseModelPreview(text, items) {
  const byId = new Map(items.map((t) => [t.id, t]));
  let parsed;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    throw new Error('invalid json from model');
  }
  const used = new Set();
  const groups = [];
  for (const g of parsed.groups || []) {
    const name = String(g.name || '分组').slice(0, 40);
    const tabs = (g.ids || []).map((id) => byId.get(String(id))).filter(Boolean);
    const uniq = [];
    for (const t of tabs) {
      if (used.has(t.id)) continue;
      used.add(t.id);
      uniq.push(t);
    }
    if (uniq.length >= 2) {
      groups.push({ key: name, name, tabIds: uniq.map((t) => t.id), tabs: uniq });
    } else {
      for (const t of uniq) used.delete(t.id);
    }
  }
  const ungrouped = items.filter((t) => !used.has(t.id));
  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.name.localeCompare(b.name, 'zh'));
  return { groups, ungrouped };
}

/**
 * 后处理：同域未分组项并入已有「同域占优」组；剩余同域≥2 自成站点组。
 */
function postProcessPreview(items, preview) {
  const groups = (preview.groups || []).map((g) => ({
    ...g,
    tabs: [...(g.tabs || [])],
    tabIds: [...(g.tabIds || g.tabs?.map((t) => t.id) || [])],
  }));
  const used = new Set(groups.flatMap((g) => g.tabIds));
  let ungrouped = (preview.ungrouped || items.filter((t) => !used.has(t.id))).filter((t) => !used.has(t.id));

  // 组的主域名（≥50% 成员同域）
  const groupDomain = new Map();
  for (const g of groups) {
    const freq = new Map();
    for (const t of g.tabs) {
      const d = registrableDomain(t.url);
      if (d) freq.set(d, (freq.get(d) || 0) + 1);
    }
    let best = null;
    let bestN = 0;
    for (const [d, n] of freq) {
      if (n > bestN) {
        best = d;
        bestN = n;
      }
    }
    if (best && bestN / g.tabs.length >= 0.5) groupDomain.set(g, best);
  }

  const still = [];
  for (const t of ungrouped) {
    const d = registrableDomain(t.url);
    if (!d) {
      still.push(t);
      continue;
    }
    const host = groups.find((g) => groupDomain.get(g) === d);
    if (host) {
      host.tabs.push(t);
      host.tabIds.push(t.id);
      used.add(t.id);
    } else {
      still.push(t);
    }
  }

  // 剩余同域 ≥2：补站点组
  const byDomain = new Map();
  const noDomain = [];
  for (const t of still) {
    const d = registrableDomain(t.url);
    if (!d) {
      noDomain.push(t);
      continue;
    }
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(t);
  }
  const usedNames = new Set(groups.map((g) => g.name));
  for (const [d, tabs] of byDomain) {
    if (tabs.length >= 2) {
      let name = d;
      for (let i = 2; usedNames.has(name); i += 1) name = `${d} · ${i}`;
      usedNames.add(name);
      groups.push({ key: name, name, tabIds: tabs.map((t) => t.id), tabs });
    } else {
      noDomain.push(...tabs);
    }
  }

  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.name.localeCompare(b.name, 'zh'));
  return { groups, ungrouped: noDomain };
}

function extractJson(text) {
  const s = String(text).trim();
  if (s.startsWith('{')) return s;
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no json');
  return m[0];
}

export const __test__ = {
  normalizeGroupName,
  mergeBatchedPreviews,
  postProcessPreview,
  targetGroupHint,
  finalizePreview,
};
