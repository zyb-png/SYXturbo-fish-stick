# 环境变量配置指南

本文档说明如何为项目配置环境变量，确保安全地管理 API Key 和其他敏感配置。

## 快速开始

### 1. 创建配置文件

复制 `.env.example` 文件为 `.env.local`：

```bash
# macOS / Linux
cp .env.example .env.local

# Windows PowerShell
Copy-Item .env.example .env.local
```

### 2. 配置 API Key

编辑 `.env.local` 文件，填入您的 API Key：

```bash
# .env.local
ARK_API_KEY=your-actual-api-key-here
RUNNINGHUB_API_KEY=your-runninghub-api-key-here
```

### 3. 重启开发服务器

配置完成后，重启开发服务器使环境变量生效：

```bash
# 停止当前服务（Ctrl+C）
# 然后重新启动
pnpm dev
```

## 详细配置说明

### ARK_API_KEY（必需）

**用途**: Seedance 2.0 视频生成和视频编辑功能

**获取方式**:
1. 访问 [方舟控制台](https://console.volcengine.com/ark/)
2. 登录您的账户
3. 进入"API Key 管理"
4. 创建新的 API Key 或使用现有的 Key

**注意事项**:
- ⚠️ API Key 是敏感信息，请妥善保管
- ⚠️ 不要将 API Key 提交到 Git 或分享给他人
- ⚠️ 定期轮换 API Key 以提高安全性
- ⚠️ 为不同环境使用不同的 API Key

### RUNNINGHUB_API_KEY（必需）

**用途**: RunningHub Namo Banana Pro 图片生成

**获取方式**:
1. 访问 [RunningHub 官网](https://www.runninghub.cn)
2. 注册并登录账户
3. 充值钱包
4. 创建企业级共享 API Key

**注意事项**:
- ⚠️ API Key 是敏感信息，请妥善保管
- ⚠️ RunningHub 使用企业级共享 API Key
- ⚠️ 请确保账户余额充足
- ⚠️ 生成的图片 URL 有效期仅 24 小时，系统会自动转存到对象存储

### COZE_BUCKET_ENDPOINT_URL 和 COZE_BUCKET_NAME（自动配置）

**用途**: 对象存储配置，用于存储生成的图片和视频

**说明**: 这些配置通常由系统自动设置，您无需手动配置。

## 验证配置

### 方法 1: 检查环境变量是否加载

在代码中，环境变量通过 `process.env` 访问：

```typescript
// 检查 API Key 是否配置
const apiKey = process.env.ARK_API_KEY;
if (!apiKey) {
  console.error('未配置 ARK_API_KEY 环境变量');
}
```

### 方法 2: 测试 API 调用

尝试调用需要 API Key 的接口，例如视频生成：

```bash
# 如果 API Key 未配置，会返回错误
curl -X POST http://localhost:5000/api/video-edit \
  -H "Content-Type: application/json" \
  -d '{"prompt":"test"}'
```

## 常见问题

### Q1: 环境变量未生效怎么办？

**A**: 请确保：
1. ✅ 已正确配置 `.env.local` 文件
2. ✅ 已重启开发服务器（`pnpm dev`）
3. ✅ `.env.local` 文件在项目根目录
4. ✅ 环境变量名称正确（区分大小写）

### Q2: 如何在部署环境中配置环境变量？

**A**: 部署方式不同，配置方式也不同：

**Vercel**:
1. 进入项目设置
2. 找到 "Environment Variables"
3. 添加 `ARK_API_KEY` 和对应的值
4. 重新部署

**Docker**:
```dockerfile
# Dockerfile
ENV ARK_API_KEY=your-api-key-here
```

或在 `docker-compose.yml` 中：
```yaml
environment:
  - ARK_API_KEY=your-api-key-here
```

**其他平台**: 查看平台文档中的环境变量配置说明。

### Q3: 可以使用其他环境变量文件吗？

**A**: Next.js 支持以下环境变量文件（按优先级排序）：

1. `.env.local` - 本地开发（优先级最高）
2. `.env.development.local` - 开发环境
3. `.env.production.local` - 生产环境
4. `.env.test.local` - 测试环境

**建议**:
- 本地开发使用 `.env.local`
- 不同环境使用不同的配置文件

### Q4: 如何在代码中访问环境变量？

**A**: 使用 `process.env`：

```typescript
// 客户端组件（需要在 .env.local 中添加 NEXT_PUBLIC_ 前缀）
const apiKey = process.env.NEXT_PUBLIC_ARK_API_KEY;

// 服务端组件或 API 路由
const apiKey = process.env.ARK_API_KEY;
```

**注意**:
- 只有以 `NEXT_PUBLIC_` 开头的环境变量可以在客户端访问
- 其他环境变量只能在服务端访问

### Q5: 如何保护环境变量安全？

**A**: 遵循以下最佳实践：

✅ **应该做的**:
- 将 `.env.local` 添加到 `.gitignore`
- 定期轮换 API Key
- 使用不同的 API Key 用于不同环境
- 限制 API Key 的权限范围
- 监控 API Key 的使用情况

❌ **不应该做的**:
- 在代码中硬编码密钥
- 将 `.env.local` 提交到 Git
- 在公开的代码仓库中包含密钥
- 在客户端代码中暴露敏感密钥
- 将密钥分享给他人

## 操作系统特定配置

### macOS / Linux

#### 使用 Zsh（推荐）

```bash
# 临时设置（当前会话）
export ARK_API_KEY="your-api-key-here"

# 永久设置（推荐）
echo 'export ARK_API_KEY="your-api-key-here"' >> ~/.zshenv
source ~/.zshenv

# 验证
echo $ARK_API_KEY
```

#### 使用 Bash

```bash
# 临时设置（当前会话）
export ARK_API_KEY="your-api-key-here"

# 永久设置
echo 'export ARK_API_KEY="your-api-key-here"' >> ~/.bash_profile
source ~/.bash_profile

# 验证
echo $ARK_API_KEY
```

### Windows

#### 使用 PowerShell

```powershell
# 临时设置（当前会话）
$env:ARK_API_KEY="your-api-key-here"

# 永久设置（用户变量）
[Environment]::SetEnvironmentVariable("ARK_API_KEY", "your-api-key-here", "User")

# 永久设置（系统变量，需要管理员权限）
[Environment]::SetEnvironmentVariable("ARK_API_KEY", "your-api-key-here", "Machine")

# 验证
echo $env:ARK_API_KEY
```

#### 使用 CMD

```cmd
# 临时设置（当前会话）
set ARK_API_KEY=your-api-key-here

# 永久设置（用户变量）
setx ARK_API_KEY "your-api-key-here"

# 永久设置（系统变量，需要管理员权限）
setx ARK_API_KEY "your-api-key-here" /m

# 验证
echo %ARK_API_KEY%
```

#### 使用 GUI

1. 在开始菜单搜索"编辑系统环境变量"
2. 点击"环境变量..."按钮
3. 在"用户变量"部分，点击"新建..."
4. 输入变量名：`ARK_API_KEY`
5. 输入变量值：您的 API Key
6. 点击"确定"保存

## 安全建议

### 1. 使用不同的 API Key

为不同的环境使用不同的 API Key：

```
开发环境: ARK_API_KEY_DEV
测试环境: ARK_API_KEY_TEST
生产环境: ARK_API_KEY_PROD
```

### 2. 定期轮换 API Key

建议每 3-6 个月更换一次 API Key。

### 3. 限制 API Key 权限

为 API Key 设置最小必要权限：
- 只授予需要的模型访问权限
- 限制调用频率
- 设置预算限制

### 4. 监控 API 使用

定期检查 API 使用情况：
- 异常调用频率
- 意外的资源消耗
- 可疑的访问模式

## 参考资料

- [Next.js 环境变量文档](https://nextjs.org/docs/basic-features/environment-variables)
- [方舟控制台](https://console.volcengine.com/ark/)
- [环境变量最佳实践](https://12factor.net/config)

## 获取帮助

如果您在配置环境变量时遇到问题：

1. 📖 查阅本文档的常见问题部分
2. 🔍 检查日志文件是否有错误信息
3. 💬 联系技术支持

---

**最后更新**: 2026年4月
