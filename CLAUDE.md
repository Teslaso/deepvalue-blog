# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 提供在此代码库中工作的指导。

## 项目概述

DEEP VALUE 是一个基于 Hugo 的个人博客，专注于投资分析、人工智能和分析思维。内容主要为中文，使用 Hugo Book 主题实现文档式布局。

## 关键命令

### 开发
```bash
# 运行 Hugo 开发服务器
hugo server -D

# 构建静态站点
hugo

# 发布新文章（从 Obsidian 或 markdown 源文件）
./scripts/publish.sh <markdown文件路径> [--slug <自定义别名>] [--date <YYYY-MM-DD>]

# 快速 git 同步（添加、提交、推送）
./scripts/sync.sh "提交信息"
```

### 内容管理
`scripts/publish.sh` 脚本处理完整的发布工作流：
- 转换 wiki 链接（`![[image.png]]`）为标准 markdown
- 复制图片到 `static/images/<slug>/`
- 自动生成 URL 友好的别名（空格 → 连字符）
- 添加/更新 Hugo 前置元数据（标题、日期）
- 通过命令行选项支持自定义别名和日期

## 架构

### 内容结构
- `content/posts/` - 带有 YAML 前置元数据的 markdown 博客文章
- `static/images/` - 按文章别名组织的图片
- 内容工作流：Obsidian → `publish.sh` → Hugo → 静态站点

### 发布工作流
1. 在 Obsidian 中编写内容（支持 wiki 链接图片）
2. 运行 `publish.sh` 处理并移动到 Hugo 内容目录
3. 自动复制图片并重写链接
4. Hugo 从处理后的 markdown 构建静态站点

### 关键配置
- `hugo.toml` - Hugo 主配置
- 主题：Hugo Book（`themes/book/`）
- 基础 URL：https://deepvalue.space/
- 默认语言：en-us（内容主要为中文）

## 重要说明

- 博客使用中文内容，英文配置
- 图片可使用 wiki 链接（`![[image.png]]`）或标准 markdown
- `publish.sh` 脚本自动清理文件名（替换空格为连字符）
- 通过 `sync.sh` 简化 Git 工作流，实现快速提交

## 文章分类功能

博客已配置分类系统：
- **categories**: 文章分类，如 ["投资分析", "行业研究"]
- **tags**: 文章标签，如 ["化工", "资本周期", "估值"]

在文章前置元数据中添加：
```yaml
---
title: "文章标题"
date: 2024-01-01T00:00:00+08:00
categories: ["分类1", "分类2"]
tags: ["标签1", "标签2", "标签3"]
---
```

分类页面会自动生成在：
- `/categories/` - 所有分类列表
- `/categories/分类名/` - 特定分类下的文章列表
- `/tags/` - 所有标签列表
- `/tags/标签名/` - 特定标签下的文章列表

## 搜索功能

博客已启用全文搜索功能：

1. **搜索框位置**：页面顶部导航栏有搜索输入框
   - 快捷键：按 `s` 键可快速聚焦搜索框
   - 支持实时搜索，输入即显示结果

2. **独立搜索页面**：访问 `/search/` 获取完整搜索体验
   - 显示搜索匹配度分数
   - 显示文章分类和标签
   - 支持搜索摘要预览

3. **搜索配置**：在 `hugo.toml` 中可调整搜索参数
   - `BookSearch = true` - 启用搜索
   - `BookSearchConfig` - 搜索算法配置（阈值、权重等）

搜索功能基于 Fuse.js 实现，支持模糊匹配和权重排序。

## 页面导航

### About Me 页面
- 访问路径：`/about/`
- 包含个人简介、投资理念、专业领域等信息
- 在主导航菜单中显示（权重设置为10）