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
| `contextMenus` | 右键收纳 / 整理当前窗口 / 合并整理 |
| `host_permissions` → `127.0.0.1:11434` | 可选：调用本机 Ollama |

数据默认不上传；开启「本地模型分类」时，仅把标题/域名发给本机 Ollama。

## 分类方式（管理页「分类」下拉）

| 模式 | 说明 |
| --- | --- |
| **按站点** | eTLD+1，最快，无下载 |
| **浏览器内小模型** | Xenova 句向量；默认 **WebGPU + fp16**（更快），失败自动 **WASM + q8**；可选 MiniLM-L6 / 多语言 MiniLM / E5-small |
| **Google Gemini Nano** | Chrome 内置 Prompt API（`LanguageModel`），端上生成式分类；**主要支持 Chrome 桌面**，需硬件/存储达标；Edge 通常没有 |
| **Ollama** | 本机 `127.0.0.1:11434` 聊天模型 |

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

- **Popup**：收纳当前窗口、打开标签管理、恢复最近会话
- **管理页**：`management.html`
- **右键菜单**（页面或扩展图标）：收纳当前/全部窗口、整理当前窗口、整理全部窗口并合并到当前

## 自测清单

- [ ] 收纳 / 按分组恢复 / 全部分批恢复 / 导出导入
- [ ] 建议分组（站点 / 本地模型）
- [ ] 整理当前窗口
- [ ] 合并全部窗口：进度条有更新、最终有原生组
- [ ] Ollama 未启动时勾选本地模型仍能回退站点分组

## 刻意未做

搜索/拖拽/多选、云同步、云端 LLM、Side Panel、Firefox、预览内微调、快捷键。

规格详见 [`.scratch/tab-manager-mvp/spec.md`](../.scratch/tab-manager-mvp/spec.md)。
