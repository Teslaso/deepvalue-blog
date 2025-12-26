---
title: "分类"
---

# 所有分类

{{ range $name, $items := .Site.Taxonomies.categories }}
<div class="taxonomy-item">
  <a href="{{ relURL (printf "/categories/%s" ($name | urlize)) }}">{{ $name }}</a>
  <span class="count">({{ len $items }})</span>
</div>
{{ end }}
