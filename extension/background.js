// extension/lib/urls.ts
var SKIP_SCHEMES = /^(chrome|chrome-extension|edge|about|devtools|javascript|data|blob|view-source):/i;
function isStashableTab(tab) {
  if (!tab || tab.pinned) return false;
  const url = tab.pendingUrl || tab.url || "";
  if (!url || SKIP_SCHEMES.test(url)) return false;
  if (url.startsWith("chrome://") || url.startsWith("edge://")) return false;
  return true;
}
function isRestorableUrl(url) {
  if (!url || SKIP_SCHEMES.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// extension/lib/storage.ts
var STORAGE_KEY = "tabManagerData";
var DATA_LOCK_NAME = "tab-manager-data-write";
var SCHEMA_VERSION = 1;
var localMutationTail = Promise.resolve();
function newId() {
  return crypto.randomUUID();
}
function defaultSessionName(date = /* @__PURE__ */ new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `\u4F1A\u8BDD \u2014 ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}
async function getData() {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  return r[STORAGE_KEY] || { schemaVersion: SCHEMA_VERSION, sessions: [] };
}
async function setData(data) {
  data.schemaVersion = SCHEMA_VERSION;
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}
async function mutateData(mutator) {
  const run = async () => {
    const data = await getData();
    const result2 = await mutator(data);
    await setData(data);
    return result2;
  };
  const locks = globalThis.navigator?.locks;
  if (locks?.request) return locks.request(DATA_LOCK_NAME, run);
  const result = localMutationTail.then(run, run);
  localMutationTail = result.then(() => void 0, () => void 0);
  return result;
}
async function addSession(session) {
  return mutateData((data) => {
    data.sessions.unshift(session);
    return session;
  });
}

// extension/lib/groupNames.ts
var UNGROUPED_NAME = "\u672A\u5206\u7EC4";
var READ_LATER_NAME = "\u7A0D\u540E\u9605\u8BFB";

// extension/lib/stash.ts
function tabToStashed(tab) {
  return {
    id: newId(),
    title: tab.title || tab.url || "\u65E0\u6807\u9898",
    url: tab.url || tab.pendingUrl,
    favIconUrl: tab.favIconUrl || void 0
  };
}
function buildSessionFromTabs(tabs, name) {
  const stashed = tabs.map(tabToStashed);
  return {
    id: newId(),
    name: name || defaultSessionName(),
    createdAt: Date.now(),
    groups: [
      { id: newId(), name: READ_LATER_NAME, tabs: [] },
      { id: newId(), name: UNGROUPED_NAME, tabs: stashed }
    ]
  };
}
async function collectStashableTabs(query) {
  const tabs = await chrome.tabs.query(query);
  return tabs.filter(isStashableTab);
}
async function stashTabs(tabs, sessionName) {
  if (!tabs.length) return { ok: false, reason: "empty" };
  const seen = /* @__PURE__ */ new Set();
  const keep = [];
  let skipped = 0;
  let skippedUnrestorable = 0;
  for (const tab of tabs) {
    const url = tab.url || tab.pendingUrl;
    if (url && !isRestorableUrl(url)) {
      skippedUnrestorable += 1;
      continue;
    }
    if (url && seen.has(url)) {
      skipped += 1;
      continue;
    }
    if (url) seen.add(url);
    keep.push(tab);
  }
  if (!keep.length) {
    return { ok: false, reason: skippedUnrestorable && !skipped ? "all_unrestorable" : "all_dupe", skipped, skippedUnrestorable };
  }
  const session = buildSessionFromTabs(keep, sessionName);
  await addSession(session);
  await chrome.tabs.remove(keep.map((t) => t.id));
  return { ok: true, session, count: keep.length, skipped, skippedUnrestorable };
}
async function stashQuery(query, { keepActive = true } = {}) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabs = await collectStashableTabs(query);
  if (keepActive && active?.id != null) {
    const selected = tabs.filter((t) => t.id !== active.id);
    if (!selected.length) {
      return { ok: false, reason: tabs.length ? "only_active" : "empty" };
    }
    const r = await stashTabs(selected);
    if (r.ok) r.keptActive = true;
    return r;
  }
  return stashTabs(tabs);
}
async function stashCurrentWindow(opts) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return stashQuery({ windowId: active?.windowId }, opts);
}
async function stashAllWindows(opts) {
  return stashQuery({}, opts);
}

// extension/lib/groupHeuristics.ts
var MULTI_SUFFIX = /* @__PURE__ */ new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "ne.jp",
  "or.jp",
  "com.br",
  "com.mx",
  "com.tw",
  "com.hk",
  "github.io",
  "gitlab.io",
  "herokuapp.com",
  "vercel.app",
  "netlify.app"
]);
function registrableDomain(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    let h = u.hostname.replace(/\.$/, "").toLowerCase();
    if (!h) return null;
    if (h.startsWith("www.")) h = h.slice(4);
    const parts = h.split(".");
    if (parts.length <= 1) return h;
    const last2 = parts.slice(-2).join(".");
    if (MULTI_SUFFIX.has(last2) && parts.length >= 3) {
      return parts.slice(-3).join(".");
    }
    for (const suf of MULTI_SUFFIX) {
      if (h === suf || h.endsWith("." + suf)) {
        const need = suf.split(".").length + 1;
        if (parts.length >= need) return parts.slice(-need).join(".");
      }
    }
    return parts.length >= 2 ? parts.slice(-2).join(".") : h;
  } catch {
    return null;
  }
}

// extension/lib/groupLabels.ts
var SITE_ALIASES = {
  "twitter.com": "x.com",
  "t.co": "x.com",
  "youtu.be": "youtube.com",
  "b23.tv": "bilibili.com"
};
var HOST_ALIASES = {
  "chat.openai.com": "chatgpt.com"
};
var SITE_LABELS = {
  "x.com": "X",
  "youtube.com": "YouTube",
  "github.com": "GitHub",
  "gitlab.com": "GitLab",
  "google.com": "Google",
  "notion.so": "Notion",
  "reddit.com": "Reddit",
  "bilibili.com": "\u54D4\u54E9\u54D4\u54E9",
  "zhihu.com": "\u77E5\u4E4E",
  "weibo.com": "\u5FAE\u535A",
  "douyin.com": "\u6296\u97F3",
  "tiktok.com": "TikTok",
  "instagram.com": "Instagram",
  "facebook.com": "Facebook",
  "linkedin.com": "LinkedIn",
  "stackoverflow.com": "Stack Overflow",
  "wikipedia.org": "Wikipedia",
  "chatgpt.com": "ChatGPT",
  "claude.ai": "Claude",
  "huggingface.co": "Hugging Face",
  "arxiv.org": "arXiv",
  "medium.com": "Medium",
  "xiaohongshu.com": "\u5C0F\u7EA2\u4E66"
};
var TEMPLATE_SITES = /* @__PURE__ */ new Set([
  "x.com",
  "weibo.com",
  "instagram.com",
  "xiaohongshu.com",
  "tiktok.com",
  "douyin.com"
]);
var TEMPLATE_BRANDS = {
  "x.com": ["X", "Twitter"],
  "weibo.com": ["\u5FAE\u535A", "Weibo"],
  "instagram.com": ["Instagram"],
  "xiaohongshu.com": ["\u5C0F\u7EA2\u4E66", "Xiaohongshu", "RED"],
  "tiktok.com": ["TikTok"],
  "douyin.com": ["\u6296\u97F3", "Douyin"]
};
var PATH_GROUP_SITES = {
  "github.com": /* @__PURE__ */ new Set([
    "settings",
    "notifications",
    "pulls",
    "issues",
    "marketplace",
    "explore",
    "topics",
    "orgs",
    "users",
    "login",
    "signup",
    "new",
    "dashboard",
    "search",
    "copilot",
    "codespaces",
    "sponsors",
    "about",
    "features",
    "pricing",
    "security",
    "enterprise",
    "customer-stories",
    "readme",
    "discussions"
  ]),
  "gitlab.com": /* @__PURE__ */ new Set([
    "dashboard",
    "explore",
    "users",
    "help",
    "signin",
    "signup",
    "groups"
  ]),
  "x.com": /* @__PURE__ */ new Set([
    "i",
    "home",
    "explore",
    "search",
    "notifications",
    "messages",
    "settings",
    "compose",
    "intent",
    "hashtag",
    "share",
    "login",
    "signup",
    "following",
    "followers",
    "communities",
    "premium",
    "jobs",
    "grok",
    "articles",
    "lists",
    "bookmarks",
    "highlights",
    "tos",
    "privacy",
    "about",
    "help",
    "download",
    "flow",
    "account",
    "oauth",
    "embed",
    "topics",
    "happenings"
  ]),
  "instagram.com": /* @__PURE__ */ new Set([
    "p",
    "reel",
    "reels",
    "stories",
    "explore",
    "accounts",
    "direct",
    "about",
    "legal",
    "developer",
    "directory",
    "tv",
    "igtv",
    "live",
    "tags",
    "locations"
  ]),
  "tiktok.com": /* @__PURE__ */ new Set([
    "foryou",
    "following",
    "search",
    "live",
    "discover",
    "inbox",
    "friends",
    "video",
    "music",
    "tag",
    "place",
    "login",
    "signup",
    "about",
    "embed",
    "share",
    "upload",
    "messages",
    "t",
    "v",
    "explore"
  ])
};
var JUNK_EXACT = /* @__PURE__ */ new Set([
  "\u4E0A\u7684",
  "\u4E2D\u7684",
  "\u91CC\u7684",
  "\u4E0B\u7684",
  "\u540E\u7684",
  "\u524D\u7684",
  "\u65F6\u7684",
  "\u5230\u7684",
  "\u7684\u5E16",
  "\u5E16\u5B50",
  "\u7684\u63A8",
  "\u63A8\u6587",
  "\u4E3B\u9875",
  "\u7528\u6237",
  "\u5206\u4EAB",
  "\u67E5\u770B",
  "on",
  "of",
  "to",
  "in",
  "for",
  "and",
  "the",
  "a",
  "an",
  "with",
  "from",
  "by",
  "at",
  "as",
  "or",
  "is"
]);
var GENERIC_TOKENS = /* @__PURE__ */ new Set([
  ...JUNK_EXACT,
  "intro",
  "guide",
  "tutorial",
  "docs",
  "documentation",
  "official",
  "home",
  "blog",
  "learn",
  "getting",
  "started",
  "overview",
  "index",
  "page",
  "post",
  "posts",
  "article",
  "com",
  "org",
  "net",
  "http",
  "https",
  "www",
  "html",
  "watch",
  "status",
  "wiki",
  "search",
  "login",
  "signup",
  "about",
  "help",
  "faq",
  "new",
  "edit",
  "settings",
  "\u5165\u95E8",
  "\u6559\u7A0B",
  "\u6307\u5357",
  "\u5B98\u65B9",
  "\u6587\u6863",
  "\u9996\u9875",
  "\u767B\u5F55",
  "\u641C\u7D22",
  "\u4E00\u4E2A",
  "\u6211\u4EEC",
  "\u53EF\u4EE5",
  "\u8FD9\u4E2A",
  "\u90A3\u4E2A",
  "\u4EC0\u4E48",
  "\u600E\u4E48",
  "\u6CA1\u6709"
]);
var SITE_TOKEN_LOWER = /* @__PURE__ */ new Set([
  ...Object.values(SITE_LABELS).map((s) => s.toLowerCase()),
  ...Object.keys(SITE_LABELS),
  ...Object.keys(SITE_ALIASES),
  ...Object.values(SITE_ALIASES)
]);
function canonicalSite(domain) {
  const d = String(domain || "").toLowerCase();
  if (!d) return "";
  return SITE_ALIASES[d] || d;
}
function siteLabel(domain) {
  const key = canonicalSite(domain);
  if (!key) return "";
  return SITE_LABELS[key] || key;
}
function isTemplateSite(domain) {
  return TEMPLATE_SITES.has(canonicalSite(domain));
}
function siteOfTab(tab) {
  const url = tab?.url;
  try {
    const host = new URL(String(url || "")).hostname.replace(/^www\./, "").toLowerCase();
    if (HOST_ALIASES[host]) return canonicalSite(HOST_ALIASES[host]);
  } catch {
  }
  return canonicalSite(registrableDomain(url) || "");
}
function pathOwner(tab) {
  const site = siteOfTab(tab);
  const reserved = PATH_GROUP_SITES[site];
  if (!reserved) return "";
  try {
    const owner = decodeURIComponent(
      new URL(String(tab?.url || "")).pathname.split("/").filter(Boolean)[0] || ""
    ).replace(/^@/, "");
    if (!owner || reserved.has(owner.toLowerCase())) return "";
    if (!/^[A-Za-z0-9._-]+$/.test(owner)) return "";
    if (/^\d+$/.test(owner)) return "";
    return owner;
  } catch {
    return "";
  }
}
function normalizeHandle(s) {
  return String(s || "").trim().replace(/^@/, "").toLowerCase();
}
function parseCompoundSiteName(name) {
  const s = String(name || "").trim();
  const i = s.indexOf("|");
  if (i <= 0) return null;
  const label = s.slice(0, i).trim();
  const part = s.slice(i + 1).trim().replace(/^@/, "");
  if (!label || !part) return null;
  return { label, part };
}
function compoundSiteName(label, part) {
  const a = String(label || "").trim();
  const b = String(part || "").replace(/^@/, "").trim();
  if (!a) return b.slice(0, 24);
  if (!b || b.toLowerCase() === a.toLowerCase()) return a.slice(0, 24);
  return `${a}|${b}`.slice(0, 24);
}
function qualifierOfName(name) {
  const parsed = parseCompoundSiteName(name);
  return normalizeHandle(parsed ? parsed.part : name);
}
function majorityOwner(tabs, minShare = 0.67) {
  const freq = /* @__PURE__ */ new Map();
  for (const t of tabs || []) {
    const o = normalizeHandle(pathOwner(t));
    if (!o) continue;
    freq.set(o, (freq.get(o) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [o, n] of freq) {
    if (n > bestN) {
      best = o;
      bestN = n;
    }
  }
  const denom = (tabs || []).length;
  if (!best || !denom || bestN / denom < minShare) return "";
  return best;
}
function sharedContentToken(tabs) {
  const df = /* @__PURE__ */ new Map();
  for (const t of tabs || []) {
    for (const tok of tokenizeTitle(contentTitle(t))) {
      if (isSiteishToken(tok) || GENERIC_TOKENS.has(tok) || /^\d+$/.test(tok)) continue;
      df.set(tok, (df.get(tok) || 0) + 1);
    }
  }
  let best = "";
  let bestN = 0;
  for (const [tok, n] of df) {
    if (n < 2) continue;
    if (n > bestN || n === bestN && tok.length > best.length) {
      best = tok;
      bestN = n;
    }
  }
  return best ? displayToken(best) : "";
}
function inferTemplateQualifier(tabs) {
  return majorityOwner(tabs, 0.67) || sharedContentToken(tabs);
}
function nameTemplateGroup(site, tabs, fallbackName = "") {
  const label = siteLabel(site);
  const inferred = inferTemplateQualifier(tabs);
  if (inferred) return compoundSiteName(label, inferred);
  const parsed = parseCompoundSiteName(fallbackName);
  if (parsed && parsed.label.toLowerCase() === String(label).toLowerCase() && !isJunkGroupName(parsed.part)) {
    return compoundSiteName(label, parsed.part);
  }
  if (isAuthorGroupName(fallbackName, tabs)) {
    return compoundSiteName(label, qualifierOfName(fallbackName));
  }
  return label;
}
function isAuthorGroupName(name, tabs) {
  const want = qualifierOfName(name);
  if (!want || isJunkGroupName(want)) return false;
  const owners = new Set(
    (tabs || []).map((t) => normalizeHandle(pathOwner(t))).filter(Boolean)
  );
  return owners.size === 1 && owners.has(want);
}
function contentTitle(tab) {
  const site = siteOfTab(tab);
  let t = String(tab?.title || "").trim();
  if (!t || !isTemplateSite(site)) return t;
  const brands = TEMPLATE_BRANDS[site] || [siteLabel(site)];
  for (const brand of brands) {
    const q = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const onBody = t.match(new RegExp(`^.+?\\s+on\\s+${q}:\\s*(.+)$`, "i"));
    if (onBody) {
      t = onBody[1].trim().replace(/^["「『]|["」』]$/g, "").trim();
      break;
    }
    t = t.replace(new RegExp(`\\s*\u5728\\s*${q}\\s*\u4E0A\u7684(?:\u5E16\u5B50|\u7B14\u8BB0|\u89C6\u9891|\u4F5C\u54C1|\u52A8\u6001)?\\s*$`, "i"), "").replace(new RegExp(`\\s*\u5728\\s*${q}\\s*\u4E0A\\s*$`, "i"), "").replace(new RegExp(`\\s+on\\s+${q}\\s*$`, "i"), "").replace(new RegExp(`\\s*[\\/\xB7|\\-]\\s*${q}\\s*$`, "i"), "").trim();
  }
  const owner = pathOwner(tab);
  if (owner && t.toLowerCase() === owner.toLowerCase()) return "";
  return t;
}
function isJunkGroupName(name) {
  const s = String(name || "").trim();
  if (!s) return true;
  if ([...Object.values(SITE_LABELS)].includes(s)) return false;
  if (s.length < 2) return true;
  if (JUNK_EXACT.has(s) || JUNK_EXACT.has(s.toLowerCase())) return true;
  if (GENERIC_TOKENS.has(s) || GENERIC_TOKENS.has(s.toLowerCase())) return true;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^[一-鿿]的$/.test(s) || /^的[一-鿿]$/.test(s)) return true;
  return false;
}
function majoritySite(tabs, minShare = 0.67) {
  const freq = /* @__PURE__ */ new Map();
  for (const t of tabs || []) {
    const s = siteOfTab(t);
    if (!s) continue;
    freq.set(s, (freq.get(s) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [s, c] of freq) {
    if (c > bestN) {
      best = s;
      bestN = c;
    }
  }
  const denom = (tabs || []).length;
  if (!best || !denom || bestN / denom < minShare) return "";
  return best;
}
function finalizeGroupName(name, tabs) {
  const site = majoritySite(tabs);
  const label = site ? siteLabel(site) : "";
  const raw = String(name || "").trim();
  if (site && isTemplateSite(site)) return nameTemplateGroup(site, tabs, raw);
  if (isJunkGroupName(raw)) return label || "\u5206\u7EC4";
  if (site && (canonicalSite(raw) === site || raw === site)) return label;
  return raw.slice(0, 24);
}
function tokenizeTitle(text) {
  const tokens = [];
  const s = String(text || "");
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9+#._-]{1,24}/g)) {
    tokens.push(m[0].toLowerCase());
  }
  for (const m of s.matchAll(/[一-鿿]{2,8}/g)) {
    const run = m[0];
    for (let len = 2; len <= run.length; len += 1) {
      for (let i = 0; i + len <= run.length; i += 1) {
        tokens.push(run.slice(i, i + len));
      }
    }
  }
  return [...new Set(tokens)].filter(
    (t) => t.length >= 2 && !GENERIC_TOKENS.has(t) && !GENERIC_TOKENS.has(t.toLowerCase()) && !isJunkGroupName(t)
  );
}
function isSiteishToken(tok) {
  return SITE_TOKEN_LOWER.has(String(tok || "").toLowerCase());
}
function displayToken(tok) {
  const s = String(tok || "");
  if (/^[a-z]/.test(s)) return s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

// extension/lib/browserModels.ts
var MINILM_CLUSTER = { floor: 0.38, q: 0.55, cap: 0.62, prefixMinBody: 0 };
var GEMMA_CLUSTER = { floor: 0.52, q: 0.58, cap: 0.74, prefixMinBody: 24 };
var BROWSER_MODELS = [
  {
    id: "Xenova/all-MiniLM-L6-v2",
    label: "\u5185\u7F6E \xB7 MiniLM-L6",
    note: "\u7EA6 23MB\uFF0C\u968F\u6269\u5C55\u5185\u7F6E\u3001\u5F00\u7BB1\u5373\u7528\u3002\u6743\u91CD\u5728\u6269\u5C55\u5305\uFF0C\u4E0D\u8D70\u6A21\u578B\u5E93\u4E0B\u8F7D",
    bundled: true,
    cluster: MINILM_CLUSTER
  },
  {
    id: "onnx-community/embeddinggemma-300m-ONNX",
    label: "EmbeddingGemma\uFF08\u9700\u4E0B\u8F7D ~330MB\uFF09",
    note: "Google \u7AEF\u4FA7\u591A\u8BED\u8A00\u6A21\u578B\uFF1B\u4E2D\u6587\u66F4\u597D\uFF0C\u82F1\u6587\u77ED\u6807\u9898\u672A\u5FC5\u5F3A\u8FC7 MiniLM\u3002\u53EA\u5728\u7BA1\u7406\u9875\u300C\u6A21\u578B\u300D\u4E0B\u8F7D",
    textPrefix: "task: clustering | query: ",
    cluster: GEMMA_CLUSTER
  },
  {
    id: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    label: "\u591A\u8BED\u8A00 MiniLM\uFF08\u9700\u4E0B\u8F7D ~118MB\uFF09",
    note: "\u4E2D\u82F1\u90FD\u884C\uFF1B\u6BD4 EmbeddingGemma \u8F7B\uFF0C\u4E3B\u9898\u533A\u5206\u5F31\u4E00\u4E9B",
    cluster: MINILM_CLUSTER
  },
  {
    id: "Xenova/multilingual-e5-small",
    label: "E5-small\uFF08\u9700\u4E0B\u8F7D ~118MB\uFF09",
    note: "\u591A\u8BED\u8A00\u68C0\u7D22\u5411\uFF1B\u9996\u6B21\u4E0B\u8F7D\u8F83\u5927",
    textPrefix: "passage: ",
    cluster: { floor: 0.42, q: 0.55, cap: 0.68, prefixMinBody: 0 }
  }
];
var DEFAULT_BROWSER_MODEL = "Xenova/all-MiniLM-L6-v2";
var GEMMA_BROWSER_MODEL = "onnx-community/embeddinggemma-300m-ONNX";
function getBrowserModelMeta(id) {
  return BROWSER_MODELS.find((m) => m.id === id) || BROWSER_MODELS[0];
}
function getClusterParams(idOrMeta) {
  const meta = typeof idOrMeta === "string" ? getBrowserModelMeta(idOrMeta) : idOrMeta || {};
  const c = meta.cluster || MINILM_CLUSTER;
  return {
    floor: c.floor ?? MINILM_CLUSTER.floor,
    q: c.q ?? MINILM_CLUSTER.q,
    cap: c.cap ?? MINILM_CLUSTER.cap,
    prefixMinBody: c.prefixMinBody ?? 0
  };
}

// extension/lib/tabUsage.ts
var DEFAULT_IDLE_MS = 30 * 60 * 1e3;
function formatBytes(n) {
  if (n == null || !Number.isFinite(n) || n < 0) return "\u2014";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// extension/lib/browserModelCache.ts
var TRANSFORMERS_CACHE = "transformers-cache";
var MODEL_NOT_DOWNLOADED = "\u6A21\u578B\u672A\u4E0B\u8F7D\u3002\u8BF7\u5230\u6807\u7B7E\u7BA1\u7406\u9875\u300C\u6A21\u578B\u300D\u4E0B\u8F7D\u540E\u518D\u6574\u7406\u3002";
var MIN_READY_ONNX = 8 * 1024 * 1024;
var MIN_READY_ONNX_DATA = 200 * 1024 * 1024;
var STUB_ONNX = 1024 * 1024;
function cacheUrlMatchesModel(url, modelId) {
  const u = String(url || "");
  const id = String(modelId || "");
  if (!u || !id) return false;
  if (u.includes(id)) return true;
  if (u.includes(encodeURIComponent(id))) return true;
  const parts = id.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const org = parts[0];
    const name = parts.slice(1).join("/");
    return u.includes(`/${org}/`) && u.includes(`/${name}/`);
  }
  return false;
}
function dtypeFromCacheUrl(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes("fp16")) return "fp16";
  if (u.includes("q4f16") || u.includes("q4")) return "q4";
  if (u.includes("quantized") || u.includes("int8") || u.includes("uint8") || u.includes("q8")) {
    return "q8";
  }
  if (/\.onnx(_data)?(\?|$)/.test(u)) return "onnx";
  return "";
}
function isOnnxGraphUrl(url) {
  return /\.onnx(\?|$)/i.test(String(url || ""));
}
function isOnnxDataUrl(url) {
  return /\.onnx_data(\?|$)/i.test(String(url || ""));
}
function onnxStem(url) {
  return fileNameOf(url).toLowerCase().replace(/\.onnx_data$/i, "").replace(/\.onnx$/i, "");
}
function isOnnxGraphName(url) {
  return /^model(_quantized|_q8|_uint8|_int8)?$/.test(onnxStem(url));
}
function hasUsableOnnx(entries) {
  const list = entries || [];
  const graphs = list.filter((e) => isOnnxGraphUrl(e.url) && dtypeFromCacheUrl(e.url) !== "fp16");
  const datas = list.filter((e) => isOnnxDataUrl(e.url) && dtypeFromCacheUrl(e.url) !== "fp16");
  if (graphs.some((g) => (g.bytes || 0) >= MIN_READY_ONNX)) return true;
  const dataByStem = new Map(datas.map((d) => [onnxStem(d.url), d]));
  return graphs.some((g) => {
    const d = dataByStem.get(onnxStem(g.url));
    return !!(d && (d.bytes || 0) >= MIN_READY_ONNX_DATA);
  });
}
function missingOnnxGraph(entries) {
  const list = entries || [];
  const graphStems = new Set(
    list.filter((e) => isOnnxGraphUrl(e.url)).map((e) => onnxStem(e.url))
  );
  return list.filter((e) => isOnnxDataUrl(e.url) && dtypeFromCacheUrl(e.url) !== "fp16" && (e.bytes || 0) >= MIN_READY_ONNX_DATA && !graphStems.has(onnxStem(e.url)));
}
function accumulateDownloadProgress(files, event) {
  const name = String(event?.file || event?.name || "file");
  const prev = files.get(name) || { loaded: 0, total: 0, done: false };
  const status = event?.status;
  let total = Number(event?.total);
  if (!Number.isFinite(total) || total <= 0) total = prev.total;
  let loaded = Number(event?.loaded);
  const rawPct = Number(event?.progress);
  if (!Number.isFinite(loaded) || loaded < 0) {
    if (Number.isFinite(rawPct) && total > 0) {
      const p = rawPct > 1 ? rawPct / 100 : rawPct;
      loaded = p * total;
    } else {
      loaded = prev.loaded;
    }
  }
  if (status === "done") {
    files.set(name, { loaded: total || loaded, total: total || loaded, done: true });
  } else {
    files.set(name, {
      loaded,
      total: total || prev.total,
      done: false
    });
  }
  return summarizeDownload(files, name);
}
function summarizeDownload(files, currentFile = "") {
  let loaded = 0;
  let total = 0;
  let done = 0;
  for (const f of files.values()) {
    loaded += f.loaded || 0;
    if (f.total > 0) total += f.total;
    if (f.done) done += 1;
  }
  const count = files.size;
  const bytesFull = total > 0 && loaded >= total * 0.995;
  const complete = count > 0 && (done === count || bytesFull && done >= count - 1);
  let pct = 0;
  if (complete) pct = 100;
  else if (total > 0) pct = Math.min(99, Math.round(loaded / total * 100));
  else if (count) pct = Math.min(99, Math.round(done / count * 100));
  const file = String(currentFile).split("/").pop() || "";
  return { loaded, total, done, count, pct, file, complete };
}
function formatDownloadStatus(sum) {
  const size = sum.total > 0 ? `${formatBytes(sum.loaded)} / ${formatBytes(sum.total)}` : formatBytes(sum.loaded);
  const files = sum.count ? `${sum.done}/${sum.count} \u4E2A\u6587\u4EF6` : "\u51C6\u5907\u6587\u4EF6";
  if (sum.complete) {
    return `\u6587\u4EF6\u5DF2\u9F50\uFF0C\u6B63\u5728\u52A0\u8F7D\u6A21\u578B \xB7 ${size}`;
  }
  const which = sum.file ? ` \xB7 ${sum.file}` : "";
  return `\u4E0B\u8F7D\u4E2D ${sum.pct}% \xB7 ${size} \xB7 ${files}${which}`;
}
function formatLoadStatus(_sum) {
  return "\u6B63\u5728\u52A0\u8F7D\u6A21\u578B";
}
function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return String(input?.url || "");
}
function isLocalExtensionUrl(url) {
  return /^(chrome-extension:|moz-extension:|blob:|data:)/i.test(url);
}
function installCacheOnlyFetch() {
  const orig = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;
  if (!orig) return () => {
  };
  const wrapped = async (input, init) => {
    const url = requestUrl(input);
    if (!url || isLocalExtensionUrl(url)) return orig(input, init);
    try {
      const cache = await openTransformersCache();
      if (cache) {
        const hit = await cache.match(url) || (input && typeof input !== "string" ? await cache.match(input) : null);
        if (hit) return hit;
      }
    } catch {
    }
    throw new Error(MODEL_NOT_DOWNLOADED);
  };
  globalThis.fetch = wrapped;
  return () => {
    if (globalThis.fetch === wrapped) globalThis.fetch = orig;
  };
}
function fileNameOf(url) {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split("/").pop() || url);
  } catch {
    return String(url || "").split("/").pop() || "";
  }
}
function isLeftoverEntry(entry, models = BROWSER_MODELS) {
  const url = entry?.url || "";
  const bytes = Number(entry?.bytes) || 0;
  const known = models.some((m) => cacheUrlMatchesModel(url, m.id));
  if (!known) return true;
  if (dtypeFromCacheUrl(url) === "fp16") return true;
  if (isOnnxDataUrl(url)) return false;
  if (isOnnxGraphUrl(url) && isOnnxGraphName(url)) return false;
  if (isOnnxGraphUrl(url) && bytes > 0 && bytes < STUB_ONNX) return true;
  return false;
}
function summarizeModelEntries(entries, meta) {
  const mine = entries.filter((e) => cacheUrlMatchesModel(e.url, meta.id));
  const bytes = mine.reduce((s, e) => s + (e.bytes || 0), 0);
  const dtypes = [...new Set(mine.map((e) => dtypeFromCacheUrl(e.url)).filter(Boolean))];
  const leftoverMine = mine.filter((e) => isLeftoverEntry(e, [meta]));
  const leftoverBytes = leftoverMine.reduce((s, e) => s + (e.bytes || 0), 0);
  const usable = hasUsableOnnx(mine);
  const missingGraph = missingOnnxGraph(mine).length > 0;
  let state = "empty";
  if (meta.bundled) state = "bundled";
  else if (usable) state = "ready";
  else if (leftoverBytes > 0 && leftoverBytes >= bytes * 0.5) state = "leftover";
  else if (mine.length) state = "partial";
  let hint = "";
  if (state === "bundled") hint = "\u5185\u7F6E \xB7 \u4E0D\u5360\u4E0B\u8F7D\u7F13\u5B58";
  else if (state === "ready" && leftoverBytes > 0) {
    hint = `\u5DF2\u4E0B\u8F7D ${formatBytes(bytes)} \xB7 \u5176\u4E2D\u6B8B\u7559 ${formatBytes(leftoverBytes)}`;
  } else if (state === "ready") hint = `\u5DF2\u4E0B\u8F7D ${formatBytes(bytes)}`;
  else if (state === "leftover") {
    hint = dtypes.includes("fp16") ? `\u6B8B\u7559 ${formatBytes(bytes)} \xB7 \u65E7 WebGPU fp16\uFF0C\u6CA1\u6709\u91CF\u5316\u7248` : `\u6B8B\u7559 ${formatBytes(bytes)}`;
  } else if (missingGraph) {
    hint = `\u6743\u91CD\u5DF2\u5728\uFF08${formatBytes(bytes)}\uFF09\uFF0C\u8FD8\u5DEE\u7EA6 0.6MB \u56FE\u6587\u4EF6\uFF0C\u70B9\u7EED\u4E0B`;
  } else if (state === "partial") hint = `\u4E0B\u4E86\u4E00\u90E8\u5206 ${formatBytes(bytes)} \xB7 \u91CF\u5316\u6743\u91CD\u4E0D\u5B8C\u6574`;
  else hint = "\u672A\u4E0B\u8F7D";
  return {
    id: meta.id,
    label: meta.label,
    note: meta.note || "",
    bundled: !!meta.bundled,
    state,
    bytes,
    fileCount: mine.length,
    dtypes,
    leftoverBytes,
    missingGraph,
    hint,
    files: mine.map((e) => ({
      url: e.url,
      name: fileNameOf(e.url),
      bytes: e.bytes || 0,
      dtype: dtypeFromCacheUrl(e.url),
      leftover: isLeftoverEntry(e, [meta])
    }))
  };
}
function isModelInventoryReady(row) {
  return row?.state === "bundled" || row?.state === "ready";
}
async function openTransformersCache() {
  if (typeof caches === "undefined") return null;
  try {
    const names = await caches.keys();
    const hit = names.find((n) => n === TRANSFORMERS_CACHE) || names.find((n) => /transformer/i.test(n));
    if (!hit) return null;
    return caches.open(hit);
  } catch {
    return null;
  }
}
async function listCachedDtypes(modelId) {
  const cache = await openTransformersCache();
  if (!cache) return [];
  const reqs = await cache.keys();
  const dtypes = [];
  for (const req of reqs) {
    if (!cacheUrlMatchesModel(req.url, modelId)) continue;
    const d = dtypeFromCacheUrl(req.url);
    if (d) dtypes.push(d);
  }
  return [...new Set(dtypes)];
}
async function readCacheEntries() {
  const cache = await openTransformersCache();
  if (!cache) return [];
  const reqs = await cache.keys();
  const out = [];
  for (const req of reqs) {
    let bytes = 0;
    try {
      const res = await cache.match(req);
      const header = Number(res?.headers.get("content-length"));
      if (Number.isFinite(header) && header > 0) bytes = header;
      else if (res) bytes = (await res.blob()).size;
    } catch {
      bytes = 0;
    }
    out.push({ url: req.url, bytes });
  }
  return out;
}
async function isBrowserModelCacheReady(modelId) {
  const meta = getBrowserModelMeta(modelId);
  if (meta.bundled) return true;
  const row = summarizeModelEntries(await readCacheEntries(), meta);
  return isModelInventoryReady(row);
}
async function cachedModelHost(modelId) {
  const id = getBrowserModelMeta(modelId).id;
  const mine = (await readCacheEntries()).filter((e) => cacheUrlMatchesModel(e.url, id));
  if (mine.some((e) => e.url.includes("hf-mirror.com"))) return "https://hf-mirror.com";
  if (mine.some((e) => e.url.includes("huggingface.co"))) return "https://huggingface.co";
  return "";
}

// extension/lib/browserModelHost.ts
var MODEL_HOSTS = [
  "https://huggingface.co",
  "https://hf-mirror.com"
];
var MODEL_HOST_PERMISSIONS = [
  "https://huggingface.co/*",
  "https://*.huggingface.co/*",
  "https://hf-mirror.com/*",
  "https://*.hf.co/*",
  "https://*.xethub.hf.co/*"
];
async function ensureModelHostPermission() {
  if (typeof chrome === "undefined" || !chrome.permissions?.request) return true;
  try {
    if (await chrome.permissions.contains({ origins: MODEL_HOST_PERMISSIONS })) return true;
    return await chrome.permissions.request({ origins: MODEL_HOST_PERMISSIONS });
  } catch {
    return false;
  }
}
async function pickModelRemoteHost() {
  let lastErr = "";
  for (const host of MODEL_HOSTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8e3);
      const res = await fetch(`${host}/onnx-community/embeddinggemma-300m-ONNX/resolve/main/config.json`, {
        method: "GET",
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (res.ok) return host;
      lastErr = `${host} ${res.status}`;
    } catch (e) {
      lastErr = `${host} ${e?.name || e}`;
    }
  }
  throw new Error(`\u8FDE\u4E0D\u4E0A\u6A21\u578B\u6E90\uFF08${lastErr || "\u7F51\u7EDC\u5931\u8D25"}\uFF09\u3002\u53EF\u6539\u7528\u5185\u7F6E MiniLM\uFF0C\u6216\u5F00\u4EE3\u7406\u540E\u518D\u4E0B\u3002`);
}

// extension/lib/offscreenRuntime.ts
function inOffscreenPage() {
  try {
    return typeof location !== "undefined" && /offscreen\.html$/i.test(location.pathname);
  } catch {
    return false;
  }
}
function inServiceWorker() {
  return typeof document === "undefined";
}
async function ensureOffscreen() {
  if (inOffscreenPage()) return true;
  if (typeof chrome === "undefined" || !chrome.offscreen?.createDocument) return false;
  try {
    const ctxs = await chrome.runtime.getContexts?.({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (ctxs?.length) return true;
  } catch {
  }
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "\u52A0\u8F7D\u6D4F\u89C8\u5668\u5185\u5206\u7C7B\u6A21\u578B\u5E76\u63A8\u7406"
    });
    return true;
  } catch (e) {
    if (/already exists|only one/i.test(String(e?.message || e))) return true;
    console.warn("offscreen create failed", e);
    return false;
  }
}
function canUseOffscreen() {
  if (inOffscreenPage()) return false;
  return typeof chrome !== "undefined" && !!chrome.offscreen?.createDocument;
}
function shouldOffloadModel(meta) {
  if (!canUseOffscreen()) return false;
  if (inServiceWorker()) return true;
  return !!(meta && !meta.bundled);
}
async function offscreenRpc(op, payload = {}, onStatus) {
  const ok = await ensureOffscreen();
  if (!ok) throw new Error("\u65E0\u6CD5\u542F\u52A8\u6A21\u578B\u8FD0\u884C\u9875");
  const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const onMsg = (msg) => {
    if (msg?.type === "tm-model-status" && msg.reqId === reqId) {
      onStatus?.(msg.text, msg.detail);
    }
  };
  chrome.runtime.onMessage.addListener(onMsg);
  const body = { ...payload, op, reqId };
  try {
    const envelope = inServiceWorker() ? { type: "tm-offscreen", ...body } : { type: "tm-model", ...body };
    const res = await sendWithRetry(envelope);
    if (res?.error) throw new Error(res.error);
    return res;
  } finally {
    chrome.runtime.onMessage.removeListener(onMsg);
  }
}
async function sendWithRetry(envelope, tries = 8) {
  let last = new Error("\u6A21\u578B\u8FD0\u884C\u9875\u672A\u5C31\u7EEA");
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await chrome.runtime.sendMessage(envelope);
      if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
      if (res !== void 0) return res;
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
    }
    await new Promise((r) => setTimeout(r, 80 * (i + 1)));
  }
  throw last;
}

// extension/lib/browserEmbedClassify.ts
var extractorPromise = null;
var loadedKey = null;
var lastDevice = "wasm";
var WEBGPU_DEAD_KEY = "webgpuDeadUntil";
var WEBGPU_DEAD_TTL = 7 * 24 * 3600 * 1e3;
var webgpuDeadSession = /* @__PURE__ */ new Set();
async function isWebgpuDead(id) {
  if (webgpuDeadSession.has(id)) return true;
  try {
    const o = await chrome.storage.local.get(WEBGPU_DEAD_KEY);
    const until = o?.[WEBGPU_DEAD_KEY]?.[id] || 0;
    if (until > Date.now()) {
      webgpuDeadSession.add(id);
      return true;
    }
  } catch {
  }
  return false;
}
async function markWebgpuDead(id) {
  webgpuDeadSession.add(id);
  try {
    const o = await chrome.storage.local.get(WEBGPU_DEAD_KEY);
    const m = o?.[WEBGPU_DEAD_KEY] || {};
    m[id] = Date.now() + WEBGPU_DEAD_TTL;
    await chrome.storage.local.set({ [WEBGPU_DEAD_KEY]: m });
  } catch {
  }
}
function createProgressTracker(onStatus, { allowDownload = false } = {}) {
  const files = /* @__PURE__ */ new Map();
  return (p) => {
    if (!p || p.status !== "progress" && p.status !== "done" && p.status !== "download") return;
    if (!allowDownload) return;
    const sum = accumulateDownloadProgress(files, p);
    onStatus?.(sum.complete ? formatLoadStatus(sum) : formatDownloadStatus(sum), {
      phase: sum.complete ? "loading" : "download",
      pct: sum.pct,
      loaded: sum.loaded,
      total: sum.total,
      filesDone: sum.done,
      filesTotal: sum.count,
      file: sum.file
    });
  };
}
function configureTransformersEnv(env, {
  modelPath,
  wasmPaths,
  allowRemote = true,
  remoteHost
} = {}) {
  env.allowLocalModels = !!modelPath;
  if (modelPath) env.localModelPath = modelPath;
  env.allowRemoteModels = allowRemote;
  env.useBrowserCache = true;
  if (remoteHost) env.remoteHost = remoteHost;
  if (!wasmPaths) return;
  env.backends = env.backends || {};
  let onnxEnv = env.backends.onnx;
  try {
    if (onnxEnv?.wasm) onnxEnv.wasm.wasmPaths = wasmPaths;
  } catch {
  }
  Object.defineProperty(env.backends, "onnx", {
    configurable: true,
    enumerable: true,
    get: () => onnxEnv,
    set: (v) => {
      onnxEnv = v;
      try {
        if (onnxEnv?.wasm) onnxEnv.wasm.wasmPaths = wasmPaths;
      } catch {
      }
    }
  });
}
async function probeWebGPU() {
  try {
    if (!navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}
async function getExtractor(modelId, { onStatus, preferWebGPU = true, allowDownload = false } = {}) {
  const id = modelId || DEFAULT_BROWSER_MODEL;
  const key = `${id}|gpu:${preferWebGPU ? 1 : 0}`;
  if (extractorPromise && loadedKey === key) return extractorPromise;
  loadedKey = key;
  extractorPromise = (async () => {
    try {
      return await loadExtractor(id, { onStatus, preferWebGPU, allowDownload });
    } catch (e) {
      if (loadedKey === key) {
        extractorPromise = null;
        loadedKey = null;
      }
      throw e;
    }
  })();
  return extractorPromise;
}
async function loadExtractor(id, { onStatus, preferWebGPU, allowDownload = false } = {}) {
  if (inServiceWorker()) {
    throw new Error("Service Worker \u4E0D\u80FD\u52A0\u8F7D\u6A21\u578B");
  }
  const meta = getBrowserModelMeta(id);
  if (!meta.bundled && !allowDownload) {
    const ready = await isBrowserModelCacheReady(id);
    if (!ready) throw new Error(MODEL_NOT_DOWNLOADED);
  }
  const mod = await import(chrome.runtime.getURL("vendor/transformers/transformers.web.min.js"));
  const { pipeline, env } = mod;
  let remoteHost;
  if (!meta.bundled) {
    remoteHost = await cachedModelHost(id);
    if (allowDownload && !remoteHost) {
      const ok = await ensureModelHostPermission();
      if (!ok) throw new Error("\u672A\u6388\u4E88\u6A21\u578B\u4E0B\u8F7D\u6743\u9650\uFF08huggingface.co / hf-mirror.com\uFF09");
      onStatus?.("\u63A2\u6D4B\u6A21\u578B\u6E90\u2026", { phase: "checking" });
      remoteHost = await pickModelRemoteHost();
    }
    if (allowDownload) {
      onStatus?.(`\u4ECE ${(remoteHost || "huggingface.co").replace(/^https:\/\//, "")} \u62C9\u53D6\u2026`, { phase: "download" });
    }
  }
  configureTransformersEnv(env, {
    modelPath: meta.bundled ? chrome.runtime.getURL("vendor/models/") : void 0,
    wasmPaths: chrome.runtime.getURL("vendor/transformers/"),
    allowRemote: !meta.bundled,
    remoteHost
  });
  const onProgress = createProgressTracker(onStatus, { allowDownload });
  const restoreFetch = !meta.bundled && !allowDownload ? installCacheOnlyFetch() : () => {
  };
  try {
    if (!meta.bundled) {
      const dtypes = await listCachedDtypes(id);
      const wantGpu = preferWebGPU && !await isWebgpuDead(id) && await probeWebGPU();
      const ready = await isBrowserModelCacheReady(id);
      if (wantGpu && dtypes.includes("fp16") && ready) {
        try {
          onStatus?.(`\u52A0\u8F7D ${meta.label} \xB7 WebGPU\uFF08\u672C\u5730\u7F13\u5B58\uFF09\u2026`, { phase: "loading" });
          const pipe2 = await pipeline("feature-extraction", id, {
            device: "webgpu",
            dtype: "fp16",
            progress_callback: onProgress
          });
          lastDevice = "webgpu";
          return pipe2;
        } catch (e) {
          console.warn("WebGPU embed failed, fallback wasm", e);
          onStatus?.("WebGPU \u5931\u8D25\uFF0C\u6539\u7528\u91CF\u5316\u7248\u2026", { phase: "loading" });
          await markWebgpuDead(id);
        }
      }
    }
    const cached = meta.bundled ? true : await isBrowserModelCacheReady(id);
    if (!cached && !allowDownload) throw new Error(MODEL_NOT_DOWNLOADED);
    onStatus?.(
      meta.bundled ? `\u52A0\u8F7D ${meta.label}\uFF08\u5185\u7F6E\uFF09\u2026` : cached ? `\u52A0\u8F7D ${meta.label}\uFF08\u672C\u5730\u7F13\u5B58\uFF09\u2026` : `\u4E0B\u8F7D ${meta.label}\uFF08\u91CF\u5316\u7248\uFF0C\u7EA6\u4E00\u6B21\uFF09\u2026`,
      { phase: cached || meta.bundled ? "loading" : "download" }
    );
    const pipe = await pipeline("feature-extraction", id, {
      dtype: "q8",
      progress_callback: onProgress
    });
    lastDevice = "wasm";
    return pipe;
  } finally {
    restoreFetch();
  }
}
function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}
var PATH_SKIP = /* @__PURE__ */ new Set([
  "watch",
  "status",
  "p",
  "reel",
  "reels",
  "shorts",
  "video",
  "t",
  "i",
  "home",
  "explore",
  "search",
  "login",
  "signup",
  "share",
  "intent"
]);
function usefulPathWords(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const out = [];
    for (const raw of parts) {
      let s = raw;
      try {
        s = decodeURIComponent(raw);
      } catch {
      }
      const low = s.toLowerCase();
      if (PATH_SKIP.has(low)) continue;
      if (/^[A-Za-z0-9_-]{10,12}$/.test(s) && /[0-9]/.test(s) && /[A-Za-z]/.test(s)) continue;
      if (!/^[A-Za-z][\w-]{2,24}$/.test(s)) continue;
      out.push(s);
      if (out.length >= 3) break;
    }
    return out.join(" ");
  } catch {
    return "";
  }
}
function isUrlTitle(title) {
  const s = String(title || "").trim();
  return /^https?:\/\//i.test(s);
}
function titleForEmbed(item) {
  const t = String(item?.title || "").trim();
  if (!t || isUrlTitle(t)) return "";
  return t.slice(0, 120);
}
function embedText(item, prefix = "", prefixMinBody = 0) {
  const owner = pathOwner(item);
  const pathWords = usefulPathWords(item.url);
  const title = titleForEmbed(item);
  const body = `${title} ${owner} ${pathWords}`.trim() || "tab";
  if (!prefix || prefixMinBody > 0 && body.length < prefixMinBody) return body;
  return prefix + body;
}
var CJK_STOP = /* @__PURE__ */ new Set([
  "\u7684",
  "\u4E86",
  "\u5728",
  "\u662F",
  "\u548C",
  "\u4E0E",
  "\u53CA",
  "\u6216",
  "\u4E00\u4E2A",
  "\u4F7F\u7528",
  "\u600E\u4E48",
  "\u5982\u4F55",
  "\u4EC0\u4E48",
  "\u5B98\u7F51",
  "\u5B98\u65B9",
  "\u9996\u9875",
  "\u767B\u5F55",
  "\u6CE8\u518C",
  "\u9875\u9762",
  "\u6807\u7B7E",
  "\u6D4F\u89C8\u5668",
  "\u6700\u65B0",
  "\u5927\u5168",
  "\u6559\u7A0B"
]);
function tokenize(text) {
  const tokens = [];
  for (const m of String(text || "").matchAll(/[A-Za-z][A-Za-z0-9+#._-]{1,20}/g)) {
    tokens.push(m[0].toLowerCase());
  }
  for (const m of String(text || "").matchAll(/[一-鿿]{2,}/g)) {
    const run = m[0];
    for (let i = 0; i + 2 <= run.length; i += 1) tokens.push(run.slice(i, i + 2));
  }
  return tokens.filter((t) => !CJK_STOP.has(t) && !isJunkGroupName(t));
}
function docFreq(itemTokensList) {
  const df = /* @__PURE__ */ new Map();
  for (const set of itemTokensList) {
    for (const t of set) df.set(t, (df.get(t) || 0) + 1);
  }
  return df;
}
function stripTitleDecor(t) {
  let s = String(t || "").trim();
  s = s.replace(/^\(\d+\)\s*/, "");
  s = s.replace(/\s+[-|—–·:：/][^-|—–·:：/]{1,30}$/, "").trim();
  return s;
}
function cleanTitle(t) {
  return stripTitleDecor(t).slice(0, 24) || "\u5206\u7EC4";
}
var WEAK_NAME = /* @__PURE__ */ new Set([
  ...CJK_STOP,
  "was",
  "how",
  "best",
  "why",
  "what",
  "when",
  "your",
  "own",
  "made",
  "make",
  "hours",
  "hour",
  "video",
  "watch",
  "youtube",
  "this",
  "that",
  "with",
  "from",
  "into",
  "over",
  "only",
  "just",
  "more",
  "most",
  "first",
  "new",
  "game",
  "games",
  "play",
  "plays",
  "part",
  "full",
  "official",
  "trailer",
  "teaser",
  "mix",
  "ultimate",
  "introduction",
  "intro",
  "keep",
  "thinking",
  "http",
  "https",
  "www",
  "com",
  "org",
  "net",
  "html",
  "htm"
]);
function isWeakNameToken(tok) {
  const s = String(tok || "").trim();
  if (!s || isJunkGroupName(s) || WEAK_NAME.has(s.toLowerCase())) return true;
  if (/^[a-z]{1,3}$/i.test(s)) return true;
  if (/^https?:\/\//i.test(s)) return true;
  return false;
}
function isShellTab(item) {
  const title = String(item?.title || "").trim();
  const usable = title && !isUrlTitle(title);
  if (usable) {
    const core = cleanTitle(title).toLowerCase();
    if (!core || core === "\u5206\u7EC4") return true;
    if (["youtube", "x", "twitter", "\u4E3B\u9875", "home", "gmail", "google"].includes(core)) return true;
    if (/^(主页|home)\s*\/\s*x$/i.test(title)) return true;
    return false;
  }
  return !pathOwner(item) && !usefulPathWords(item.url);
}
function nameCluster(members, globalDf, totalItems, centralTitle) {
  const site = majoritySite(members);
  if (site && isTemplateSite(site)) {
    const named = nameTemplateGroup(site, members, "");
    if (named && named !== siteLabel(site) && !isJunkGroupName(named)) return named;
  }
  const local = /* @__PURE__ */ new Map();
  for (const m of members) {
    const toks = new Set(tokenize(stripTitleDecor(m.title)));
    for (const t of toks) local.set(t, (local.get(t) || 0) + 1);
  }
  let best = null;
  let bestScore = 0;
  for (const [tok, ln] of local) {
    if (ln < 2 || isWeakNameToken(tok)) continue;
    if (site && (tok === site || tok === canonicalSite(site))) continue;
    const gn = globalDf.get(tok) || 0;
    const outsideN = Math.max(0, totalItems - members.length);
    if (outsideN >= 4 && (gn - ln) / outsideN > 0.5) continue;
    const score = ln / Math.max(1, gn) * Math.log(1 + ln);
    if (score > bestScore) {
      bestScore = score;
      best = tok;
    }
  }
  if (best) {
    const named = /^[a-z]/.test(best) ? best.charAt(0).toUpperCase() + best.slice(1) : best;
    return named.slice(0, 20);
  }
  const central = cleanTitle(centralTitle || members[0]?.title);
  if (central && central !== "\u5206\u7EC4" && !isUrlTitle(central) && !isWeakNameToken(central)) {
    return central;
  }
  if (site && !isTemplateSite(site) && majoritySite(members, 0.8)) {
    return siteLabel(site) || site;
  }
  return "\u4E3B\u9898";
}
var EMBED_BATCH = 16;
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}
function buildSimMatrix(vecs) {
  const n = vecs.length;
  const m = new Float32Array(n * n);
  const norms = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let s = 0;
    for (let k = 0; k < vecs[i].length; k += 1) s += vecs[i][k] * vecs[i][k];
    norms[i] = Math.sqrt(s) || 1;
  }
  for (let i = 0; i < n; i += 1) {
    m[i * n + i] = 1;
    const vi = vecs[i];
    for (let j = i + 1; j < n; j += 1) {
      const vj = vecs[j];
      let dot = 0;
      for (let k = 0; k < vi.length; k += 1) dot += vi[k] * vj[k];
      const sim = dot / (norms[i] * norms[j]);
      m[i * n + j] = sim;
      m[j * n + i] = sim;
    }
  }
  return m;
}
function agglomerative(items, vectors, simMatrix, threshold) {
  const n = items.length;
  const clusters = items.map((it, i) => ({ members: [it], vecs: [vectors[i]] }));
  const sum = Float32Array.from(simMatrix);
  for (; ; ) {
    let best = threshold;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < n; i += 1) {
      if (!clusters[i]) continue;
      const si = clusters[i].members.length;
      for (let j = i + 1; j < n; j += 1) {
        if (!clusters[j]) continue;
        const avg = sum[i * n + j] / (si * clusters[j].members.length);
        if (avg > best) {
          best = avg;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) break;
    for (let k = 0; k < n; k += 1) {
      if (k === bi || k === bj || !clusters[k]) continue;
      sum[bi * n + k] += sum[bj * n + k];
      sum[k * n + bi] = sum[bi * n + k];
    }
    clusters[bi].members.push(...clusters[bj].members);
    clusters[bi].vecs.push(...clusters[bj].vecs);
    clusters[bj] = null;
  }
  return clusters.filter(Boolean);
}
function centralMember(cluster) {
  const dim = cluster.vecs[0].length;
  const centroid = new Float32Array(dim);
  for (const v of cluster.vecs) for (let k = 0; k < dim; k += 1) centroid[k] += v[k] / cluster.vecs.length;
  let central = cluster.members[0];
  let bestSim = -1;
  for (let i = 0; i < cluster.members.length; i += 1) {
    const sim = cosine(cluster.vecs[i], centroid);
    if (sim > bestSim) {
      bestSim = sim;
      central = cluster.members[i];
    }
  }
  return central;
}
function pushGroup(groups, usedNames, name, members) {
  let finalName = name;
  for (let i = 2; usedNames.has(finalName); i += 1) finalName = `${name} \xB7 ${i}`;
  usedNames.add(finalName);
  groups.push({
    key: finalName,
    name: finalName,
    tabIds: members.map((t) => t.id),
    tabs: members
  });
}
function clusterPreview(items, vectors, cluster = MINILM_CLUSTER) {
  const groups = [];
  const ungrouped = [];
  const usedNames = /* @__PURE__ */ new Set();
  if (!items.length) return { groups, ungrouped };
  const { floor, q, cap } = getClusterParams({ cluster });
  const globalDf = docFreq(items.map((t) => new Set(tokenize(stripTitleDecor(t.title)))));
  const simMatrix = buildSimMatrix(vectors);
  const sims = [];
  const n = items.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) sims.push(simMatrix[i * n + j]);
  }
  sims.sort((a, b) => a - b);
  const threshold = Math.max(floor, Math.min(cap, quantile(sims, q)));
  const clusters = agglomerative(items, vectors, simMatrix, threshold);
  for (const c of clusters) {
    if (c.members.length < 2) {
      ungrouped.push(...c.members);
      continue;
    }
    const name = nameCluster(c.members, globalDf, items.length, centralMember(c)?.title);
    pushGroup(groups, usedNames, name, c.members);
  }
  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.name.localeCompare(b.name, "zh"));
  return { groups, ungrouped };
}
async function classifyWithBrowserEmbed(items, { onStatus, modelId, preferWebGPU = true } = {}) {
  if (!items?.length) return { groups: [], ungrouped: [] };
  const meta = getBrowserModelMeta(modelId || DEFAULT_BROWSER_MODEL);
  if (shouldOffloadModel(meta)) {
    const r = await offscreenRpc("classify", {
      items,
      opts: { modelId: meta.id, preferWebGPU, allowDownload: false }
    }, onStatus);
    return r?.preview || { groups: [], ungrouped: items };
  }
  const shells = [];
  const work = [];
  for (const t of items) {
    if (isShellTab(t)) shells.push(t);
    else work.push(t);
  }
  if (work.length < 2) {
    return { groups: [], ungrouped: [...work, ...shells] };
  }
  const extractor = await getExtractor(meta.id, { onStatus, preferWebGPU, allowDownload: false });
  const cluster = getClusterParams(meta);
  const prefix = meta.textPrefix || "";
  const texts = work.map((t) => embedText(t, prefix, cluster.prefixMinBody));
  const vectors = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const end = Math.min(i + EMBED_BATCH, texts.length);
    onStatus?.(`\u7F16\u7801 ${i + 1}\u2013${end}/${texts.length}\uFF08${meta.label} \xB7 ${lastDevice}\uFF09\u2026`);
    const output = await extractor(texts.slice(i, end), { pooling: "mean", normalize: true });
    const list = output.tolist();
    for (const row of list) vectors.push(Float32Array.from(row));
  }
  onStatus?.("\u6309\u4E3B\u9898\u805A\u7C7B\u2026");
  const preview = clusterPreview(work, vectors, cluster);
  preview.ungrouped.push(...shells);
  return preview;
}

