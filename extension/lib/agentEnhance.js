/**
 * 收纳后的 agent 增强：提议（分组 + 命名）与确认应用分离。
 * 在扩展页面上下文（管理页 / popup）调用；service worker 不跑模型。
 */
import { mutateData, newId } from './storage.js';
import { suggestGroupsSmart } from './localClassify.js';
import {
  READ_LATER_NAME,
  UNGROUPED_NAME,
  ensureFixedGroups,
  isReadLaterName,
  isReservedGroupName,
  sortSessionGroups,
} from './groupNames.js';

/** 把 suggest 预览写回 session（就地修改 groups）；「稍后阅读」整组保留不动 */
export function applyPreviewToSession(session, preview) {
  const { readLater } = ensureFixedGroups(session, { newId });
  const readLaterIds = new Set((readLater.tabs || []).map((t) => t.id));
  const readLaterTabs = [...(readLater.tabs || [])];

  const flat = [];
  for (const g of session.groups) {
    if (isReadLaterName(g.name)) continue;
    for (const t of g.tabs) flat.push(t);
  }
  const byId = new Map(flat.map((t) => [t.id, t]));
  const used = new Set();
  const groups = [];

  for (const g of preview.groups || []) {
    const rawName = String(g.name || '分组').slice(0, 40);
    // 模型若输出「稍后阅读」，并入固定组而非另建同名组
    if (isReadLaterName(rawName)) {
      for (const id of g.tabIds || []) {
        const t = byId.get(id);
        if (t && !used.has(t.id) && !readLaterIds.has(t.id)) {
          used.add(t.id);
          readLaterTabs.push(t);
          readLaterIds.add(t.id);
        }
      }
      continue;
    }
    const tabs = [];
    for (const id of g.tabIds || []) {
      const t = byId.get(id);
      if (t && !used.has(t.id)) {
        used.add(t.id);
        tabs.push(t);
      }
    }
    if (tabs.length) {
      const name = isReservedGroupName(rawName) ? '分组' : rawName;
      groups.push({ id: newId(), name, tabs });
    }
  }
  const rest = flat.filter((t) => !used.has(t.id));
  if (rest.length || !groups.length) {
    groups.push({ id: newId(), name: UNGROUPED_NAME, tabs: rest });
  }
  session.groups = sortSessionGroups([
    { id: readLater.id, name: READ_LATER_NAME, tabs: readLaterTabs },
    ...groups.filter((g) => !isReadLaterName(g.name)),
  ]);
  ensureFixedGroups(session, { newId });
}

function cleanName(text) {
  const line = String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean);
  if (!line) return '';
  const stripped = line
    .replace(/^[「『"'\s]+|[」』"'\s。.,;:!?；：，．]+$/g, '')
    .trim();
  if (!stripped || stripped.length < 2) return '';
  return stripped.slice(0, 24);
}

/** 会话名兜底：用模型给出的最大两个组名，不用域名 */
function nameFromGroups(groups) {
  const sized = (groups || [])
    .filter((g) => g.name && !isReservedGroupName(g.name))
    .map((g) => ({ name: g.name, n: (g.tabIds || g.tabs || []).length }))
    .sort((a, b) => b.n - a.n);
  if (sized.length) return sized.slice(0, 2).map((g) => g.name).join(' · ');
  return '';
}

const NAME_SYSTEM =
  '你是中文命名助手。根据一组浏览器标签的标题，给这个标签会话起一个简短名称'
  + '（不超过 12 个字）。只输出名称本身，不要解释、不要引号、不要标点结尾。';

async function nameWithOllama(titles, { baseUrl, model }) {
  const root = String(baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(`${root}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: model || 'qwen2.5:0.5b',
        stream: false,
        options: { temperature: 0.3, num_predict: 48 },
        messages: [
          { role: 'system', content: NAME_SYSTEM },
          { role: 'user', content: titles.join('\n') },
        ],
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const data = await res.json();
  return cleanName(data?.message?.content || data?.response || '');
}

async function nameWithOpenAI(titles, { remoteBaseUrl, baseUrl, apiKey, remoteModel, model }) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('未配置 API Key');
  const root = String(remoteBaseUrl || baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(`${root}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: remoteModel || model || 'gpt-4o-mini',
        temperature: 0.3,
        messages: [
          { role: 'system', content: NAME_SYSTEM },
          { role: 'user', content: titles.join('\n') },
        ],
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const data = await res.json();
  return cleanName(data?.choices?.[0]?.message?.content || '');
}

async function nameWithGemini(titles) {
  const API = typeof LanguageModel !== 'undefined' ? LanguageModel : globalThis.ai?.languageModel;
  if (!API) throw new Error('LanguageModel API 不可用');
  const availability = await API.availability();
  if (availability === 'unavailable') throw new Error('Gemini Nano 不可用');
  const session = await API.create({ temperature: 0.3, topK: 3 });
  try {
    const raw = await session.prompt(
      'Give a short title (at most 8 words) for a saved browser tab session with these tab titles. '
        + 'Reply with the title only — no quotes, no explanation. Use Chinese if most titles are Chinese.\n'
        + titles.join('\n'),
    );
    return cleanName(raw);
  } finally {
    try {
      session.destroy?.();
    } catch {
      /* ignore */
    }
  }
}

/**
 * 生成增强提议（不写存储）：
 * - preview：分组预览（suggestGroupsSmart）
 * - name：建议会话名；opts.withName 为真且增强档时用模型命名，否则用模型组名拼接
 *
 * opts 同 suggestGroupsSmart（含 groupQuality），另加 withName?: boolean。
 * 模型命名仅在 groupQuality === 'enhanced' 时调用。
 * 返回 { preview, source, error, name }。
 */
export async function proposeEnhancement(items, opts = {}, { onStatus } = {}) {
  const { withName, ...classifyOpts } = opts;
  onStatus?.('生成分组');
  const { preview, source, error } = await suggestGroupsSmart(items, { ...classifyOpts, onStatus });

  let name = '';
  const useModelName = withName && opts.groupQuality === 'enhanced';
  if (useModelName && !error) {
    onStatus?.('生成会话名');
    const titles = items.slice(0, 40).map((t) => (t.title || '').slice(0, 60)).filter(Boolean);
    try {
      if (opts.classifyMode === 'ollama') name = await nameWithOllama(titles, opts);
      else if (opts.classifyMode === 'openai') name = await nameWithOpenAI(titles, opts);
      else if (opts.classifyMode === 'gemini') name = await nameWithGemini(titles);
    } catch (e) {
      console.warn('session naming skipped', e);
    }
  }
  if (!name) name = nameFromGroups(preview.groups);
  return { preview, source, error, name };
}

/**
 * 确认后应用：把预览分组与（可选）会话名写回存储。
 * preview 传 null 可只改名。
 */
export async function applyEnhancement(sessionId, { preview, name } = {}) {
  return mutateData((data) => {
    const session = data.sessions.find((s) => s.id === sessionId);
    if (!session) return { ok: false, reason: 'missing' };
    const grouped = !!preview?.groups?.length;
    if (grouped) applyPreviewToSession(session, preview);
    const renamed = !!name && name !== session.name;
    if (renamed) session.name = name;
    return { ok: true, grouped, renamed, name: session.name };
  });
}
