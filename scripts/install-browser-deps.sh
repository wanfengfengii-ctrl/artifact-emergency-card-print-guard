#!/usr/bin/env bash
# 准备 Playwright 浏览器及其系统依赖。
#
# 常规环境（有 root / sudo）：
#   npx playwright install --with-deps chromium 即可，本脚本无需运行。
#
# 无 root 的 Linux 环境（如受限容器）：
#   本脚本把浏览器下载到用户缓存，并用 apt-get download + dpkg-deb -x
#   把缺失的共享库解压到项目 .local-libs/（不入库）；
#   playwright.config.ts 检测到该目录后会把其中的库目录注入浏览器进程的
#   LD_LIBRARY_PATH，不影响已装好系统依赖的环境。
set -euo pipefail
cd "$(dirname "$0")/.."

LOCAL_LIBS=".local-libs"

echo "==> 下载 Chromium（用户缓存，无需 root）"
npx playwright install chromium

# 找出 headless shell 可执行文件，检查缺失共享库。
SHELL_BIN="$(find "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" \
  -name 'chrome-headless-shell' -type f 2>/dev/null | head -1)"
if [ -z "$SHELL_BIN" ]; then
  echo "未找到 chrome-headless-shell，跳过系统库检查。"
  exit 0
fi

MISSING="$(ldd "$SHELL_BIN" 2>/dev/null | awk '/not found/ {print $1}' | sort -u)"
if [ -z "$MISSING" ]; then
  echo "==> 系统依赖完整，无需本地库。"
  exit 0
fi
echo "==> 缺失共享库："
echo "$MISSING"

if [ "$(id -u)" = "0" ]; then
  echo "==> 当前为 root，改用 playwright install-deps 安装系统依赖。"
  npx playwright install-deps chromium
  exit 0
fi

# Debian/Ubuntu 包名映射（覆盖 chromium headless shell 的常见依赖）。
PACKAGES="libnspr4 libnss3 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
libasound2 libatk1.0-0 libatspi2.0-0 libdbus-1-3 libgbm1 libxkbcommon0 \
libdrm2 libwayland-server0 libxi6 libxext6 libx11-6 libxcb1"

echo "==> 无 root：用 apt-get download 下载依赖并解压到 $LOCAL_LIBS/"
APT_LISTS="$(mktemp -d)/lists"
APT_CACHE="$(mktemp -d)/cache"
mkdir -p "$APT_LISTS/partial" "$APT_CACHE/archives/partial"
apt-get -o Dir::State::Lists="$APT_LISTS" -o Dir::Cache="$APT_CACHE" update

DEB_DIR="$(mktemp -d)"
(
  cd "$DEB_DIR"
  # shellcheck disable=SC2086
  apt-get -o Dir::State::Lists="$APT_LISTS" -o Dir::Cache="$APT_CACHE" download $PACKAGES
)
mkdir -p "$LOCAL_LIBS"
for deb in "$DEB_DIR"/*.deb; do
  dpkg-deb -x "$deb" "$LOCAL_LIBS"
done

REMAINING="$(LD_LIBRARY_PATH="$(find "$LOCAL_LIBS" -type d -name '*linux-gnu' | tr '\n' ':')" \
  ldd "$SHELL_BIN" 2>/dev/null | awk '/not found/ {print $1}' | sort -u)"
if [ -n "$REMAINING" ]; then
  echo "警告：仍有未解析的库：" >&2
  echo "$REMAINING" >&2
  exit 1
fi
echo "==> 完成：本地库已就绪，运行 npm run test:e2e 即可。"
