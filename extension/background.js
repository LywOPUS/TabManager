import { stashCurrentWindow, stashAllWindows } from './lib/stash.js';
import { organizeCurrentWindow, mergeAndOrganizeCurrent } from './lib/liveOrganize.js';

const MENU = {
  STASH_WINDOW: 'stash-window',
  STASH_ALL: 'stash-all',
  ORGANIZE_WINDOW: 'organize-window',
  MERGE_ORGANIZE: 'merge-organize',
};

const CTX = ['page', 'action'];

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU.STASH_WINDOW,
      title: '收纳当前窗口',
      contexts: CTX,
    });
    chrome.contextMenus.create({
      id: MENU.STASH_ALL,
      title: '收纳全部窗口',
      contexts: CTX,
    });
    chrome.contextMenus.create({
      id: MENU.ORGANIZE_WINDOW,
      title: '整理当前窗口',
      contexts: CTX,
    });
    chrome.contextMenus.create({
      id: MENU.MERGE_ORGANIZE,
      title: '整理全部窗口并合并到当前',
      contexts: CTX,
    });
  });
}

setupContextMenus();

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  try {
    if (info.menuItemId === MENU.STASH_WINDOW) {
      notifyStashResult(await stashCurrentWindow());
    } else if (info.menuItemId === MENU.STASH_ALL) {
      notifyStashResult(await stashAllWindows());
    } else if (info.menuItemId === MENU.ORGANIZE_WINDOW) {
      // 打开管理页预览，可在弹窗里选模型
      await chrome.tabs.create({
        url: chrome.runtime.getURL('management.html#organize'),
      });
    } else if (info.menuItemId === MENU.MERGE_ORGANIZE) {
      await chrome.tabs.create({
        url: chrome.runtime.getURL('management.html#merge'),
      });
    }
  } catch (e) {
    console.error(e);
  }
});

function notifyStashResult(r) {
  if (!r.ok && r.reason === 'empty') console.info('没有可收纳的标签');
}

function isRestrictedUrl(url = '') {
  return /^(chrome|edge|about|devtools|chrome-extension):/i.test(url)
    || url.startsWith('https://chrome.google.com/webstore')
    || url.startsWith('https://microsoftedge.microsoft.com/addons');
}

async function openFallbackPopup() {
  await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 320,
    height: 520,
  });
}

/** 页内圆角浮层；受限页 / 注入失败时回退独立小窗 */
async function togglePanel(tab) {
  if (!tab?.id) return;
  if (isRestrictedUrl(tab.url || '')) {
    await openFallbackPopup();
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['panel-host.js'],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof window.__tmTogglePanel === 'function') window.__tmTogglePanel();
        else throw new Error('tm panel missing');
      },
    });
  } catch (e) {
    console.error('[Tab Manager] panel inject failed', e);
    await openFallbackPopup();
  }
}

chrome.action.onClicked.addListener((tab) => {
  void togglePanel(tab);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'STASH_CURRENT_WINDOW':
        sendResponse(await stashCurrentWindow());
        break;
      case 'STASH_ALL_WINDOWS':
        sendResponse(await stashAllWindows());
        break;
      case 'ORGANIZE_CURRENT_WINDOW':
        sendResponse(await organizeCurrentWindow());
        break;
      case 'MERGE_ORGANIZE':
        sendResponse(await mergeAndOrganizeCurrent());
        break;
      case 'OPEN_MANAGEMENT':
        await chrome.tabs.create({ url: chrome.runtime.getURL('management.html') });
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: 'unknown' });
    }
  })();
  return true;
});
