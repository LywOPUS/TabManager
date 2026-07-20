# Tab Manager

浏览器扩展：OneTab 式收纳 + Edge 式本地整理。支持 Chrome / Edge（MV3）。

## 开发

```bash
npm i
npm run build:ui          # 构建管理页与 popup → extension/
npm run vendor:transformers  # 如缺 vendor，重新拷贝 transformers
npm run dev:ui            # UI 热更新预览（默认 :5190）
```

加载扩展：开发者模式 →「加载已解压的扩展程序」→ 选择 `extension/`。

改 `ui/` 后需重新 `npm run build:ui`，再在扩展页点「重新加载」。

更细的权限与分类说明见 [`extension/README.md`](extension/README.md)。领域用语见 [`CONTEXT.md`](CONTEXT.md)。

## 目录

| 路径 | 说明 |
| --- | --- |
| `extension/` | 可加载的扩展产物与原生 `lib/`、`background.js` |
| `ui/` | 管理页 / popup 的 React 源码 |
| `scripts/` | vendor 等构建脚本 |
