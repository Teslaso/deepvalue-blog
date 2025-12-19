#!/bin/bash

# 测试分类配置是否正确

echo "=== Hugo 分类配置测试 ==="
echo

# 检查 hugo.toml 中的分类配置
echo "1. 检查 hugo.toml 中的分类配置："
grep -A 3 "\[taxonomies\]" hugo.toml || echo "未找到 taxonomies 配置"
echo

# 检查文章中的前置元数据
echo "2. 检查文章中的分类信息："
for file in content/posts/*.md; do
    echo "文件: $file"
    grep -E "^(categories|tags):" "$file" | head -5
done
echo

# 显示目录结构
echo "3. 内容目录结构："
find content -type f -name "*.md" | sort
echo

echo "=== 测试完成 ==="
echo "注意：需要在安装 Hugo 后运行 'hugo server -D' 来实际测试分类页面"