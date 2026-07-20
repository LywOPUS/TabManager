/**
 * Google Gemini Nano — Chrome 内置 Prompt API（LanguageModel）
 * 需 Chrome 桌面 + 硬件达标；Edge 通常不可用。失败由上层回退。
 */
import { registrableDomain } from './groupHeuristics.js';

function getLanguageModelAPI() {
  if (typeof LanguageModel !== 'undefined') return LanguageModel;
  if (globalThis.ai?.languageModel) return globalThis.ai.languageModel;
  return null;
}

const SESSION_OPTS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

export async function geminiNanoAvailability() {
  const API = getLanguageModelAPI();
  if (!API?.availability) return 'unsupported';
  try {
    return await API.availability(SESSION_OPTS);
  } catch {
    return 'unavailable';
  }
}

export async function classifyWithGeminiNano(items, { onStatus } = {}) {
  const API = getLanguageModelAPI();
  if (!API) throw new Error('LanguageModel API 不可用（需 Chrome 内置 Gemini Nano）');

  onStatus?.('检查 Gemini Nano…');
  const availability = await API.availability(SESSION_OPTS);
  if (availability === 'unavailable') {
    throw new Error('此设备/浏览器不支持 Gemini Nano');
  }

  onStatus?.(
    availability === 'downloading' || availability === 'downloadable'
      ? '正在下载 Gemini Nano（仅首次，体积较大）…'
      : '启动 Gemini Nano…',
  );

  const session = await API.create({
    ...SESSION_OPTS,
    temperature: 0.2,
    topK: 3,
    monitor(m) {
      m.addEventListener?.('downloadprogress', (e) => {
        const pct = Math.round((e.loaded || 0) * 100);
        onStatus?.(`下载 Gemini Nano ${pct}%`);
      });
    },
  });

  try {
    const compact = items.map((t) => ({
      id: t.id,
      title: (t.title || '').slice(0, 80),
      domain: registrableDomain(t.url) || '',
    }));

    onStatus?.('Gemini Nano 分类中…');
    const schema = {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              ids: { type: 'array', items: { type: 'string' } },
            },
            required: ['name', 'ids'],
          },
        },
        ungrouped: { type: 'array', items: { type: 'string' } },
      },
      required: ['groups'],
    };

    const prompt = [
      'Classify browser tabs into 2-8 topic groups.',
      'Use short Chinese or English group names.',
      'Only use ids from the input. Put uncertain tabs in ungrouped.',
      'Input JSON:',
      JSON.stringify(compact),
    ].join('\n');

    const raw = await session.prompt(prompt, { responseConstraint: schema });
    return parsePreview(raw, items);
  } finally {
    try {
      session.destroy?.();
    } catch {
      /* ignore */
    }
  }
}

function parsePreview(text, items) {
  const byId = new Map(items.map((t) => [t.id, t]));
  let parsed;
  try {
    parsed = typeof text === 'string' ? JSON.parse(extractJson(text)) : text;
  } catch {
    throw new Error('Gemini Nano 返回无法解析');
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
