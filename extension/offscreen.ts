import {
  classifyWithBrowserEmbed,
  getBrowserModelWarmState,
  getLastEmbedDevice,
  preloadBrowserModel,
  unloadBrowserModel,
} from './lib/browserEmbedClassify.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'tm-offscreen') return undefined;
  const onStatus = (text, detail) => {
    chrome.runtime.sendMessage({
      type: 'tm-model-status',
      reqId: msg.reqId,
      text,
      detail,
    }).catch(() => {});
  };
  (async () => {
    switch (msg.op) {
      case 'classify':
        return {
          preview: await classifyWithBrowserEmbed(msg.items || [], {
            ...(msg.opts || {}),
            allowDownload: false,
            onStatus,
          }),
        };
      case 'preload':
        await preloadBrowserModel(msg.modelId, { ...(msg.opts || {}), onStatus });
        return { ok: true };
      case 'unload':
        unloadBrowserModel();
        return { ok: true };
      case 'warm':
        return getBrowserModelWarmState(msg.modelId, msg.preferWebGPU);
      case 'device':
        return { device: getLastEmbedDevice() };
      default:
        return { error: `unknown op ${msg.op}` };
    }
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ error: String(e?.message || e) }));
  return true;
});
