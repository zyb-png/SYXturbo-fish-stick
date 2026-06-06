# 漫飞 Seedance 视频生成网页

本地网页 + 本地 Node 代理，接入 `manfei-new` 视频生成 API。

## 运行

```bash
node server.mjs
```

打开：

```text
http://localhost:4177
```

## 配置

`.env` 中配置：

```text
MANFEI_API_BASE=http://115.191.42.226:8001
MANFEI_API_TOKEN=你的 Token
PORT=4177
APP_USERNAME=manfei
APP_PASSWORD=公网访问密码

TOS_ACCESS_KEY_ID=你的 AK
TOS_SECRET_ACCESS_KEY=你的 SK
TOS_REGION=cn-beijing
TOS_ENDPOINT=tos-cn-beijing.volces.com
TOS_BUCKET=你的存储桶
TOS_UPLOAD_PREFIX=manfei-assets
TOS_SIGNED_URL_EXPIRES=604800
```

## 底层流程

1. 前端收集提示词、模型、分辨率、比例、时长和参考素材。
2. 按 API 文档组装 `content` 数组。
3. 异步模式调用 `POST /v1/video/tasks`，拿到任务 ID 后轮询。
4. 同步模式调用 `POST /v1/video/tasks:generate`。
5. 轮询使用 `GET /v1/video/tasks/{task_id}`，成功后读取 `content.video_url`。
6. 所有真实 API 请求由 `server.mjs` 代理，避免浏览器 CORS 问题。

## 本地素材上传

拖入本地文件后的自动流程：

1. 浏览器把文件交给本地代理。
2. 本地代理使用火山引擎 TOS Node SDK 上传文件。
3. 服务端生成 TOS 预签名 GET URL。
4. 页面调用 `POST /v1/assets` 创建 `asset_id`。
5. 页面自动把 `asset://asset_id` 加入本次生成素材和资源库。

## 公网部署

项目包含 Node API 代理，不能部署到纯静态托管。仓库内提供：

- `Dockerfile`：适用于支持 Docker 的云平台
- `render.yaml`：适用于 Render Blueprint
- `/healthz`：部署平台健康检查
- `APP_USERNAME` / `APP_PASSWORD`：公网访问保护

不要把 `.env` 提交到 Git 仓库；生产密钥应填写到托管平台的环境变量。

## 资源库持久化

资源组和素材会同时保存到浏览器 `localStorage` 与服务端 `.data/app-state.json`。
刷新、浏览器闪退或 Node 服务重启后，页面会自动从服务端恢复。云部署时可通过
`APP_STATE_FILE` 将数据文件指向平台的持久化磁盘。
