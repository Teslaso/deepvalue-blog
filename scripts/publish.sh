#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "用法: $0 <源Markdown路径> [--assets-dir 目录] [--slug 标识] [--date 日期]"
}

SOURCE=""
ASSETS_DIR=""
SLUG=""
DATE_OVERRIDE=""

while (("$#")); do
  case "$1" in
    --assets-dir)
      ASSETS_DIR="$2"; shift 2;;
    --slug)
      SLUG="$2"; shift 2;;
    --date)
      DATE_OVERRIDE="$2"; shift 2;;
    -h|--help)
      usage; exit 0;;
    *)
      if [ -z "$SOURCE" ]; then SOURCE="$1"; else echo "参数错误"; usage; exit 1; fi; shift;;
  esac
done

if [ -z "$SOURCE" ]; then usage; exit 1; fi
if [ ! -f "$SOURCE" ]; then echo "找不到源文件: $SOURCE"; exit 1; fi

ROOT_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
CONTENT_DIR="$ROOT_DIR/content/posts"
STATIC_DIR="$ROOT_DIR/static/images"

mkdir -p "$CONTENT_DIR"
mkdir -p "$STATIC_DIR"

BASENAME="$(basename "$SOURCE")"
NAME_NO_EXT="${BASENAME%.*}"
if [ -z "$SLUG" ]; then SLUG="$(echo "$NAME_NO_EXT" | tr ' ' '-' )"; fi

OUT_MD="$CONTENT_DIR/$SLUG.md"
OUT_IMG_DIR="$STATIC_DIR/$SLUG"
mkdir -p "$OUT_IMG_DIR"

LOCAL_TZ="$(date +%z)"
TZ_FMT="${LOCAL_TZ:0:3}:${LOCAL_TZ:3:2}"
NOW="$(date +%Y-%m-%dT%H:%M:%S)${TZ_FMT}"
DATE_VAL="${DATE_OVERRIDE:-$NOW}"

TMP_PROCESSED="$(mktemp)"
cp "$SOURCE" "$TMP_PROCESSED"

SRC_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"

IMAGES_TO_COPY=()

while IFS= read -r line; do
  IMG="${line#*[[}"
  IMG="${IMG%%]]*}"
  if [ -n "$IMG" ]; then IMAGES_TO_COPY+=("$IMG"); fi
done < <(grep -oE '!\[\[([^]]+)\]\]' "$TMP_PROCESSED" || true)

while IFS= read -r line; do
  PATH_IN="${line#*](}"
  PATH_IN="${PATH_IN%%)*}"
  if [[ "$PATH_IN" =~ ^https?:// ]]; then continue; fi
  if [[ "$PATH_IN" =~ ^/images/ ]]; then continue; fi
  FNAME="$(basename "$PATH_IN")"
  if [ -n "$FNAME" ]; then IMAGES_TO_COPY+=("$FNAME"); fi
done < <(grep -oE '!\[[^]]*\]\([^)]*\)' "$TMP_PROCESSED" || true)

UNIQ_IMAGES=$(printf "%s\n" "${IMAGES_TO_COPY[@]}" | awk 'NF' | sort -u)
printf "%s\n" "${IMAGES_TO_COPY[@]}" | awk 'NF' | sort -u | while IFS= read -r f; do
  SRC_CANDIDATES=("$SRC_DIR/$f")
  SRC_CANDIDATES+=("$SRC_DIR/assets/$f")
  SRC_CANDIDATES+=("$SRC_DIR/attachments/$f")
  # 检查 Obsidian 默认的 attachments 文件夹 (如果是相对根目录)
  SRC_CANDIDATES+=("$ROOT_DIR/assets/$f")
  SRC_CANDIDATES+=("$ROOT_DIR/attachments/$f")

  if [ -n "$ASSETS_DIR" ]; then SRC_CANDIDATES+=("$ASSETS_DIR/$f"); fi
  COPIED=false
  for cand in "${SRC_CANDIDATES[@]}"; do
    if [ -f "$cand" ]; then
      # Auto-sanitize filename: replace spaces with hyphens
      f_clean="${f// /-}"
      cp "$cand" "$OUT_IMG_DIR/$f_clean"
      COPIED=true
      break
    fi
  done
  if [ "$COPIED" = false ]; then
    echo "警告: 未找到图片 $f"
  fi
done

perl -0777 -pe "s/!\[\[(.*?)\]\]/ my \$f=\$1; \$f=~s! !-!g; \"![](\/images\/$SLUG\/\$f)\" /ge" "$TMP_PROCESSED" > "$TMP_PROCESSED.conv1"
perl -0777 -pe "s/!\[[^\]]*\]\((?!https?:|\/images\/)([^\)]+)\)/ my \$f=(split('\/', \$1))[-1]; \$f=~s! !-!g; sprintf('![](\/images\/%s\/%s)', '$SLUG', \$f) /ge" "$TMP_PROCESSED.conv1" > "$TMP_PROCESSED.conv2"

TITLE_LINE="$(awk '/^# /{sub(/^# /, ""); print; exit}' "$TMP_PROCESSED.conv2")"
TITLE_VAL="${TITLE_LINE:-$NAME_NO_EXT}"

if head -n1 "$TMP_PROCESSED.conv2" | grep -q '^---'; then
  FRONT="$(awk '/^---/ {print; getline; while (!/^---/) {print; getline}; print}' "$TMP_PROCESSED.conv2")"
  BODY="$(awk 'NR==1 && /^---/ {print; getline; while (!/^---/) {print; getline}; print; next} {print}' "$TMP_PROCESSED.conv2" | sed '1,/^---$/d')"
  echo "---" > "$OUT_MD.tmp"
  echo "title: \"$TITLE_VAL\"" >> "$OUT_MD.tmp"
  if echo "$FRONT" | grep -q '^date:'; then
    echo "$FRONT" | grep '^date:' >> "$OUT_MD.tmp"
  else
    echo "date: $DATE_VAL" >> "$OUT_MD.tmp"
  fi
  echo "---" >> "$OUT_MD.tmp"
  echo "$BODY" >> "$OUT_MD.tmp"
else
  {
    echo "---"
    echo "title: \"$TITLE_VAL\""
    echo "date: $DATE_VAL"
    echo "---"
    cat "$TMP_PROCESSED.conv2"
  } > "$OUT_MD.tmp"
fi

mv "$OUT_MD.tmp" "$OUT_MD"
rm -f "$TMP_PROCESSED" "$TMP_PROCESSED.conv1" "$TMP_PROCESSED.conv2"

echo "已生成: $OUT_MD"
echo "图片目录: $OUT_IMG_DIR"
