import { DEFAULT_BROWSER_MODEL } from './browserModels.js';

const KEY = 'tabManagerSettings';

const DEFAULTS = {
  classifyMode: 'site', // site | browser | gemini | ollama | openai
  /** fast = 单次分类；enhanced = 后处理 +（OpenAI）近义组合并 + 模型命名 */
  groupQuality: 'fast', // fast | enhanced
  browserModelId: DEFAULT_BROWSER_MODEL,
  preferWebGPU: true,
  stashReview: true, // 收纳后弹确认（分组+命名）；false = 静默自动整理
  localModel: {
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen2.5:0.5b',
  },
  remoteModel: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
};

/** OpenAI 兼容端点：去尾斜杠；无 /v1 后缀则补上 */
export function normalizeOpenAIBaseUrl(raw) {
  let s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return DEFAULTS.remoteModel.baseUrl;
  if (!/\/v1$/i.test(s)) s = `${s}/v1`;
  return s;
}

export async function getSettings() {
  const r = await chrome.storage.local.get(KEY);
  const s = r[KEY] || {};
  let classifyMode = s.classifyMode || DEFAULTS.classifyMode;
  if (!s.classifyMode && s.localModel?.enabled) classifyMode = 'ollama';
  const remoteModel = { ...DEFAULTS.remoteModel, ...(s.remoteModel || {}) };
  if (remoteModel.baseUrl) {
    remoteModel.baseUrl = normalizeOpenAIBaseUrl(remoteModel.baseUrl);
  }
  const gq = s.groupQuality === 'enhanced' ? 'enhanced' : 'fast';
  return {
    classifyMode,
    groupQuality: gq,
    browserModelId: s.browserModelId || DEFAULTS.browserModelId,
    preferWebGPU: s.preferWebGPU !== false,
    stashReview: s.stashReview !== false,
    localModel: { ...DEFAULTS.localModel, ...(s.localModel || {}) },
    remoteModel,
  };
}

export async function setSettings(patch) {
  const cur = await getSettings();
  const remotePatch = patch.remoteModel || {};
  const nextRemote = { ...cur.remoteModel, ...remotePatch };
  if (remotePatch.baseUrl != null) {
    nextRemote.baseUrl = normalizeOpenAIBaseUrl(remotePatch.baseUrl);
  }
  let groupQuality = patch.groupQuality ?? cur.groupQuality;
  if (groupQuality !== 'enhanced') groupQuality = 'fast';
  const next = {
    classifyMode: patch.classifyMode ?? cur.classifyMode,
    groupQuality,
    browserModelId: patch.browserModelId ?? cur.browserModelId,
    preferWebGPU: patch.preferWebGPU ?? cur.preferWebGPU,
    stashReview: patch.stashReview ?? cur.stashReview,
    localModel: { ...cur.localModel, ...(patch.localModel || {}) },
    remoteModel: nextRemote,
  };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

/** 从设置拼出 suggestGroupsSmart / proposeEnhancement / previewLiveOrganizeSmart 的模型参数 */
export function classifyOptsFromSettings(s) {
  return {
    classifyMode: s.classifyMode,
    groupQuality: s.groupQuality === 'enhanced' ? 'enhanced' : 'fast',
    browserModelId: s.browserModelId,
    preferWebGPU: s.preferWebGPU,
    baseUrl: s.localModel?.baseUrl,
    model: s.localModel?.model,
    apiKey: s.remoteModel?.apiKey,
    remoteBaseUrl: s.remoteModel?.baseUrl,
    remoteModel: s.remoteModel?.model,
  };
}

/**
 * 为 OpenAI 兼容 Base URL 申请可选主机权限。
 * @returns {Promise<boolean>} 已有或用户授予则为 true
 */
export async function ensureRemoteHostPermission(baseUrl) {
  const root = normalizeOpenAIBaseUrl(baseUrl);
  let origin;
  try {
    origin = new URL(root).origin;
  } catch {
    return false;
  }
  const origins = [`${origin}/*`];
  try {
    if (await chrome.permissions.contains({ origins })) return true;
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}
