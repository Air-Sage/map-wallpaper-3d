#!/bin/sh
# 把这个站点发布到 GitHub Pages：https://air-sage.github.io/map-wallpaper-3d/
# （仓库 Air-Sage/map-wallpaper-3d，main 分支，站点就是仓库根目录）。
# 提交所有改动并推送。需要 macOS 钥匙串（在 Claude Code 的 Bash 沙盒外运行）。
set -e
cd "$(dirname "$0")"
GH="${GH:-$HOME/.local/bin/gh}"
# Xcode 许可协议没同意时 /usr/bin/git 不能用，改用命令行工具自带的 git
git --version >/dev/null 2>&1 || export DEVELOPER_DIR=/Library/Developer/CommandLineTools
touch .nojekyll
git add -A
if git diff --cached --quiet; then echo "deploy: nothing changed, nothing to publish"; exit 0; fi
git commit -q -m "Update site ($(date '+%Y-%m-%d %H:%M'))

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
git -c credential.helper= -c credential.helper="!$GH auth git-credential" push -q origin main
echo "deploy: pushed $(git rev-parse --short HEAD); GitHub Pages updates in about a minute"
echo "        https://air-sage.github.io/map-wallpaper-3d/"
