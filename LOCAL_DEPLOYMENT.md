# AI 故事分镜视频生成器 - 本机部署说明

## 当前访问地址

- 本机地址：http://localhost:5001/

## 当前部署位置

- 源码目录：`/Users/zhangyunbi/Documents/Codex/2026-05-27/new-chat/projects`
- 运行目录：`/Users/zhangyunbi/.codex/deployments/storyboard-app`
- 自启动服务：`com.codex.storyboard-next`
- 服务配置：`/Users/zhangyunbi/Library/LaunchAgents/com.codex.storyboard-next.plist`

## 日常使用

双击桌面的 `打开AI故事分镜视频生成器.command`，它会自动启动服务并打开网页。

## 服务管理

查看服务状态：

```bash
launchctl print gui/$(id -u)/com.codex.storyboard-next
```

重启服务：

```bash
launchctl kickstart -k gui/$(id -u)/com.codex.storyboard-next
```

查看网页是否正常：

```bash
curl -I http://localhost:5001/
```

## 重新部署源码

在源码目录执行：

```bash
corepack pnpm ts-check
corepack pnpm build
rsync -a --delete \
  --exclude 'assets/' \
  --exclude 'node_modules/' \
  --exclude '.env.local' \
  --exclude 'scripts/production-server.sh' \
  --exclude 'storyboard-next.out.log' \
  --exclude 'storyboard-next.err.log' \
  /Users/zhangyunbi/Documents/Codex/2026-05-27/new-chat/projects/ \
  /Users/zhangyunbi/.codex/deployments/storyboard-app/
launchctl kickstart -k gui/$(id -u)/com.codex.storyboard-next
```

## 数据位置

项目生成的资产和页面状态保存在运行目录的 `assets/` 下。重新部署时不要删除这个目录。
