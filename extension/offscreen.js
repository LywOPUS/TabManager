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
async function deleteMatching(predicate) {
  const cache = await openTransformersCache();
  let removed = 0;
  let bytes = 0;
  if (!cache) return { ok: true, removed, bytes };
  const entries = await readCacheEntries();
  const reqs = await cache.keys();
  const byUrl = new Map(entries.map((e) => [e.url, e.bytes || 0]));
  for (const req of reqs) {
    if (!predicate(req.url)) continue;
    await cache.delete(req);
    removed += 1;
    bytes += byUrl.get(req.url) || 0;
  }
  return { ok: true, removed, bytes };
}
async function purgeLeftoverModelCache(modelId) {
  const entries = await readCacheEntries();
  const drop = new Set(
    entries.filter((e) => {
      if (modelId && !cacheUrlMatchesModel(e.url, getBrowserModelMeta(modelId).id)) return false;
      return isLeftoverEntry(e, BROWSER_MODELS);
    }).map((e) => e.url)
  );
  return deleteMatching((url) => drop.has(url));
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
function inPopupPage() {
  try {
    return typeof location !== "undefined" && /popup\.html$/i.test(location.pathname);
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
function getLastEmbedDevice() {
  return lastDevice;
}
function unloadBrowserModel() {
  extractorPromise = null;
  loadedKey = null;
  if (canUseOffscreen()) {
    void offscreenRpc("unload").catch(() => {
    });
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
function getBrowserModelWarmState(modelId, preferWebGPU = true) {
  const id = modelId || DEFAULT_BROWSER_MODEL;
  const key = `${id}|gpu:${preferWebGPU ? 1 : 0}`;
  return {
    warm: !!(extractorPromise && loadedKey === key),
    loadedKey,
    lastDevice,
    webgpuDead: webgpuDeadSession.has(id)
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
async function preloadBrowserModel(modelId, { preferWebGPU = true, onStatus } = {}) {
  if (inPopupPage()) throw new Error(MODEL_NOT_DOWNLOADED);
  const meta = getBrowserModelMeta(modelId);
  if (shouldOffloadModel(meta)) {
    try {
      await offscreenRpc("preload", { modelId, opts: { preferWebGPU } }, onStatus);
      return true;
    } catch (e) {
      if (inServiceWorker()) throw e;
      const raw = String(e?.message || e);
      if (!/无法启动|未就绪|Receiving end|offscreen/i.test(raw)) throw e;
      console.warn("offscreen preload fallback", e);
    }
  }
  await getExtractor(modelId, { onStatus, preferWebGPU, allowDownload: true });
  try {
    await purgeLeftoverModelCache(modelId);
  } catch {
  }
  return true;
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

// extension/offscreen.ts
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "tm-offscreen") return void 0;
  const onStatus = (text, detail) => {
    chrome.runtime.sendMessage({
      type: "tm-model-status",
      reqId: msg.reqId,
      text,
      detail
    }).catch(() => {
    });
  };
  (async () => {
    switch (msg.op) {
      case "classify":
        return {
          preview: await classifyWithBrowserEmbed(msg.items || [], {
            ...msg.opts || {},
            allowDownload: false,
            onStatus
          })
        };
      case "preload":
        await preloadBrowserModel(msg.modelId, { ...msg.opts || {}, onStatus });
        return { ok: true };
      case "unload":
        unloadBrowserModel();
        return { ok: true };
      case "warm":
        return getBrowserModelWarmState(msg.modelId, msg.preferWebGPU);
      case "device":
        return { device: getLastEmbedDevice() };
      default:
        return { error: `unknown op ${msg.op}` };
    }
  })().then(sendResponse).catch((e) => sendResponse({ error: String(e?.message || e) }));
  return true;
});
