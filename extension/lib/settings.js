import { DEFAULT_BROWSER_MODEL } from './browserModels.js';

const KEY = 'tabManagerSettings';

const DEFAULTS = {
  classifyMode: 'site', // site | browser | gemini | ollama
  browserModelId: DEFAULT_BROWSER_MODEL,
  preferWebGPU: true,
  stashReview: true, // 收纳后弹确认（分组+命名）；false = 静默自动整理
  localModel: {
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen2.5:0.5b',
  },
};

export async function getSettings() {
  const r = await chrome.storage.local.get(KEY);
  const s = r[KEY] || {};
  let classifyMode = s.classifyMode || DEFAULTS.classifyMode;
  if (!s.classifyMode && s.localModel?.enabled) classifyMode = 'ollama';
  return {
    classifyMode,
    browserModelId: s.browserModelId || DEFAULTS.browserModelId,
    preferWebGPU: s.preferWebGPU !== false,
    stashReview: s.stashReview !== false,
    localModel: { ...DEFAULTS.localModel, ...(s.localModel || {}) },
  };
}

export async function setSettings(patch) {
  const cur = await getSettings();
  const next = {
    classifyMode: patch.classifyMode ?? cur.classifyMode,
    browserModelId: patch.browserModelId ?? cur.browserModelId,
    preferWebGPU: patch.preferWebGPU ?? cur.preferWebGPU,
    stashReview: patch.stashReview ?? cur.stashReview,
    localModel: { ...cur.localModel, ...(patch.localModel || {}) },
  };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
