# 宋钰汐 AI 故事分镜视频生成器

从脚本分析、文字分镜、角色与场景素材，到故事板图片和视频生成的一站式工作台。

## 本地运行

需要 Node.js 22 和 pnpm 9。

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

默认开发端口为 `5000`。生产构建：

```bash
pnpm ts-check
pnpm build
PORT=5001 pnpm start
```

## 生产数据

以下内容不会提交到 GitHub：

- `.env.local`：服务端 API 密钥
- `assets/`：图片、视频和项目状态
- `assets-config.json`：运行环境的资产目录配置
- `public/assets/`：本地历史素材
- `runtime/`：打包应用的本地运行时

生产环境需要自行创建 `assets-config.json`：

```json
{
  "assetsPath": "assets",
  "folders": {
    "scenes": "场景图片",
    "characters": "人物图片",
    "props": "道具图片",
    "storyboards": "分镜图片",
    "videos": "视频文件"
  }
}
```

公网部署应在应用前配置登录保护与 HTTPS，不要将真实密钥写入仓库。