// extension/lib/localClassify.ts
function sealPreview(preview, items = []) {
  const used = /* @__PURE__ */ new Set();
  const byName = /* @__PURE__ */ new Map();
  for (const g of preview?.groups || []) {
    const rawName = String(g.name || "\u5206\u7EC4").trim().slice(0, 40) || "\u5206\u7EC4";
    const tabs = [];
    for (const t of g.tabs || []) {
      if (!t || used.has(t.id)) continue;
      used.add(t.id);
      tabs.push(t);
    }
    if (tabs.length < 2) {
      for (const t of tabs) used.delete(t.id);
      continue;
    }
    const name = isJunkGroupName(rawName) ? finalizeGroupName(rawName, tabs) : rawName;
    const key = name.toLowerCase();
    const cur = byName.get(key);
    if (cur) {
      cur.tabs.push(...tabs);
      cur.tabIds = cur.tabs.map((t) => t.id);
      if (name.length < cur.name.length) {
        cur.name = name;
        cur.key = name;
      }
    } else {
      byName.set(key, { key, name, tabs, tabIds: tabs.map((t) => t.id) });
    }
  }
  const groups = [...byName.values()].filter((g) => g.tabs.length >= 2);
  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.name.localeCompare(b.name, "zh"));
  const seen = /* @__PURE__ */ new Set();
  const ungrouped = [];
  for (const t of items.length ? items : preview?.ungrouped || []) {
    if (!t || used.has(t.id) || seen.has(t.id)) continue;
    seen.add(t.id);
    ungrouped.push(t);
  }
  return { groups, ungrouped };
}
async function suggestGroupsSmart(items, options = {}) {
  const { browserModelId, preferWebGPU = true, onStatus } = options;
  const finish = (preview, source, extra = {}) => ({
    preview: sealPreview(preview, items),
    source,
    ...extra
  });
  const fail = (error, source = "error") => {
    const msg = String(error || "\u5206\u7C7B\u5931\u8D25");
    onStatus?.(msg);
    return {
      preview: { groups: [], ungrouped: items || [] },
      source,
      error: msg
    };
  };
  if (!items.length) {
    return finish({ groups: [], ungrouped: [] }, "empty");
  }
  try {
    const preview = await classifyWithBrowserEmbed(items, {
      onStatus,
      modelId: browserModelId,
      preferWebGPU
    });
    if (!preview.groups.length) {
      return fail("\u6D4F\u89C8\u5668\u6A21\u578B\u6CA1\u6709\u7ED9\u51FA\u53EF\u6210\u7EC4\u7684\u4E3B\u9898");
    }
    return finish(preview, "browser-embed");
  } catch (e) {
    console.warn("browser embed failed", e);
    const raw = String(e?.message || e);
    return fail(raw.includes("\u6A21\u578B") ? raw : `\u6D4F\u89C8\u5668\u6A21\u578B\u4E0D\u53EF\u7528\uFF08${raw}\uFF09`);
  }
}

