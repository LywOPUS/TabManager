# Tab Manager 扩展

OneTab 式收纳 + Edge 式本地整理。Chrome MV3 / Edge 桌面可加载；管理页为 React + `@glasscn` 液态玻璃 UI（需构建）。

## 加载步骤

1. 仓库根目录执行：`npm i` 与 `npm run build:ui`（改管理页后也要重新构建）
2. 打开 `chrome://extensions`（Edge：`edge://extensions`）
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择本目录 `extension/`
6. 改代码后：若改了 `ui/` 先 `npm run build:ui`，再在扩展页点「重新加载」

background / `lib/` 仍为原生 ES 模块；管理页与 popup 源码在仓库 `ui/`，产物为 `extension/management.html`、`extension/popup.html` + `extension/mgmt/`。

## 权限说明

| 权限 | 原因 |
| --- | --- |
| `storage` | 会话数据存于本机 |
| `tabs` | 读标签 URL/标题、关/开/移动 |
| `tabGroups` | Live Organize 写入原生标签组 |
| `contextMenus` | 右键收纳 / 整理当前窗口 / 整理选中的标签 / 合并整理 |
| `host_permissions` → `127.0.0.1:11434` | 可选：调用本机 Ollama |
| `optional_host_permissions` → `https://*/*` / `http://*/*` | 可选：OpenAI 兼容端点（保存 Base URL 时按域名申请） |

数据默认不上传。开启 Ollama 时仅把标题/域名发给本机；开启「OpenAI 兼容」时发往你配置的 Base URL，API Key 存于本机 `chrome.storage.local`。

## 分类方式（管理页「分类」下拉）

| 模式 | 说明 |
| --- | --- |
| **浏览器内小模型**（默认） | 默认 **内置 MiniLM-L6**（约 23MB，开箱即用）。可选再下 EmbeddingGemma / 多语言 MiniLM / E5。**全局主题聚类**。大模型只在管理页「模型」下载。填了 OpenAI 兼容 Key 时，只把每组几条标题发去起名、剔预告/音乐/空壳 |
| **Google Gemini Nano** | Chrome 内置 Prompt API（`LanguageModel`），端上生成式分类；**主要支持 Chrome 桌面**，需硬件/存储达标；Edge 通常没有 |
| **Ollama** | 本机 `127.0.0.1:11434` 聊天模型 |
| **OpenAI 兼容** | `/v1/chat/completions`（可配 Base URL、API Key、Model） |

已停用「按站点」。模型失败时**不会**回退站点分组，整理中止并提示错误。旧设置里的 `site` 会读成浏览器内小模型。

### 稍后阅读

每个会话固定有「稍后阅读」分组（可空）。管理页标签行可「稍后阅读 / 移出」；建议分组不会改动该组内标签。旧会话打开管理页时会自动补上该组。

主题分组标题旁可「解散」：标签并入「未分组」，主题组删除。「稍后阅读」「未分组」为固定组，不可解散（稍后阅读请用「移出」清空）。

### 分组质量

| 档位 | 说明 |
| --- | --- |
| **快速** | 本地全局聚类；若已填远程 Key，再只发每组代表标题起名/剔脏 |
| **增强** | 主题提示加强；OpenAI 全程分类时另做近义组合并与会话命名 |

组名、同站合并与跨站主题剥离在 `extension/lib/groupLabels.js`：twitter.com / t.co / x.com 显示为 **X**，且不再从「在 X 上的帖子」切出「上的」。X 能确定作者或主题时用 **X|alice** / **X|React**；剥掉套话后的正文才参与跨站主题。加站点改这一份即可。

### Gemini Nano 启用提示（Chrome）

1. 使用较新的 Chrome 桌面版（扩展侧 Prompt API 从较新版本起可用）
2. 若不可用：打开 `chrome://flags`，搜索并启用与 Gemini Nano / Prompt API 相关的项
3. 在 `chrome://on-device-internals` 查看模型下载状态
4. 硬件大致要求：较多空闲磁盘（文档曾写约 22GB 级余量，以官方为准）、较新 CPU/GPU

浏览器内模型运行时依赖已打进 `extension/vendor/transformers/`（含 ONNX WASM）。若缺失可在仓库根目录执行：

```bash
npm i
npm run vendor:transformers
```

首次选「浏览器内小模型」时需能访问 `huggingface.co`（仅下载模型权重，不上传你的标签内容到第三方服务器以外的推理——推理在本地浏览器完成）。

## 合并窗口性能

跨窗合并已改为：分批移动（每批 12）+ 进度文案 + 合并后拆组再重分组，减轻一次挪几百标签的卡顿感。

## 入口

- **工具栏弹窗**：收纳（默认留下当前页）；整理类操作发给 background（关弹窗不中断），含整理当前窗口、整理选中标签、按当前页归组、相关到新窗口、按主题归组、合并全部窗口、解散全部窗口标签组、合并打开的重复网页
- **管理页**：全部会话、搜索、预览整理/跨窗合并、去重（打开的 + 已收纳）、闲置、分类设置、模型（统一下载）、导入导出、会话内分组解散
- **快捷键**（可在 `chrome://extensions/shortcuts` 改）：`Alt+Shift+S` 收纳（留下当前页）；`Alt+Shift+M` 打开标签管理
- **右键菜单**（页面或扩展图标）：收纳当前/全部窗口（默认保留当前页）、立刻整理当前窗口、整理选中的标签、按当前页归组、相关标签到新窗口、整理全部窗口并合并到当前（打开管理页确认）

收纳默认**留下当前页**。需要连当前页一起收进会话时，用弹窗或管理页里的「连当前页一起收纳」。右键收纳成功后，工具栏图标会短暂显示数量。

## 自测清单

- [ ] 弹窗：收纳 / 立刻整理当前窗口 / 整理选中标签 / 按当前页归组 / 相关到新窗口 / 按主题归组 / 合并全部窗口 / 解散全部窗口标签组 / 合并打开的重复网页
- [ ] 管理页：预览整理、跨窗合并、打开的+已收纳去重、会话内解散分组
- [ ] 闲置休眠：按 lastAccessed 建议休眠 ≥30 分钟闲置标签（Dev 可附进程内存）
- [ ] 建议分组（站点 / 本地模型 / OpenAI 兼容）
- [ ] 整理当前窗口：含已成组可重分；跨站主题优先成组；X 忙则按作者拆；同站并入已有组（含单条）；忙 GitHub 按 owner 拆
- [ ] 整理选中标签：Ctrl / Shift 多选至少 2 个后只动这些页；未选中的组和标签不动
- [ ] 按当前页归组：可从已有组抽走同作者/同主题；X → `X|alice`；react.dev + GitHub React → React
- [ ] 相关到新窗口：各窗相关标签移到新窗口并成组；其余留下
- [ ] 按主题归组：输入 React / alice 后只收对得上的标签
- [ ] 合并全部窗口：进度条有更新、最终有原生组
- [ ] Ollama 未启动时勾选本地模型仍能回退站点分组
- [ ] OpenAI 兼容：未填 Key 或拒绝主机权限时回退站点分组

## 刻意未做

拖拽/多选、云同步、完整对话式云端 Agent、Side Panel、Firefox、预览内微调。

规格详见 [`.scratch/tab-manager-mvp/spec.md`](../.scratch/tab-manager-mvp/spec.md)。
