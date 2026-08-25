import {
  classifyWithBrowserEmbed,
  getBrowserModelWarmState,
  getLastEmbedDevice,
  preloadBrowserModel,
  unloadBrowserModel,
} from './lib/browserEmbedClassify.js'
import { isRecord } from './lib/unknown.js'

type OffscreenOp = 'classify' | 'preload' | 'unload' | 'warm' | 'device'

type OffscreenRequest = {
  op: OffscreenOp
  reqId: unknown
  items: unknown
  opts: unknown
  modelId: unknown
  preferWebGPU: unknown
}

function parseOffscreenOp(value: unknown): OffscreenOp | null {
  if (value === 'classify' || value === 'preload' || value === 'unload' || value === 'warm' || value === 'device') {
    return value
  }
  return null
}

function parseClassifyOpts(value: unknown) {
  if (!isRecord(value)) return {}
  return {
    modelId: typeof value.modelId === 'string' ? value.modelId : undefined,
    preferWebGPU: typeof value.preferWebGPU === 'boolean' ? value.preferWebGPU : undefined,
    allowDownload: typeof value.allowDownload === 'boolean' ? value.allowDownload : undefined,
  }
}

function parsePreloadOpts(value: unknown) {
  if (!isRecord(value)) return {}
  return {
    preferWebGPU: typeof value.preferWebGPU === 'boolean' ? value.preferWebGPU : undefined,
  }
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (!isRecord(msg) || msg.type !== 'tm-offscreen') return undefined
  const op = parseOffscreenOp(msg.op)
  const reqId = msg.reqId
  const onStatus = (text: string, detail?: unknown) => {
    chrome.runtime.sendMessage({
      type: 'tm-model-status',
      reqId,
      text,
      detail,
    }).catch(() => {});
  };
  (async () => {
    if (!op) return { error: `unknown op ${String(msg.op)}` }
    const req: OffscreenRequest = {
      op,
      reqId,
      items: msg.items,
      opts: msg.opts,
      modelId: msg.modelId,
      preferWebGPU: msg.preferWebGPU,
    }
    switch (req.op) {
      case 'classify':
        return {
          preview: await classifyWithBrowserEmbed(req.items, {
            ...parseClassifyOpts(req.opts),
            allowDownload: false,
            onStatus,
          }),
        }
      case 'preload':
        await preloadBrowserModel(
          typeof req.modelId === 'string' ? req.modelId : undefined,
          { ...parsePreloadOpts(req.opts), onStatus },
        )
        return { ok: true }
      case 'unload':
        unloadBrowserModel()
        return { ok: true }
      case 'warm':
        return getBrowserModelWarmState(
          typeof req.modelId === 'string' ? req.modelId : undefined,
          req.preferWebGPU !== false,
        )
      case 'device':
        return { device: getLastEmbedDevice() }
      default: {
        const _exhaustive: never = req.op
        return { error: `unknown op ${_exhaustive}` }
      }
    }
  })()
    .then(sendResponse)
    .catch((e: unknown) => sendResponse({ error: e instanceof Error ? e.message : String(e) }))
  return true
})
