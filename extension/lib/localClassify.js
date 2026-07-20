import { suggestGroups, registrableDomain } from './groupHeuristics.js';
import { classifyWithBrowserEmbed } from './browserEmbedClassify.js';
import { classifyWithGeminiNano } from './geminiClassify.js';

/**
 * classifyMode: site | browser | gemini | ollama
 * gemini = Chrome 内置 Gemini Nano；browser = Transformers.js；失败回退站点
 */
export async function suggestGroupsSmart(items, options = {}) {
  const {
    classifyMode = 'site',
    useLocalModel = false, // 兼容旧调用
    browserModelId,
    preferWebGPU = true,
    baseUrl,
    model,
    onStatus,
  } = options;

  let mode = classifyMode;
  if (!options.classifyMode && useLocalModel) mode = 'ollama';

  if (!items.length || mode === 'site') {
    return { preview: suggestGroups(items), source: 'heuristic' };
  }

  if (mode === 'gemini') {
    try {
      const preview = await classifyWithGeminiNano(items, { onStatus });
      if (!preview.groups.length) {
        onStatus?.('Gemini 组不足，回退站点分组');
        return { preview: suggestGroups(items), source: 'heuristic-fallback' };
      }
      return { preview, source: 'gemini-nano' };
    } catch (e) {
      console.warn('gemini nano fallback', e);
      onStatus?.(`Gemini Nano 不可用（${e.message || e}），已回退站点`);
      return { preview: suggestGroups(items), source: 'heuristic-fallback', error: String(e?.message || e) };
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
        return { preview: suggestGroups(items), source: 'heuristic-fallback' };
      }
      return { preview, source: 'browser-embed' };
    } catch (e) {
      console.warn('browser embed fallback', e);
      onStatus?.('浏览器模型不可用，已回退站点分组');
      return { preview: suggestGroups(items), source: 'heuristic-fallback', error: String(e?.message || e) };
    }
  }

  if (mode === 'ollama') {
    try {
      onStatus?.('正在请求本地 Ollama…');
      const preview = await classifyWithOllama(items, { baseUrl, model, onStatus });
      if (!preview.groups.length && !preview.ungrouped.length) {
        throw new Error('empty model result');
      }
      return { preview, source: 'local-model' };
    } catch (e) {
      console.warn('ollama fallback', e);
      onStatus?.('Ollama 不可用，已回退站点分组');
      return { preview: suggestGroups(items), source: 'heuristic-fallback', error: String(e?.message || e) };
    }
  }

  return { preview: suggestGroups(items), source: 'heuristic' };
}

// Ollama 分批：小模型输出 num_predict 有限，全量上百个 id 必截断 JSON。
// 分批后同名组归并；不同批次表述略异（“前端”/“前端开发”）会保留为两组，交给用户合并。
const OLLAMA_BATCH = 40;

async function classifyWithOllama(items, { baseUrl, model, onStatus }) {
  if (items.length <= OLLAMA_BATCH) return ollamaRequest(items, { baseUrl, model });
  // 串行而非并发：本地小模型并发请求容易内存打爆，且 ollama 默认也要排队
  const merged = new Map(); // name -> group
  const ungrouped = [];
  const total = Math.ceil(items.length / OLLAMA_BATCH);
  for (let b = 0; b < total; b += 1) {
    onStatus?.(`Ollama 分批分类 ${b + 1}/${total}…`);
    const batch = items.slice(b * OLLAMA_BATCH, (b + 1) * OLLAMA_BATCH);
    const r = await ollamaRequest(batch, { baseUrl, model });
    for (const g of r.groups) {
      let m = merged.get(g.name);
      if (!m) {
        m = { key: g.name, name: g.name, tabIds: [], tabs: [] };
        merged.set(g.name, m);
      }
      m.tabs.push(...g.tabs);
      m.tabIds.push(...g.tabIds);
    }
    ungrouped.push(...r.ungrouped);
  }
  const groups = [...merged.values()];
  groups.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return { groups, ungrouped };
}

async function ollamaRequest(items, { baseUrl, model }) {
  const compact = items.map((t) => ({
    id: t.id,
    title: (t.title || '').slice(0, 80),
    domain: registrableDomain(t.url) || '',
  }));
  const body = {
    model: model || 'qwen2.5:0.5b',
    stream: false,
    format: 'json',
    options: { temperature: 0.2, num_predict: 1024 },
    messages: [
      {
        role: 'system',
        content:
          '你是标签分类助手。把标签分到少量中文主题组（2–8 组）。只输出 JSON：'
          + '{"groups":[{"name":"主题","ids":["id1"]}],"ungrouped":["id2"]}。'
          + 'ids 必须来自输入，且每个 id 只出现一次；同主题放一组；无法判断的放 ungrouped。',
      },
      { role: 'user', content: JSON.stringify(compact) },
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
  groups.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return { groups, ungrouped };
}

function extractJson(text) {
  const s = String(text).trim();
  if (s.startsWith('{')) return s;
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no json');
  return m[0];
}
