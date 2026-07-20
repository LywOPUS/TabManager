const STORAGE_KEY = 'tabManagerData';
export const SCHEMA_VERSION = 1;

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

export async function addSession(session) {
  const data = await getData();
  data.sessions.unshift(session);
  await setData(data);
  return session;
}

export async function updateSession(sessionId, patch) {
  const data = await getData();
  const i = data.sessions.findIndex((s) => s.id === sessionId);
  if (i < 0) throw new Error('session not found');
  data.sessions[i] = { ...data.sessions[i], ...patch };
  await setData(data);
  return data.sessions[i];
}

export async function deleteSession(sessionId) {
  const data = await getData();
  data.sessions = data.sessions.filter((s) => s.id !== sessionId);
  await setData(data);
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

export function mergeImport(data, imported) {
  const incoming = imported.sessions || [];
  const existingIds = new Set(data.sessions.map((s) => s.id));
  for (const s of incoming) {
    if (!s.id || existingIds.has(s.id)) s.id = newId();
    existingIds.add(s.id);
    if (!s.groups) s.groups = [];
    for (const g of s.groups) {
      if (!g.id) g.id = newId();
      if (!g.tabs) g.tabs = [];
      for (const t of g.tabs) {
        if (!t.id) t.id = newId();
      }
    }
    data.sessions.push(s);
  }
  return data;
}
