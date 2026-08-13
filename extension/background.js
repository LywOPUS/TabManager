import { stashCurrentWindow, stashAllWindows } from './lib/stash.js';
import { organizeCurrentWindow, mergeAndOrganizeCurrent } from './lib/liveOrganize.js';
import { getSettings } from './lib/settings.js';

const MENU = {
  STASH_WINDOW: 'stash-window',
  STASH_ALL: 'stash-all',
  ORGANIZE_WINDOW: 'organize-window',
  MERGE_ORGANIZE: 'merge-organize',
};

const CTX = ['page', 'action'];
const COMMAND = {
  STASH: 'stash-other-tabs',
  MANAGE: 'open-management',
};

function managementUrl(hash = '') {
  return chrome.runtime.getURL(`management.html${hash}`);
}

async function openManagement(hash = '') {
  await chrome.tabs.create({ url: managementUrl(hash) });
}

let badgeTimer = 0;
async function flashStashBadge(r) {
  const ok = !!r?.ok;
  const text = ok ? String(r.count ?? 0).slice(0, 4) : '!';
  try {
    await chrome.action.setBadgeBackgroundColor({ color: ok ? '#1d1d1f' : '#c2332b' });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    }
    await chrome.action.setBadgeText({ text });
  } catch {
    /* 部分环境无 badge API */
  }
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
  }, 2200);
}

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU.STASH_WINDOW,
      title: '收纳当前窗口（保留当前页）',
      contexts: CTX,
    });
    chrome.contextMenus.create({
      id: MENU.STASH_ALL,
      title: '收纳全部窗口（保留当前页）',
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
      await flashStashBadge(await stashCurrentWindow({ keepActive: true }));
    } else if (info.menuItemId === MENU.STASH_ALL) {
      await flashStashBadge(await stashAllWindows({ keepActive: true }));
    } else if (info.menuItemId === MENU.ORGANIZE_WINDOW) {
      const r = await organizeCurrentWindow();
      await flashStashBadge({ ok: !!r?.ok, count: r?.apply?.created ?? 0 });
    } else if (info.menuItemId === MENU.MERGE_ORGANIZE) {
      await openManagement('#merge');
    }
  } catch (e) {
    console.error(e);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === COMMAND.STASH) {
      const r = await stashCurrentWindow({ keepActive: true });
      await flashStashBadge(r);
      if (r.ok) {
        const s = await getSettings();
        if (s.stashReview !== false) {
          await openManagement(`#review=${encodeURIComponent(r.session.id)}`);
        }
      }
      return;
    }
    if (command === COMMAND.MANAGE) {
      await openManagement();
    }
  } catch (e) {
    console.error(e);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'STASH_CURRENT_WINDOW': {
        const keepActive = msg.keepActive !== false;
        const r = await stashCurrentWindow({ keepActive });
        if (r.ok && msg.reviewInTab) {
          await openManagement(`#review=${encodeURIComponent(r.session.id)}`);
        }
        sendResponse(r);
        break;
      }
      case 'STASH_ALL_WINDOWS': {
        const keepActive = msg.keepActive !== false;
        sendResponse(await stashAllWindows({ keepActive }));
        break;
      }
      case 'ORGANIZE_CURRENT_WINDOW':
        sendResponse(await organizeCurrentWindow());
        break;
      case 'MERGE_ORGANIZE':
        sendResponse(await mergeAndOrganizeCurrent());
        break;
      case 'OPEN_MANAGEMENT':
        await openManagement(typeof msg.hash === 'string' ? msg.hash : '');
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: 'unknown' });
    }
  })();
  return true;
});
