# 项目背景：DEEP VALUE 博客

## 概述
这是一个基于 Hugo 的静态网站项目，名为 "DEEP VALUE"，用作个人博客。它利用 `hugo-book` 主题以简洁、文档风格的格式展示内容。该项目包含自定义的 shell 脚本，以简化从内容创建（可能在 Obsidian 等工具中）到发布的整个工作流程。

## 架构与技术
- **静态站点生成器:** [Hugo](https://gohugo.io/)
- **主题:** [hugo-book](https://github.com/alex-shpak/hugo-book) (`hugo.toml` 中已配置)
  - 注意: `themes/` 目录下也存在 `PaperMod`，但当前激活的是 `book` 主题。
- **配置:** `hugo.toml`
- **内容:** 位于 `content/` 目录下的 Markdown 文件

## 关键目录
- `content/posts/`: 包含主要的博客文章。
- `scripts/`: 用于内容管理和部署的自定义工具脚本。
- `static/images/`: 存储静态资源，特别是文章中引用的图片。
- `themes/book/`: 当前使用的 Hugo 主题。
- `public/`: 生成的静态站点（运行 `hugo` 后创建）。

## 开发工作流程

### 1. 本地构建与运行
要在本地预览站点，请运行标准的 Hugo 服务器命令：
```bash
hugo server
```
这通常会在 `http://localhost:1313` 上托管站点。

### 2. 发布内容
该项目使用自定义脚本来处理 Markdown 文件（可能来自 Obsidian 等外部编辑器）。

**命令:**
```bash
bash scripts/publish.sh <源Markdown文件> [--assets-dir <图片路径>] [--slug <自定义短链接>] [--date <日期覆盖>]
```

**`publish.sh` 的作用:**
- 将源 Markdown 文件复制到 `content/posts/`。
- 生成一个适合 URL 的短链接（如果未提供则自动生成）。
- 提取 Markdown 中引用的图片（支持 `![[]]` wiki-链接和标准 Markdown 链接）。
- 将这些图片复制到 `static/images/<短链接>/`。
- 重写文章中的图片链接，使其指向正确的静态路径。
- 添加或标准化 Hugo 的 Frontmatter（标题、日期）。

### 3. 同步更改
提交并推送更改到 Git 仓库：

**命令:**
```bash
bash scripts/sync.sh [提交信息]
```
如果未提供提交信息，则默认为带时间戳的 "sync" 信息。

## 约定
- **Frontmatter:** 文章使用 YAML Frontmatter，至少包含 `title` 和 `date`。
- **图片处理:** 图片应通过 `publish.sh` 脚本进行管理，以确保它们被放置在正确的 `static/images/<短链接>` 文件夹中并正确链接。
- **语言:** 站点配置为 `en-us`，但包含中文内容。