#!/usr/bin/env bash
#
# setup-test-env.sh
# ─────────────────────────────────────────────────────────────────────────
# 一键安装 SimpleTextReader「全部测试环境依赖」。
#
# 覆盖范围（与 test/ 套件失败直接对应）：
#   1. Node 运行时依赖（根 node_modules / devDependencies）：
#         jszip, jschardet, vite, @xmldom/xmldom, linkedom,
#         opencc-js, typescript, @types/jquery
#      ── 缺失会导致 test-preprocess-books 报
#         ERR_MODULE_NOT_FOUND: 'jszip' 等。
#   2. 系统依赖 python3：
#      ── test-preprocess-books 中的 EPUB 用例用 python3 标准库 zipfile
#         构造测试样本；缺失时该用例被「跳过」（非失败），装上后才会真正执行。
#      ── 仅需标准库，无需 pip 包。
#   3. 生成 dist/ 产物（--with-build）：
#      ── test-build-integration 需要 `pnpm/npm run build` 产出 dist/。
#
# 说明：docker / buildx（build-tools/build.py 用来打镜像）属于发布/打包
# 环境，非 test 套件所需，且需特权与较大下载，本脚本不安装。
#
# 用法：
#   ./setup-test-env.sh                 # 安装全部依赖（node + python3）
#   ./setup-test-env.sh --with-build    # 额外执行 build 生成 dist/（让 build-integration 通过）
#   USE_PNPM=1 ./setup-test-env.sh --with-build   # 用 pnpm 而非 npm
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

USE_PNPM="${USE_PNPM:-0}"
WITH_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --with-build) WITH_BUILD=1 ;;
    --use-pnpm)  USE_PNPM=1 ;;
  esac
done

# ── 1. 系统依赖 ──────────────────────────────────────────────────────────
echo "==> [1/4] 系统依赖：python3"
if command -v python3 >/dev/null 2>&1; then
  echo "    ✓ python3 已存在 ($(python3 --version 2>&1))"
else
  echo "    python3 未安装，尝试用系统包管理器安装 ..."
  # 无 sudo 时（如容器内已是 root）直接用包管理器；否则加 sudo。
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else SUDO=""; fi
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update -y
    $SUDO apt-get install -y python3
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y python3
  elif command -v yum >/dev/null 2>&1; then
    $SUDO yum install -y python3
  elif command -v apk >/dev/null 2>&1; then
    $SUDO apk add --no-cache python3
  elif command -v brew >/dev/null 2>&1; then
    brew install python3
  else
    echo "    ✗ 无法识别的包管理器，请手动安装 python3（标准库即可）" >&2
    exit 1
  fi
  echo "    ✓ python3 安装完成 ($(python3 --version 2>&1))"
fi

# ── 2. Node 包管理器探活 ─────────────────────────────────────────────────
echo "==> [2/4] 探测 Node 工具链"
echo "    node: $(node -v 2>&1)"
echo "    npm:  $(npm -v 2>&1)"
if [ "$USE_PNPM" = "1" ]; then
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "    pnpm 未安装，正在安装 ..."
    npm install -g pnpm
  fi
  echo "    pnpm: $(pnpm -v 2>&1)"
fi

# ── 3. 安装根 Node 依赖 ───────────────────────────────────────────────────
echo "==> [3/4] 安装根依赖 (devDependencies)"
if [ "$USE_PNPM" = "1" ]; then
  pnpm install
else
  npm install --no-audit --no-fund
fi

echo "    校验关键依赖 ..."
for pkg in jszip vite; do
  if [ -d "node_modules/$pkg" ]; then
    echo "    ✓ $pkg"
  else
    echo "    ✗ $pkg 未安装，请检查 package.json devDependencies" >&2
    exit 1
  fi
done

# ── 4. 可选：构建生成 dist/ ──────────────────────────────────────────────
if [ "$WITH_BUILD" = "1" ]; then
  echo "==> [4/4] 执行构建生成 dist/（test-build-integration 需要）"
  if [ "$USE_PNPM" = "1" ]; then
    pnpm run build
  else
    npm run build
  fi
  if [ -d "dist" ]; then
    echo "    ✓ dist/ 已生成"
  else
    echo "    ✗ dist/ 生成失败" >&2
    exit 1
  fi
else
  echo "==> [4/4] 跳过构建（如需 test-build-integration 通过，加 --with-build）"
fi

echo ""
echo "完成。环境依赖已就绪："
echo "  - Node 依赖 (node_modules): jszip/jschardet/vite/linkedom/...   ✓"
echo "  - 系统依赖 python3: $(python3 --version 2>&1)   ✓"
echo ""
echo "运行全部测试："
echo "  npm test"
echo "  # 或单独：node test/test-preprocess-books.mjs && node test/test-build-integration.mjs"
