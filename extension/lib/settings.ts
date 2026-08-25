import { DEFAULT_BROWSER_MODEL, GEMMA_BROWSER_MODEL } from './browserModels.js'
import { isRecord } from './unknown.js'

const KEY = 'tabManagerSettings'

export type TabManagerSettings = {
  classifyMode: 'browser'
  browserModelId: string
  preferWebGPU: boolean
  stashReview: boolean
}

const DEFAULTS: Omit<TabManagerSettings, 'classifyMode'> = {
  browserModelId: DEFAULT_BROWSER_MODEL,
  preferWebGPU: true,
  stashReview: true, // 收纳后弹确认（分组+命名）；false = 静默自动整理
}

/**
 * 分类引擎固定为浏览器内小模型；历史上的 gemini/ollama/openai/site 一律归一到 browser。
 * 存储里残留的 localModel / remoteModel / groupQuality 字段直接忽略，下次保存时被清掉。
 */
export function normalizeClassifyMode(_mode?: string): 'browser' {
  return 'browser'
}

export async function getSettings(): Promise<TabManagerSettings> {
  const r = await chrome.storage.local.get(KEY)
  const s = isRecord(r[KEY]) ? r[KEY] : {}
  let browserModelId = typeof s.browserModelId === 'string' && s.browserModelId
    ? s.browserModelId
    : DEFAULTS.browserModelId
  // 撤回「默认改 Gemma」：只改自动迁过去的，用户之后再选手动选 Gemma 不再覆盖
  if (s.vEmbedGemma && !s.vMiniLMRestore && browserModelId === GEMMA_BROWSER_MODEL) {
    browserModelId = DEFAULT_BROWSER_MODEL
    try {
      await chrome.storage.local.set({
        [KEY]: { ...s, classifyMode: 'browser', browserModelId, vMiniLMRestore: 1 },
      })
    } catch {
      /* ignore */
    }
  }
  return {
    classifyMode: 'browser',
    browserModelId,
    preferWebGPU: s.preferWebGPU !== false,
    stashReview: s.stashReview !== false,
  }
}

export async function setSettings(patch: Partial<TabManagerSettings>): Promise<TabManagerSettings> {
  const cur = await getSettings()
  const next = {
    classifyMode: 'browser',
    browserModelId: patch.browserModelId ?? cur.browserModelId,
    preferWebGPU: patch.preferWebGPU ?? cur.preferWebGPU,
    stashReview: patch.stashReview ?? cur.stashReview,
    vMiniLMRestore: 1,
  } satisfies TabManagerSettings & { vMiniLMRestore: 1 }
  await chrome.storage.local.set({ [KEY]: next })
  return {
    classifyMode: next.classifyMode,
    browserModelId: next.browserModelId,
    preferWebGPU: next.preferWebGPU,
    stashReview: next.stashReview,
  }
}

/** 从设置拼出 suggestGroupsSmart / proposeEnhancement / previewLiveOrganizeSmart 的模型参数 */
export function classifyOptsFromSettings(s: TabManagerSettings) {
  return {
    classifyMode: 'browser',
    browserModelId: s.browserModelId,
    preferWebGPU: s.preferWebGPU,
  } satisfies Pick<TabManagerSettings, 'classifyMode' | 'browserModelId' | 'preferWebGPU'>
}
