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

## 价格与扣费

本地价格表用于提交前预估和冻结额度，单位是“元/秒”。任务完成后仍以 Manfei
`/v1/usage` 返回的实际扣费为准，多冻结的额度会退回。

当前默认预估价按近期真实扣费做了保守校准：

- `mini-manfei-new`：480p `0.10 元/秒`，720p `0.13 元/秒`
- `moon-manfei-new`：480p `0.35 元/秒`，720p `0.55 元/秒`
- `star-manfei-new`：480p `0.75 元/秒`，720p `0.90 元/秒`
- `sun-manfei-new`：480p `0.50 元/秒`，720p `1.05 元/秒`，1080p `1.50 元/秒`，4k `2.20 元/秒`

如果 Manfei 实际价格变化，超级管理员可在后台点击“同步实际价格”，系统会按已匹配到本地任务的真实扣款记录重新折算每秒价格。

## 只读自检

部署后可以执行只读自检，不会提交生成任务，也不会扣费：

```bash
MANFEI_SMOKE_BASE=http://115.190.161.145 npm run smoke:readonly
```

自检会检查首页模型、`star-manfei-new` 30 秒上限、分辨率规则、登录、模型能力接口和价格表覆盖情况。

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

## 火山引擎 ECS 部署

推荐使用北京地域、Ubuntu 22.04、2 核 4GB、40GB 系统盘，并分配弹性公网 IP。
安全组至少放行 TCP `22`（仅管理 IP）和 TCP `80`（用户访问）。

当前公网机器使用 `manfei-seedance.service` 运行 Node 服务，不使用 Docker。不要用
`docker compose up` 更新这台机器，避免误判服务状态。

首次登录服务器后执行：

```bash
git clone https://github.com/zyb-png/SYXturbo-fish-stick.git /opt/manfei-seedance
sh /opt/manfei-seedance/deploy/volcengine/setup.sh
```

脚本会安装 Node 运行环境、创建 `/opt/manfei-seedance/.env` 并停止等待。填写环境变量后再次执行：

```bash
sh /opt/manfei-seedance/deploy/volcengine/setup.sh
```

如果服务器能稳定访问 GitHub，以后更新原地址：

```bash
cd /opt/manfei-seedance
git pull --ff-only
systemctl restart manfei-seedance.service
```

如果服务器访问 GitHub 不稳定，推荐使用“本地打包上传”：

```bash
git archive --format=tar.gz -o /tmp/manfei-seedance.tar.gz HEAD
```

把 `/tmp/manfei-seedance.tar.gz` 上传到服务器后执行：

```bash
sh /opt/manfei-seedance/deploy/volcengine/release-from-archive.sh /tmp/manfei-seedance.tar.gz
```

数据库、资源组和上传记录保存在 `/opt/manfei-seedance/data`，更新代码不会删除。

## 资源库持久化

资源组和素材会同时保存到浏览器 `localStorage` 与服务端 `.data/app-state.json`。
刷新、浏览器闪退或 Node 服务重启后，页面会自动从服务端恢复。云部署时可通过
`APP_STATE_FILE` 将数据文件指向平台的持久化磁盘。
