# Tab Manager — Agent 说明

Chrome / Edge MV3 扩展：收纳标签 + 本地整理。源码在 `ui/`，可加载产物在 `extension/`。

## 常用命令

```bash
npm ci                 # 或 npm install
npm run build:ui       # 构建 popup / 管理页 → extension/
npm run check:groups   # 站点组名 / X 套话残词
npm run vendor:transformers  # 仅当 extension/vendor 缺失时
npm run dev:ui         # 本地预览 :5190
```

改 `ui/` 或 `extension/` 里的 TypeScript 后必须 `npm run build:ui`（会打 popup / 管理页 / 侧栏，以及 `background.js` / `offscreen.js`），再在浏览器扩展页「重新加载」。

## Cursor Cloud specific instructions

- 环境由 `.cursor/environment.json` 定义：Node 22 镜像 + `npm ci || npm install`。
- **不要**在云端假设本机已加载扩展；验证以 `npm run build:ui` 能成功为准。
- 扩展无法在 Cloud VM 里真实跑 Chrome 扩展 API；涉及 `chrome.*` 的改动以类型检查 / 构建通过为主，必要时说明需本地加载 `extension/` 手测。
- 勿提交 `node_modules/`、`.scratch/`、`.env*`。
- 未经用户明确要求不要 `git push --force`，不要改 git config。
- Commit 信息不要带 Cursor 署名；文档优先中文。