// extension/lib/settings.ts
var KEY = "tabManagerSettings";
var DEFAULTS = {
  browserModelId: DEFAULT_BROWSER_MODEL,
  preferWebGPU: true,
  stashReview: true
  // 收纳后弹确认（分组+命名）；false = 静默自动整理
};
async function getSettings() {
  const r = await chrome.storage.local.get(KEY);
  const s = r[KEY] || {};
  let browserModelId = s.browserModelId || DEFAULTS.browserModelId;
  if (s.vEmbedGemma && !s.vMiniLMRestore && browserModelId === GEMMA_BROWSER_MODEL) {
    browserModelId = DEFAULT_BROWSER_MODEL;
    try {
      await chrome.storage.local.set({
        [KEY]: { ...s, classifyMode: "browser", browserModelId, vMiniLMRestore: 1 }
      });
    } catch {
    }
  }
  return {
    classifyMode: "browser",
    browserModelId,
    preferWebGPU: s.preferWebGPU !== false,
    stashReview: s.stashReview !== false
  };
}
function classifyOptsFromSettings(s) {
  return {
    classifyMode: "browser",
    browserModelId: s.browserModelId,
    preferWebGPU: s.preferWebGPU
  };
}

// extension/lib/liveOrganizePlan.ts
var TAB_GROUP_NONE = -1;
function isNativeUngrouped(tab, none = TAB_GROUP_NONE) {
  if (!tab) return false;
  return tab.groupId === void 0 || tab.groupId === none;
}
function chromeTabId(tab) {
  if (typeof tab?.tabId === "number" && Number.isInteger(tab.tabId) && tab.tabId >= 0) return tab.tabId;
  const n = Number(tab?.id);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
function chromeTabIds(tabs) {
  const ids = [];
  const seen = /* @__PURE__ */ new Set();
  for (const t of tabs || []) {
    const id = chromeTabId(t);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
function decorateExistingGroups(windowTabs, existingMeta = [], none = TAB_GROUP_NONE) {
  const tabsByG = /* @__PURE__ */ new Map();
  for (const t of windowTabs || []) {
    if (!isStashableTab(t) || isNativeUngrouped(t, none)) continue;
    if (typeof t.groupId !== "number") continue;
    if (!tabsByG.has(t.groupId)) tabsByG.set(t.groupId, []);
    tabsByG.get(t.groupId).push(t);
  }
  const metaById = new Map((existingMeta || []).map((m) => [m.groupId, m]));
  const out = [];
  for (const [groupId, tabs] of tabsByG) {
    const meta = metaById.get(groupId) || {};
    out.push({
      groupId,
      title: String(meta.title || "").trim(),
      color: meta.color,
      tabs,
      site: majoritySite(tabs, 0.5)
    });
  }
  return out;
}
function largest(groups) {
  return [...groups].sort((a, b) => b.tabs.length - a.tabs.length || a.groupId - b.groupId)[0];
}
function normName(s) {
  return String(s || "").trim().toLowerCase();
}
function existingClusterKey(g) {
  const title = String(g.title || "").trim();
  if (title && !isJunkGroupName(title)) return `title:${title.toLowerCase()}`;
  return `id:${g.groupId}`;
}
function planHasWork(plan) {
  return !!(plan?.absorb?.length || plan?.create?.length || plan?.merge?.length);
}
function stashableTabs(tabs) {
  return (tabs || []).filter((t) => isStashableTab(t));
}
function tabGroupOf(tabs, none = TAB_GROUP_NONE) {
  const map = /* @__PURE__ */ new Map();
  for (const t of tabs || []) {
    const id = chromeTabId(t);
    if (id == null || typeof t.groupId !== "number" || t.groupId === none) continue;
    map.set(id, t.groupId);
  }
  return map;
}
function makeAbsorbInto(absorbMap, claimed, groupOf = /* @__PURE__ */ new Map()) {
  return (hit, tabIds, name) => {
    if (!hit || !tabIds?.length) return;
    if (!absorbMap.has(hit.groupId)) {
      absorbMap.set(hit.groupId, {
        groupId: hit.groupId,
        name: hit.title || name || siteLabel(hit.site) || "\u6807\u7B7E\u7EC4",
        tabIds: []
      });
    }
    const rec = absorbMap.get(hit.groupId);
    for (const id of tabIds) {
      if (claimed.has(id)) continue;
      if (groupOf.get(id) === hit.groupId) {
        claimed.add(id);
        continue;
      }
      rec.tabIds.push(id);
      claimed.add(id);
    }
  };
}
function previewGroupIds(group) {
  const ids = /* @__PURE__ */ new Set();
  for (const id of group?.tabIds || []) ids.add(String(id));
  for (const t of group?.tabs || []) {
    if (t?.id != null) ids.add(String(t.id));
    if (typeof t?.tabId === "number") ids.add(String(t.tabId));
  }
  return ids;
}
function previewGroupHasTab(group, tab) {
  const ids = previewGroupIds(group);
  const id = chromeTabId(tab);
  if (id != null && ids.has(String(id))) return true;
  return tab?.id != null && ids.has(String(tab.id));
}
function pickSeedGroupFromPreview(preview, seed) {
  const groups = (preview?.groups || []).filter((g) => (g.tabs?.length || g.tabIds?.length || 0) >= 2);
  return groups.find((g) => previewGroupHasTab(g, seed)) || null;
}
function pickTopicGroupFromPreview(preview, query) {
  const q = normName(query).replace(/\s+/g, "");
  if (!q) return null;
  const groups = (preview?.groups || []).filter((g) => (g.tabs?.length || g.tabIds?.length || 0) >= 2);
  const scored = [];
  for (const g of groups) {
    const n = normName(g.name).replace(/\s+/g, "");
    if (!n) continue;
    if (n === q) scored.push({ g, rank: 0 });
    else if (n.includes(q) || q.includes(n)) scored.push({ g, rank: 1 });
  }
  scored.sort((a, b) => a.rank - b.rank || (b.g.tabs?.length || 0) - (a.g.tabs?.length || 0));
  return scored[0]?.g || null;
}
function tabsForPreviewGroup(tabs, group) {
  const ids = previewGroupIds(group);
  return stashableTabs(tabs).filter((t) => {
    const id = chromeTabId(t);
    return id != null && ids.has(String(id)) || t?.id != null && ids.has(String(t.id));
  });
}
function planMatchedOrganize(windowTabs, existingMeta, none = TAB_GROUP_NONE, matches = [], name = "") {
  const title = String(name || "").trim() || "\u5206\u7EC4";
  const existing = decorateExistingGroups(windowTabs, existingMeta, none);
  const groupOf = tabGroupOf(windowTabs, none);
  const absorbMap = /* @__PURE__ */ new Map();
  const claimed = /* @__PURE__ */ new Set();
  const absorbInto = makeAbsorbInto(absorbMap, claimed, groupOf);
  const create = [];
  const picked = stashableTabs(matches);
  if (picked.length >= 2) {
    const hit = existing.find((g) => normName(g.title) === normName(title));
    const tabIds = picked.map((t) => chromeTabId(t)).filter((id) => id != null);
    if (hit) {
      absorbInto(hit, tabIds, title);
    } else if (tabIds.length >= 2) {
      create.push({ name: title, tabIds });
      for (const id of tabIds) claimed.add(id);
    }
  }
  return {
    absorb: [...absorbMap.values()].filter((a) => a.tabIds.length),
    create,
    merge: [],
    leftoverCount: stashableTabs(windowTabs).filter((t) => typeof t.id === "number" && !claimed.has(t.id)).length
  };
}
function planLiveOrganize(windowTabs, existingMeta, leftoverPreview, none = TAB_GROUP_NONE, opts = {}) {
  const existing = decorateExistingGroups(windowTabs, existingMeta, none);
  const mergeExisting = opts.mergeExisting !== false;
  const merge = [];
  const clusters = /* @__PURE__ */ new Map();
  for (const g of existing) {
    const key = existingClusterKey(g);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(g);
  }
  const keepGroups = [];
  for (const groups of clusters.values()) {
    const keep = largest(groups);
    keepGroups.push(keep);
    if (!mergeExisting || groups.length < 2) continue;
    const tabIds = [];
    for (const g of groups) {
      if (g.groupId === keep.groupId) continue;
      for (const t of g.tabs) {
        if (typeof t.id === "number") tabIds.push(t.id);
      }
    }
    if (tabIds.length) {
      merge.push({
        keepGroupId: keep.groupId,
        name: keep.title || siteLabel(keep.site) || "\u6807\u7B7E\u7EC4",
        tabIds
      });
    }
  }
  const absorbMap = /* @__PURE__ */ new Map();
  const claimed = /* @__PURE__ */ new Set();
  for (const m of merge) {
    for (const id of m.tabIds) claimed.add(id);
  }
  const absorbInto = makeAbsorbInto(absorbMap, claimed, tabGroupOf(windowTabs, none));
  const create = [];
  for (const g of leftoverPreview?.groups || []) {
    const fromTabs = chromeTabIds(g.tabs);
    const fromIds = (g.tabIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id >= 0);
    const tabIds = [...new Set(fromTabs.length ? fromTabs : fromIds)].filter((id) => !claimed.has(id));
    if (!tabIds.length) continue;
    const byTitle = keepGroups.filter((e) => e.title && normName(e.title) === normName(g.name));
    if (byTitle.length) {
      absorbInto(largest(byTitle), tabIds, g.name);
      continue;
    }
    if (tabIds.length >= 2) {
      create.push({ name: g.name || "\u672A\u547D\u540D", tabIds });
      for (const id of tabIds) claimed.add(id);
    }
  }
  const leftovers = stashableTabs(windowTabs).filter((t) => typeof t.id === "number" && !claimed.has(t.id));
  return {
    absorb: [...absorbMap.values()].filter((a) => a.tabIds.length),
    create,
    merge,
    leftoverCount: leftovers.length
  };
}
function planSelectedOrganize(windowTabs, existingMeta, selectedPreview, none = TAB_GROUP_NONE) {
  return planLiveOrganize(windowTabs, existingMeta, selectedPreview, none, { mergeExisting: false });
}
function previewFromPlan(plan, windowTabs) {
  const byId = /* @__PURE__ */ new Map();
  for (const t of windowTabs || []) {
    if (typeof t.id === "number") byId.set(t.id, t);
  }
  const titleOf = (id) => {
    const t = byId.get(id);
    return t?.title || t?.url || String(id);
  };
  const groups = [];
  for (const a of plan?.absorb || []) {
    groups.push({
      name: a.name,
      action: "absorb",
      tabs: a.tabIds.map((id) => ({ title: titleOf(id) })),
      tabIds: a.tabIds.map(String)
    });
  }
  for (const c of plan?.create || []) {
    groups.push({
      name: c.name,
      action: "create",
      tabs: c.tabIds.map((id) => ({ title: titleOf(id) })),
      tabIds: c.tabIds.map(String)
    });
  }
  for (const m of plan?.merge || []) {
    groups.push({
      name: m.name,
      action: "merge",
      tabs: m.tabIds.map((id) => ({ title: titleOf(id) })),
      tabIds: m.tabIds.map(String)
    });
  }
  return { groups, ungrouped: [] };
}

// extension/lib/liveOrganize.ts
var GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan"];
var MOVE_CHUNK = 12;
var TAB_GROUP_NONE2 = -1;
function liveItem(tab) {
  const title = String(tab.title || "").trim();
  const url = tab.url || "";
  const looksUrl = /^https?:\/\//i.test(title);
  return { id: String(tab.id), title: looksUrl ? "" : title, url, tabId: tab.id };
}
function isNativeUngrouped2(tab, none = TAB_GROUP_NONE2) {
  if (!tab) return false;
  return tab.groupId === void 0 || tab.groupId === none;
}
function tabsForWindowOrganize(tabs) {
  return (tabs || []).filter((t) => isStashableTab(t));
}
function tabsForSelectedOrganize(tabs) {
  return tabsForWindowOrganize(tabs).filter((t) => t.highlighted);
}
function resolveChromeTabId(tab) {
  if (typeof tab?.tabId === "number" && Number.isInteger(tab.tabId) && tab.tabId >= 0) {
    return tab.tabId;
  }
  const n = Number(tab?.id);
  if (Number.isInteger(n) && n >= 0) return n;
  return null;
}
function resolveChromeTabIds(tabs) {
  const ids = [];
  const seen = /* @__PURE__ */ new Set();
  for (const t of tabs || []) {
    const id = resolveChromeTabId(t);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
function planNativeGroups(windowTabs, preview) {
  const byId = /* @__PURE__ */ new Map();
  for (const t of windowTabs || []) {
    if (typeof t.id === "number") byId.set(t.id, t);
  }
  const planned = [];
  for (const g of preview?.groups || []) {
    const tabIds = resolveChromeTabIds(g.tabs).filter((id) => {
      const tab = byId.get(id);
      return !!tab && isStashableTab(tab);
    });
    if (tabIds.length >= 2) planned.push({ name: g.name || "\u672A\u547D\u540D", tabIds });
  }
  return planned;
}
function yieldUi(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}
async function getStashableTabsInWindow(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.filter((t) => isStashableTab(t));
}
async function previewLiveOrganizeSmart(tabs, onStatus) {
  const settings = await getSettings();
  const items = tabs.map(liveItem);
  const { preview, source, error } = await suggestGroupsSmart(items, {
    ...classifyOptsFromSettings(settings),
    onStatus
  });
  return { preview, source, error };
}
async function aliveTabIdsInWindow(tabIds, windowId) {
  const checks = await Promise.all(
    tabIds.map(async (id) => {
      try {
        const t = await chrome.tabs.get(id);
        return t.windowId === windowId && isStashableTab(t) ? id : null;
      } catch {
        return null;
      }
    })
  );
  return checks.filter((id) => id != null);
}
async function applyNativeGroups(windowId, preview, onProgress, opts = {}) {
  const ungroupLeftovers = opts.ungroupLeftovers === true;
  const windowTabs = await chrome.tabs.query({ windowId });
  const planned = planNativeGroups(windowTabs, preview);
  if (!planned.length) {
    return { ok: false, created: 0, failed: [], reason: "no_valid_groups" };
  }
  let created = 0;
  const failed = [];
  const keepGrouped = /* @__PURE__ */ new Set();
  let colorIdx = 0;
  const total = planned.length;
  for (let i = 0; i < planned.length; i += 1) {
    const g = planned[i];
    onProgress?.(`\u521B\u5EFA\u6807\u7B7E\u7EC4 ${i + 1}/${total}\uFF1A${g.name}`);
    try {
      const tabIds = await aliveTabIdsInWindow(g.tabIds, windowId);
      if (tabIds.length < 2) {
        failed.push({ name: g.name, error: "\u53EF\u7528\u6807\u7B7E\u4E0D\u8DB3 2 \u4E2A" });
        continue;
      }
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, {
        title: g.name,
        color: GROUP_COLORS[colorIdx % GROUP_COLORS.length]
      });
      for (const id of tabIds) keepGrouped.add(id);
      created += 1;
      colorIdx += 1;
    } catch (e) {
      failed.push({ name: g.name, error: String(e?.message || e) });
    }
    await yieldUi(0);
  }
  if (!created) {
    return { ok: false, created: 0, failed, reason: "all_failed" };
  }
  if (ungroupLeftovers) {
    try {
      await ungroupLeftoverStashable(windowId, keepGrouped, onProgress);
    } catch (e) {
      failed.push({ name: "(\u62C6\u6B8B\u7559\u7EC4)", error: String(e?.message || e) });
    }
  }
  if (failed.length) {
    return { ok: false, created, failed, reason: "partial" };
  }
  return { ok: true, created, failed: [] };
}
async function applyLivePlan(windowId, plan, onProgress) {
  if (!planHasWork(plan)) {
    return { ok: false, created: 0, absorbTabs: 0, merged: 0, failed: [], reason: "no_valid_groups" };
  }
  const failed = [];
  let created = 0;
  let absorbTabs = 0;
  let merged = 0;
  const usedColors = /* @__PURE__ */ new Set();
  try {
    const existing = await chrome.tabGroups.query({ windowId });
    for (const g of existing) usedColors.add(g.color);
  } catch {
  }
  let colorIdx = 0;
  const nextColor = () => {
    for (let i = 0; i < GROUP_COLORS.length; i += 1) {
      const c2 = GROUP_COLORS[(colorIdx + i) % GROUP_COLORS.length];
      if (!usedColors.has(c2)) {
        colorIdx = colorIdx + i + 1;
        usedColors.add(c2);
        return c2;
      }
    }
    const c = GROUP_COLORS[colorIdx % GROUP_COLORS.length];
    colorIdx += 1;
    return c;
  };
  for (const m of plan.merge || []) {
    onProgress?.(`\u5408\u5E76\u6807\u7B7E\u7EC4\u300C${m.name}\u300D`);
    try {
      const tabIds = await aliveTabIdsInWindow(m.tabIds, windowId);
      if (!tabIds.length) continue;
      await chrome.tabs.group({ tabIds, groupId: m.keepGroupId });
      merged += 1;
    } catch (e) {
      failed.push({ name: m.name, error: String(e?.message || e) });
    }
    await yieldUi(0);
  }
  for (const a of plan.absorb || []) {
    onProgress?.(`\u5E76\u5165\u300C${a.name}\u300D`);
    try {
      const tabIds = await aliveTabIdsInWindow(a.tabIds, windowId);
      if (!tabIds.length) continue;
      await chrome.tabs.group({ tabIds, groupId: a.groupId });
      absorbTabs += tabIds.length;
    } catch (e) {
      failed.push({ name: a.name, error: String(e?.message || e) });
    }
    await yieldUi(0);
  }
  for (const c of plan.create || []) {
    onProgress?.(`\u521B\u5EFA\u6807\u7B7E\u7EC4\uFF1A${c.name}`);
    try {
      const tabIds = await aliveTabIdsInWindow(c.tabIds, windowId);
      if (tabIds.length < 2) {
        failed.push({ name: c.name, error: "\u53EF\u7528\u6807\u7B7E\u4E0D\u8DB3 2 \u4E2A" });
        continue;
      }
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, { title: c.name, color: nextColor() });
      created += 1;
    } catch (e) {
      failed.push({ name: c.name, error: String(e?.message || e) });
    }
    await yieldUi(0);
  }
  if (!created && !absorbTabs && !merged) {
    return { ok: false, created: 0, absorbTabs: 0, merged: 0, failed, reason: "all_failed" };
  }
  try {
    await collapseInactiveGroups(windowId);
  } catch {
  }
  if (failed.length) {
    return { ok: false, created, absorbTabs, merged, failed, reason: "partial" };
  }
  return { ok: true, created, absorbTabs, merged, failed: [] };
}
async function collapseInactiveGroups(windowId) {
  const [active] = await chrome.tabs.query({ active: true, windowId });
  const groups = await chrome.tabGroups.query({ windowId });
  if (groups.length < 2) return;
  const keep = active && typeof active.groupId === "number" && active.groupId !== TAB_GROUP_NONE2 ? active.groupId : null;
  for (const g of groups) {
    const collapsed = keep == null ? true : g.id !== keep;
    if (g.collapsed === collapsed) continue;
    try {
      await chrome.tabGroups.update(g.id, { collapsed });
    } catch {
    }
  }
}
async function loadExistingGroupMeta(windowTabs, none = TAB_GROUP_NONE2) {
  const ids = [
    ...new Set(
      (windowTabs || []).filter((t) => typeof t.groupId === "number" && !isNativeUngrouped2(t, none)).map((t) => t.groupId)
    )
  ];
  const meta = [];
  for (const groupId of ids) {
    try {
      const g = await chrome.tabGroups.get(groupId);
      meta.push({ groupId, title: g.title || "", color: g.color });
    } catch {
      meta.push({ groupId, title: "", color: "grey" });
    }
  }
  return meta;
}
async function ungroupLeftoverStashable(windowId, keepGrouped, onProgress) {
  const tabs = await getStashableTabsInWindow(windowId);
  const leftover = tabs.filter(
    (t) => t.groupId !== void 0 && t.groupId !== TAB_GROUP_NONE2 && !keepGrouped.has(t.id)
  ).map((t) => t.id);
  if (!leftover.length) return;
  onProgress?.(`\u62C6\u5F00\u6B8B\u7559\u5206\u7EC4\uFF08${leftover.length}\uFF09`);
  for (let i = 0; i < leftover.length; i += MOVE_CHUNK) {
    await chrome.tabs.ungroup(leftover.slice(i, i + MOVE_CHUNK));
    await yieldUi(0);
  }
}
async function moveTabsInChunks(tabIds, windowId, onProgress) {
  if (!tabIds.length) return;
  const total = tabIds.length;
  for (let i = 0; i < tabIds.length; i += MOVE_CHUNK) {
    const chunk = tabIds.slice(i, i + MOVE_CHUNK);
    onProgress?.(`\u5408\u5E76\u6807\u7B7E ${Math.min(i + chunk.length, total)}/${total}`);
    await chrome.tabs.move(chunk, { windowId, index: -1 });
    await yieldUi(16);
  }
}
async function getLastFocusedNormalWindowId() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    return typeof win?.id === "number" ? win.id : null;
  } catch {
    return null;
  }
}
async function getWindowOrganizePreview(windowId, onStatus) {
  if (typeof windowId !== "number") return { ok: false, reason: "no_window" };
  const none = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? TAB_GROUP_NONE2;
  const windowTabs = await chrome.tabs.query({ windowId });
  const existingMeta = await loadExistingGroupMeta(windowTabs, none);
  const stashable = tabsForWindowOrganize(windowTabs);
  let leftoverPreview = { groups: [], ungrouped: stashable };
  let source = "empty";
  let error;
  if (stashable.length >= 2) {
    const r = await previewLiveOrganizeSmart(stashable, onStatus);
    leftoverPreview = r.preview;
    source = r.source;
    error = r.error;
    if (error && !leftoverPreview?.groups?.length) {
      return { ok: false, reason: "classify_failed", windowId, source, error };
    }
  }
  const plan = planLiveOrganize(windowTabs, existingMeta, leftoverPreview, none);
  if (!planHasWork(plan)) {
    return {
      ok: false,
      reason: stashable.length >= 2 ? "no_groups" : "too_few",
      windowId,
      source,
      error
    };
  }
  return {
    ok: true,
    preview: previewFromPlan(plan, windowTabs),
    plan,
    windowId,
    source,
    error
  };
}
async function organizeWindow(windowId, onProgress) {
  const r = await getWindowOrganizePreview(windowId, onProgress);
  if (!r.ok) return r;
  const applied = await applyLivePlan(windowId, r.plan, onProgress);
  if (!applied.ok) {
    return {
      ok: false,
      reason: applied.reason || "apply_failed",
      preview: r.preview,
      plan: r.plan,
      source: r.source,
      apply: applied
    };
  }
  return { ok: true, preview: r.preview, plan: r.plan, source: r.source, apply: applied };
}
async function organizeCurrentWindow(onProgress) {
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return { ok: false, reason: "no_window" };
  return organizeWindow(windowId, onProgress);
}
async function getSelectedOrganizePreview(windowId, onStatus) {
  if (typeof windowId !== "number") return { ok: false, reason: "no_window" };
  const none = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? TAB_GROUP_NONE2;
  const windowTabs = await chrome.tabs.query({ windowId });
  const existingMeta = await loadExistingGroupMeta(windowTabs, none);
  const selected = tabsForSelectedOrganize(windowTabs);
  if (selected.length < 2) {
    return { ok: false, reason: "no_selection", windowId, count: selected.length };
  }
  const r = await previewLiveOrganizeSmart(selected, onStatus);
  if (r.error && !r.preview?.groups?.length) {
    return { ok: false, reason: "classify_failed", windowId, source: r.source, error: r.error };
  }
  const plan = planSelectedOrganize(windowTabs, existingMeta, r.preview, none);
  if (!planHasWork(plan)) {
    return { ok: false, reason: "no_groups", windowId, source: r.source, error: r.error, count: selected.length };
  }
  return {
    ok: true,
    preview: previewFromPlan(plan, windowTabs),
    plan,
    windowId,
    source: r.source,
    error: r.error,
    count: selected.length
  };
}
async function organizeSelectedTabs(onProgress) {
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return { ok: false, reason: "no_window" };
  onProgress?.("\u6574\u7406\u9009\u4E2D\u6807\u7B7E");
  const r = await getSelectedOrganizePreview(windowId, onProgress);
  if (!r.ok) return r;
  const applied = await applyLivePlan(windowId, r.plan, onProgress);
  if (!applied.ok) {
    return {
      ok: false,
      reason: applied.reason || "apply_failed",
      preview: r.preview,
      plan: r.plan,
      source: r.source,
      count: r.count,
      apply: applied
    };
  }
  return { ok: true, preview: r.preview, plan: r.plan, source: r.source, count: r.count, apply: applied };
}
async function getWindowSeedOrganizePreview(windowId, onStatus) {
  if (typeof windowId !== "number") return { ok: false, reason: "no_window" };
  const none = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? TAB_GROUP_NONE2;
  const windowTabs = await chrome.tabs.query({ windowId });
  const existingMeta = await loadExistingGroupMeta(windowTabs, none);
  const [seedTab] = await chrome.tabs.query({ windowId, active: true });
  if (!isStashableTab(seedTab)) {
    return { ok: false, reason: "no_seed", windowId };
  }
  const stashable = tabsForWindowOrganize(windowTabs);
  if (stashable.length < 2) {
    return { ok: false, reason: "no_seed_match", windowId };
  }
  const r = await previewLiveOrganizeSmart(stashable, onStatus);
  if (r.error && !r.preview?.groups?.length) {
    return { ok: false, reason: "classify_failed", windowId, source: r.source, error: r.error };
  }
  const group = pickSeedGroupFromPreview(r.preview, seedTab);
  const matches = tabsForPreviewGroup(windowTabs, group);
  const plan = planMatchedOrganize(windowTabs, existingMeta, none, matches, group?.name);
  if (!planHasWork(plan)) {
    return { ok: false, reason: "no_seed_match", windowId, source: r.source };
  }
  return {
    ok: true,
    preview: previewFromPlan(plan, windowTabs),
    plan,
    windowId,
    source: r.source
  };
}
async function organizeAroundCurrentPage(onProgress) {
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return { ok: false, reason: "no_window" };
  onProgress?.("\u6309\u5F53\u524D\u9875\u5F52\u7EC4");
  const r = await getWindowSeedOrganizePreview(windowId, onProgress);
  if (!r.ok) return r;
  const applied = await applyLivePlan(windowId, r.plan, onProgress);
  if (!applied.ok) {
    return {
      ok: false,
      reason: applied.reason || "apply_failed",
      preview: r.preview,
      plan: r.plan,
      source: r.source,
      apply: applied
    };
  }
  return { ok: true, preview: r.preview, plan: r.plan, source: r.source, apply: applied };
}
async function organizeByTopic(query, onProgress) {
  const q = String(query || "").trim();
  if (!q) return { ok: false, reason: "no_topic" };
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return { ok: false, reason: "no_window" };
  onProgress?.(`\u6309\u300C${q.slice(0, 24)}\u300D\u5F52\u7EC4`);
  const none = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? TAB_GROUP_NONE2;
  const windowTabs = await chrome.tabs.query({ windowId });
  const existingMeta = await loadExistingGroupMeta(windowTabs, none);
  const stashable = tabsForWindowOrganize(windowTabs);
  if (stashable.length < 2) return { ok: false, reason: "no_topic_match", windowId };
  const r = await previewLiveOrganizeSmart(stashable, onProgress);
  if (r.error && !r.preview?.groups?.length) {
    return { ok: false, reason: "classify_failed", windowId, source: r.source, error: r.error };
  }
  const group = pickTopicGroupFromPreview(r.preview, q);
  const matches = tabsForPreviewGroup(windowTabs, group);
  const plan = planMatchedOrganize(windowTabs, existingMeta, none, matches, group?.name || q);
  if (!planHasWork(plan)) return { ok: false, reason: "no_topic_match", windowId, source: r.source };
  const preview = previewFromPlan(plan, windowTabs);
  const applied = await applyLivePlan(windowId, plan, onProgress);
  if (!applied.ok) {
    return {
      ok: false,
      reason: applied.reason || "apply_failed",
      preview,
      plan,
      source: r.source,
      apply: applied
    };
  }
  return { ok: true, preview, plan, source: r.source, apply: applied, topic: q };
}
var relatedPickCache = null;
function relatedFingerprint(tabs, seedId) {
  const ids = (tabs || []).map((t) => t.id).filter((id) => typeof id === "number").sort((a, b) => a - b);
  return `${seedId}:${ids.join(",")}`;
}
async function classifyRelatedPick(onStatus) {
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return { ok: false, reason: "no_window" };
  const [seed] = await chrome.tabs.query({ windowId, active: true });
  if (!isStashableTab(seed) || typeof seed.id !== "number") {
    return { ok: false, reason: "no_seed" };
  }
  const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const allTabs = allWindows.flatMap((w) => w.tabs || []);
  const stashable = tabsForWindowOrganize(allTabs);
  const fp = relatedFingerprint(stashable, seed.id);
  if (relatedPickCache?.fp === fp) return relatedPickCache;
  if (stashable.length < 2) {
    relatedPickCache = { fp, ok: false, reason: "no_seed_match", count: 0, name: "", matches: [], seed };
    return relatedPickCache;
  }
  const r = await previewLiveOrganizeSmart(stashable, onStatus);
  if (r.error && !r.preview?.groups?.length) {
    relatedPickCache = {
      fp,
      ok: false,
      reason: "classify_failed",
      error: r.error,
      source: r.source,
      count: 0,
      name: "",
      matches: [],
      seed
    };
    return relatedPickCache;
  }
  const group = pickSeedGroupFromPreview(r.preview, seed);
  const matches = tabsForPreviewGroup(allTabs, group);
  const name = group?.name || "";
  relatedPickCache = {
    fp,
    ok: matches.length >= 2,
    reason: matches.length >= 2 ? void 0 : "no_seed_match",
    source: r.source,
    count: matches.length,
    name,
    matches,
    seed
  };
  return relatedPickCache;
}
async function relatedToNewWindowSummary(onStatus) {
  const pick = await classifyRelatedPick(onStatus);
  if (pick.reason === "no_window") return null;
  return {
    count: pick.count || 0,
    name: pick.name || "",
    reason: pick.reason,
    error: pick.error,
    source: pick.source
  };
}
async function moveRelatedToNewWindow(onProgress) {
  const pick = await classifyRelatedPick(onProgress);
  if (!pick.ok) {
    return { ok: false, reason: pick.reason || "no_seed_match", error: pick.error, source: pick.source };
  }
  const { seed, matches, name } = pick;
  if (!isStashableTab(seed) || typeof seed.id !== "number") {
    return { ok: false, reason: "no_seed" };
  }
  relatedPickCache = null;
  onProgress?.(`\u79FB\u5230\u65B0\u7A97\u53E3\u300C${name}\u300D`);
  let win;
  try {
    win = await chrome.windows.create({ tabId: seed.id, focused: true });
  } catch (e) {
    return { ok: false, reason: "apply_failed", error: String(e?.message || e) };
  }
  const newWindowId = win?.id;
  if (typeof newWindowId !== "number") return { ok: false, reason: "no_window" };
  const others = matches.map((t) => t.id).filter((id) => typeof id === "number" && id !== seed.id);
  const byWin = /* @__PURE__ */ new Map();
  for (const id of others) {
    try {
      const t = await chrome.tabs.get(id);
      if (t.windowId === newWindowId || t.pinned || !isStashableTab(t)) continue;
      if (!byWin.has(t.windowId)) byWin.set(t.windowId, []);
      byWin.get(t.windowId).push(id);
    } catch {
    }
  }
  let moved = 1;
  for (const ids of byWin.values()) {
    for (let i = 0; i < ids.length; i += MOVE_CHUNK) {
      const chunk = ids.slice(i, i + MOVE_CHUNK);
      onProgress?.(`\u79FB\u52A8\u6807\u7B7E ${moved + chunk.length}/${matches.length}`);
      try {
        await chrome.tabs.move(chunk, { windowId: newWindowId, index: -1 });
        moved += chunk.length;
      } catch {
      }
      await yieldUi(16);
    }
  }
  const alive = await aliveTabIdsInWindow(
    matches.map((t) => t.id).filter((id) => typeof id === "number"),
    newWindowId
  );
  if (alive.length >= 2) {
    try {
      const groupId = await chrome.tabs.group({
        tabIds: alive,
        createProperties: { windowId: newWindowId }
      });
      await chrome.tabGroups.update(groupId, { title: name, color: "cyan" });
    } catch (e) {
      return {
        ok: false,
        reason: "partial",
        moved,
        name,
        windowId: newWindowId,
        error: String(e?.message || e)
      };
    }
  }
  return { ok: true, moved, name, windowId: newWindowId, source: "seed" };
}
async function mergeOrganizeSummary() {
  const windowId = await getLastFocusedNormalWindowId();
  if (windowId == null) return null;
  const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  let otherWindows = 0;
  let movableTabs = 0;
  let skippedPinned = 0;
  let skippedUrl = 0;
  for (const w of allWindows) {
    if (w.id === windowId) continue;
    otherWindows += 1;
    for (const tab of w.tabs || []) {
      if (tab.pinned) {
        skippedPinned += 1;
        continue;
      }
      if (!isStashableTab(tab)) {
        skippedUrl += 1;
        continue;
      }
      movableTabs += 1;
    }
  }
  const currentTabs = await getStashableTabsInWindow(windowId);
  return {
    targetWindowId: windowId,
    otherWindows,
    movableTabs,
    skippedPinned,
    skippedUrl,
    currentTabCount: currentTabs.length + movableTabs
  };
}
async function mergeAndOrganizeCurrent(opts = {}) {
  const onProgress = opts.onProgress || (() => {
  });
  const summary = await mergeOrganizeSummary();
  if (!summary) return { ok: false, reason: "no_window" };
  const { targetWindowId } = summary;
  onProgress("\u6536\u96C6\u5176\u4ED6\u7A97\u53E3\u6807\u7B7E\u2026");
  const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const toMove = [];
  for (const w of allWindows) {
    if (w.id === targetWindowId) continue;
    for (const tab of w.tabs || []) {
      if (!isStashableTab(tab) || typeof tab.id !== "number") continue;
      toMove.push(tab.id);
    }
  }
  await moveTabsInChunks(toMove, targetWindowId, onProgress);
  const tabs = await getStashableTabsInWindow(targetWindowId);
  if (tabs.length < 2) return { ok: false, reason: "too_few", summary };
  onProgress("\u751F\u6210\u5206\u7EC4\u5EFA\u8BAE\u2026");
  const { preview, source, error } = await previewLiveOrganizeSmart(tabs, onProgress);
  if (error && !preview?.groups?.length) {
    return { ok: false, reason: "classify_failed", error, summary, source };
  }
  if (!preview.groups.length) return { ok: false, reason: "no_groups", summary, source };
  const applied = await applyNativeGroups(targetWindowId, preview, onProgress, {
    ungroupLeftovers: true
  });
  if (!applied.ok) {
    onProgress(applied.reason === "partial" ? "\u90E8\u5206\u5206\u7EC4\u672A\u5B8C\u6210" : "\u5206\u7EC4\u5931\u8D25");
    return { ok: false, reason: applied.reason || "apply_failed", preview, summary, source, apply: applied };
  }
  onProgress("\u5B8C\u6210");
  return { ok: true, preview, summary, source, apply: applied };
}

// extension/lib/bgJobs.ts
var running = null;
function slimResult(r) {
  if (!r || typeof r !== "object") return { ok: false, reason: "apply_failed" };
  return {
    ok: !!r.ok,
    reason: r.reason,
    error: r.error,
    source: r.source,
    count: r.count,
    name: r.name,
    moved: r.moved,
    topic: r.topic,
    apply: r.apply && {
      created: r.apply.created,
      absorbTabs: r.apply.absorbTabs,
      merged: r.apply.merged
    },
    summary: r.summary && { movableTabs: r.summary.movableTabs }
  };
}
async function runOrganizeJob(op, payload = {}, onStatus) {
  if (running) return { ok: false, reason: "busy", error: "\u6B63\u5728\u6574\u7406\uFF0C\u8BF7\u7A0D\u5019" };
  const task = (async () => {
    switch (op) {
      case "window":
        return organizeCurrentWindow(onStatus);
      case "selected":
        return organizeSelectedTabs(onStatus);
      case "around":
        return organizeAroundCurrentPage(onStatus);
      case "topic":
        return organizeByTopic(String(payload.query || ""), onStatus);
      case "related-summary": {
        const s = await relatedToNewWindowSummary(onStatus);
        if (!s) return { ok: false, reason: "no_window", count: 0 };
        return { ...s, ok: !s.reason && (s.count || 0) >= 2 };
      }
      case "related":
        return moveRelatedToNewWindow(onStatus);
      case "merge":
        return mergeAndOrganizeCurrent({ onProgress: onStatus });
      default:
        return { ok: false, reason: "stale_sw", error: `\u4E0D\u652F\u6301\u7684\u6574\u7406\u64CD\u4F5C\uFF1A${op || "\u7A7A"}` };
    }
  })();
  running = task;
  try {
    return slimResult(await task);
  } finally {
    if (running === task) running = null;
  }
}
function organizeStatusText(text) {
  const t = String(text || "");
  if (!t) return "";
  if (/文件已齐|下载中|^从 .+ 拉取|正在下载/.test(t)) return "\u6B63\u5728\u52A0\u8F7D\u6A21\u578B";
  return t;
}
function jobStatusFn(reqId) {
  if (!reqId) return void 0;
  return (text) => {
    const out = organizeStatusText(text);
    if (!out) return;
    chrome.runtime.sendMessage({
      type: "tm-job-status",
      reqId,
      text: out
    }).catch(() => {
    });
  };
}

// extension/background.ts
var MENU = {
  STASH_WINDOW: "stash-window",
  STASH_ALL: "stash-all",
  ORGANIZE_WINDOW: "organize-window",
  ORGANIZE_SELECTED: "organize-selected",
  ORGANIZE_AROUND: "organize-around",
  RELATED_NEW_WINDOW: "related-new-window",
  MERGE_ORGANIZE: "merge-organize"
};
var CTX = ["page", "action"];
var COMMAND = {
  STASH: "stash-other-tabs",
  MANAGE: "open-management"
};
function managementUrl(hash = "") {
  return chrome.runtime.getURL(`management.html${hash}`);
}
async function openManagement(hash = "") {
  await chrome.tabs.create({ url: managementUrl(hash) });
}
var badgeTimer = 0;
async function flashStashBadge(r) {
  const ok = !!r?.ok;
  const text = ok ? String(r.count ?? 0).slice(0, 4) : "!";
  try {
    await chrome.action.setBadgeBackgroundColor({ color: ok ? "#1d1d1f" : "#c2332b" });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: "#ffffff" });
    }
    await chrome.action.setBadgeText({ text });
  } catch {
  }
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: "" }).catch(() => {
    });
  }, 2200);
}
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU.STASH_WINDOW,
      title: "\u6536\u7EB3\u5F53\u524D\u7A97\u53E3\uFF08\u4FDD\u7559\u5F53\u524D\u9875\uFF09",
      contexts: CTX
    });
    chrome.contextMenus.create({
      id: MENU.STASH_ALL,
      title: "\u6536\u7EB3\u5168\u90E8\u7A97\u53E3\uFF08\u4FDD\u7559\u5F53\u524D\u9875\uFF09",
      contexts: CTX
    });
    chrome.contextMenus.create({
      id: MENU.ORGANIZE_WINDOW,
      title: "\u6574\u7406\u5F53\u524D\u7A97\u53E3",
      contexts: CTX
    });
    chrome.contextMenus.create({
      id: MENU.ORGANIZE_SELECTED,
      title: "\u6574\u7406\u9009\u4E2D\u7684\u6807\u7B7E",
      contexts: CTX
    });
    chrome.contextMenus.create({
      id: MENU.ORGANIZE_AROUND,
      title: "\u6309\u5F53\u524D\u9875\u5F52\u7EC4",
      contexts: CTX
    });
    chrome.contextMenus.create({
      id: MENU.RELATED_NEW_WINDOW,
      title: "\u76F8\u5173\u6807\u7B7E\u5230\u65B0\u7A97\u53E3",
      contexts: CTX
    });
    chrome.contextMenus.create({
      id: MENU.MERGE_ORGANIZE,
      title: "\u6574\u7406\u5168\u90E8\u7A97\u53E3\u5E76\u5408\u5E76\u5230\u5F53\u524D",
      contexts: CTX
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
      const r = await runOrganizeJob("window");
      await flashStashBadge({ ok: !!r?.ok, count: r?.apply?.created ?? 0 });
    } else if (info.menuItemId === MENU.ORGANIZE_SELECTED) {
      const r = await runOrganizeJob("selected");
      await flashStashBadge({ ok: !!r?.ok, count: r?.apply?.created ?? 0 });
    } else if (info.menuItemId === MENU.ORGANIZE_AROUND) {
      const r = await runOrganizeJob("around");
      await flashStashBadge({ ok: !!r?.ok, count: (r?.apply?.created ?? 0) + (r?.apply?.absorbTabs ?? 0) });
    } else if (info.menuItemId === MENU.RELATED_NEW_WINDOW) {
      const r = await runOrganizeJob("related");
      await flashStashBadge({ ok: !!r?.ok, count: r?.moved ?? 0 });
    } else if (info.menuItemId === MENU.MERGE_ORGANIZE) {
      await openManagement("#merge");
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
function organizeJobOf(msg) {
  if (msg?.job || msg?.op) return msg.job || msg.op;
  return {
    "tm-organize": "window",
    ORGANIZE: "window",
    ORGANIZE_CURRENT_WINDOW: "window",
    ORGANIZE_AROUND_CURRENT: "around",
    MOVE_RELATED_NEW_WINDOW: "related",
    MERGE_ORGANIZE: "merge"
  }[msg?.type];
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const type = msg?.type;
  if (type === "tm-offscreen" || type === "tm-model-status" || type === "tm-job-status") {
    return false;
  }
  const job = organizeJobOf(msg);
  const isOrganize = type === "tm-organize" || type === "ORGANIZE" || !!job && (type === "ORGANIZE_CURRENT_WINDOW" || type === "ORGANIZE_AROUND_CURRENT" || type === "MOVE_RELATED_NEW_WINDOW" || type === "MERGE_ORGANIZE");
  if (!isOrganize && type !== "STASH_CURRENT_WINDOW" && type !== "STASH_ALL_WINDOWS" && type !== "OPEN_MANAGEMENT" && type !== "tm-model") {
    return false;
  }
  (async () => {
    try {
      if (type === "STASH_CURRENT_WINDOW") {
        const keepActive = msg.keepActive !== false;
        const r = await stashCurrentWindow({ keepActive });
        if (r.ok && msg.reviewInTab) {
          await openManagement(`#review=${encodeURIComponent(r.session.id)}`);
        }
        sendResponse(r);
        return;
      }
      if (type === "STASH_ALL_WINDOWS") {
        sendResponse(await stashAllWindows({ keepActive: msg.keepActive !== false }));
        return;
      }
      if (type === "OPEN_MANAGEMENT") {
        await openManagement(typeof msg.hash === "string" ? msg.hash : "");
        sendResponse({ ok: true });
        return;
      }
      if (type === "tm-model") {
        await ensureOffscreen();
        let last = new Error("\u6A21\u578B\u8FD0\u884C\u9875\u672A\u5C31\u7EEA");
        let res;
        for (let i = 0; i < 8; i += 1) {
          try {
            res = await chrome.runtime.sendMessage({
              type: "tm-offscreen",
              op: msg.op,
              reqId: msg.reqId,
              items: msg.items,
              opts: msg.opts,
              modelId: msg.modelId,
              preferWebGPU: msg.preferWebGPU
            });
            if (res !== void 0) break;
          } catch (e) {
            last = e instanceof Error ? e : new Error(String(e));
            await new Promise((r) => setTimeout(r, 80 * (i + 1)));
          }
        }
        sendResponse(res ?? { error: last.message });
        return;
      }
      sendResponse(await runOrganizeJob(job, { query: msg.query }, jobStatusFn(msg.reqId)));
    } catch (e) {
      sendResponse({ ok: false, reason: "classify_failed", error: String(e?.message || e) });
    }
  })();
  return true;
});
