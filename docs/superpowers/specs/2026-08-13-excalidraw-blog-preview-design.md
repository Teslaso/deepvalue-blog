# Excalidraw Blog Preview Design

## Goal

让博客可以展示来自 Obsidian Excalidraw 的“铝”知识图，先实现一个可交互的浏览预览，不改变 Obsidian 原稿，也不引入编辑、协作或后端保存。

## Scope

- 新增一个可复用的 `CanvasDiagram` Astro/客户端组件。
- 为“铝”图提供博客侧的静态资源入口。
- 默认提供可见的静态预览；点击后打开画布查看层。
- 查看层支持鼠标/触控缩放、拖动、关闭和回到适合视图。
- 保留静态 PNG 作为无 JavaScript 或加载失败时的回退。
- 只实现单张图验证，不修改发布器的自动 Excalidraw 转换能力。

## Non-goals

- 不把 Obsidian 插件代码打包进博客。
- 不支持网页端编辑、保存、实时协作或用户上传。
- 不解析 Vault 中的 Obsidian 双链并自动映射博客 URL。
- 不改写 `/Users/matt/Library/CloudStorage/OneDrive-个人/obsidian_trading/Excalidraw/铝.md`。

## Architecture

Obsidian 文件仍然是源文件。验证阶段使用从该文件导出的博客侧资源；Astro 页面只消费公开资源，不在构建期间读取 OneDrive 路径。`CanvasDiagram` 负责展示入口和查看层，资源加载失败时保持 PNG 预览可见。

第一版优先使用 SVG/PNG 作为可发布的静态内容，并为后续加载标准 `.excalidraw` JSON 的只读 Excalidraw 组件保留接口。这样可以先验证页面视觉和交互，再决定是否增加 React 与 `@excalidraw/excalidraw` 的依赖。

## User experience

- 文章正文中的图以与现有 Deep Value 视觉系统一致的边框卡片出现。
- 卡片包含“打开画布”提示，但静态预览本身可直接阅读。
- 查看层覆盖当前页面，显示关闭按钮、缩放比例、放大、缩小、适配视图和拖动区域。
- 键盘支持 `Escape` 关闭，按钮保留 44px 级别的触控目标。
- 移动端查看层不依赖固定宽度，画布按容器尺寸适配。

## Data flow

1. 从 Obsidian Excalidraw 文件导出可发布的静态图资源。
2. 将资源复制到仓库 `public/media/...` 下，资源文件名稳定且不依赖 OneDrive 路径。
3. 文章 Markdown 使用一个明确的画布嵌入标记或 Astro 组件调用 `CanvasDiagram`。
4. 构建时生成普通图片链接；浏览器端只负责打开和操作查看层。

## Error handling

- 静态资源不存在时，组件显示一个有边框的错误占位，不让正文布局崩溃。
- 交互脚本加载失败时，静态图片仍然可见。
- 资源地址只允许仓库内生成的绝对 public URL，不接受任意用户输入的外部 iframe。

## Testing

- 单元测试覆盖打开/关闭、缩放、拖动状态和 `Escape` 关闭行为。
- 构建测试确认 Astro 页面能生成并包含静态资源。
- 浏览器级手动检查桌面端和移动端：静态预览、查看层、按钮、滚轮/触控缩放和回退状态。
- 运行现有 `npm test` 与 `npm run build`，确认不影响现有文章。

## Future extension

验证通过后，再增加一个发布器阶段：把压缩 `compressed-json` 解码成标准 Excalidraw JSON，并在博客中用 Excalidraw 官方只读组件加载。该扩展不属于本次第一版范围。
