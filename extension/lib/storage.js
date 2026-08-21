import { isRestorableUrl } from './urls.js';

const STORAGE_KEY = 'tabManagerData';
const DATA_LOCK_NAME = 'tab-manager-data-write';
export const SCHEMA_VERSION = 1;
export const MAX_IMPORT_SESSIONS = 10_000;
export const MAX_IMPORT_TABS = 100_000;
let localMutationTail = Promise.resolve();

export function newId() {
  return crypto.randomUUID();
}

export function defaultSessionName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `会话 — ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

export async function getData() {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  return r[STORAGE_KEY] || { schemaVersion: SCHEMA_VERSION, sessions: [] };
}

export async function setData(data) {
  data.schemaVersion = SCHEMA_VERSION;
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

/**
 * 在扩展同源页面间串行执行一次读—改—写；Web Locks 不可用时至少保证当前上下文串行。
 * mutator 的返回值会原样返回给调用方；抛错时不会写入。
 */
export async function mutateData(mutator) {
  const run = async () => {
    const data = await getData();
    const result = await mutator(data);
    await setData(data);
    return result;
  };
  const locks = globalThis.navigator?.locks;
  if (locks?.request) return locks.request(DATA_LOCK_NAME, run);

  const result = localMutationTail.then(run, run);
  localMutationTail = result.then(() => undefined, () => undefined);
  return result;
}

export async function addSession(session) {
  return mutateData((data) => {
    data.sessions.unshift(session);
    return session;
  });
}

export async function updateSession(sessionId, patch) {
  return mutateData((data) => {
    const i = data.sessions.findIndex((s) => s.id === sessionId);
    if (i < 0) throw new Error('session not found');
    data.sessions[i] = { ...data.sessions[i], ...patch };
    return data.sessions[i];
  });
}

export async function deleteSession(sessionId) {
  return mutateData((data) => {
    data.sessions = data.sessions.filter((s) => s.id !== sessionId);
  });
}

export async function getRecentSession() {
  const data = await getData();
  return data.sessions[0] || null;
}

export function buildExportPayload(data) {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    sessions: data.sessions,
  };
}

function importError(message) {
  throw new TypeError(`无效的导入文件：${message}`);
}

function requiredText(value, path) {
  if (typeof value !== 'string' || !value.trim()) importError(`${path} 必须是非空文本`);
  return value.trim();
}

/** 校验并复制导入数据；所有实体使用新 ID，避免与现有或同批数据冲突。 */
export function normalizeImport(imported) {
  if (!imported || typeof imported !== 'object' || Array.isArray(imported)) importError('根节点必须是对象');
  if (!Array.isArray(imported.sessions)) importError('sessions 必须是数组');
  if (imported.sessions.length > MAX_IMPORT_SESSIONS) importError(`会话不能超过 ${MAX_IMPORT_SESSIONS} 个`);

  let tabCount = 0;
  return imported.sessions.map((session, sessionIndex) => {
    const sessionPath = `sessions[${sessionIndex}]`;
    if (!session || typeof session !== 'object' || Array.isArray(session)) importError(`${sessionPath} 必须是对象`);
    if (!Array.isArray(session.groups)) importError(`${sessionPath}.groups 必须是数组`);
    if (!Number.isFinite(session.createdAt) || session.createdAt < 0) importError(`${sessionPath}.createdAt 无效`);

    const groups = session.groups.map((group, groupIndex) => {
      const groupPath = `${sessionPath}.groups[${groupIndex}]`;
      if (!group || typeof group !== 'object' || Array.isArray(group)) importError(`${groupPath} 必须是对象`);
      if (!Array.isArray(group.tabs)) importError(`${groupPath}.tabs 必须是数组`);

      const tabs = group.tabs.map((tab, tabIndex) => {
        const tabPath = `${groupPath}.tabs[${tabIndex}]`;
        tabCount += 1;
        if (tabCount > MAX_IMPORT_TABS) importError(`标签不能超过 ${MAX_IMPORT_TABS} 个`);
        if (!tab || typeof tab !== 'object' || Array.isArray(tab)) importError(`${tabPath} 必须是对象`);
        const url = requiredText(tab.url, `${tabPath}.url`);
        if (!isRestorableUrl(url)) importError(`${tabPath}.url 不是可恢复的网页地址`);
        const normalized = {
          id: newId(),
          title: requiredText(tab.title, `${tabPath}.title`),
          url,
        };
        if (typeof tab.favIconUrl === 'string' && tab.favIconUrl) normalized.favIconUrl = tab.favIconUrl;
        return normalized;
      });

      return {
        id: newId(),
        name: requiredText(group.name, `${groupPath}.name`),
        tabs,
      };
    });

    return {
      id: newId(),
      name: requiredText(session.name, `${sessionPath}.name`),
      createdAt: session.createdAt,
      groups,
    };
  });
}

export function mergeImport(data, imported) {
  if (!data || !Array.isArray(data.sessions)) throw new TypeError('当前存储数据无效');
  data.sessions.push(...normalizeImport(imported));
  return data;
}
