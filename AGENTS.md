# 项目文档

本项目是一个基于 Next.js 的 AI 故事分镜视频生成应用。

## 项目概览

### 技术栈
- **框架**: Next.js 16 (App Router)
- **语言**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **样式**: Tailwind CSS 4
- **状态管理**: React Hooks + 持久化存储
- **Toast 通知**: Sonner

### 核心功能
1. **故事提取**: 从文本文件提取大纲、场景、人物、道具
2. **分镜生成**: AI 自动生成分镜内容
3. **素材管理**: 场景、人物、道具图片管理
4. **视频生成**: 使用 Seedance 2.0 生成视频
5. **视频编辑**: 支持参考图片和视频的编辑功能

## 环境变量配置

⚠️ **重要**: 配置环境变量是使用项目的必要步骤。

### 快速配置

1. 复制环境变量模板：
```bash
cp .env.example .env.local
```

2. 编辑 `.env.local`，填入您的 API Key：
```bash
OPENAI_API_KEY=your-openai-api-key-here       # GPT-5 文本分析 (mobaohee.xyz)
XSZY_API_KEY=your-xszy-api-key-here           # Seedance 2.0 视频生成 (xszy.top)
RUNNINGHUB_API_KEY=your-runninghub-api-key-here # 图片生成 (runninghub.cn)
```

3. 重启开发服务器：
```bash
pnpm dev
```

### 详细配置

请参阅 [环境变量配置指南](ENV_SETUP.md) 获取详细的配置说明。

## 项目结构

```
workspace/projects/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── api/                 # API 路由
│   │   │   ├── generate-video/  # 视频生成 API（Seedance 2.0）
│   │   │   ├── regenerate-video/# 视频重生成 API
│   │   │   ├── video-edit/      # 视频编辑 API
│   │   │   ├── generate-asset-image/ # 素材图片生成
│   │   │   ├── extract-characters/ # 人物提取
│   │   │   └── ...
│   │   └── page.tsx            # 主页面
│   ├── components/              # React 组件
│   │   ├── ui/                 # shadcn/ui 组件
│   │   ├── storage-monitor.tsx # 存储空间监控
│   │   ├── token-usage-stats.tsx # Token 统计
│   │   └── ...
│   ├── hooks/                   # 自定义 Hooks
│   │   ├── usePersistentState.ts # 状态持久化
│   │   └── ...
│   └── lib/                     # 工具函数
├── public/                     # 静态资源
├── .env.local                  # 环境变量（本地，不提交）
├── .env.example                # 环境变量模板
├── package.json                # 依赖配置
├── tsconfig.json               # TypeScript 配置
└── tailwind.config.ts          # Tailwind CSS 配置
```

## 常用命令

### 开发
```bash
pnpm dev              # 启动开发服务器（端口 5000）
```

### 构建
```bash
pnpm build            # 构建生产版本
```

### 代码检查
```bash
pnpm lint             # 代码风格检查
pnpm ts-check         # TypeScript 类型检查
```

## 代码规范

### 风格指南
- 使用 **Airbnb JavaScript Style Guide**
- 使用 **ESLint** 进行代码检查
- 使用 **Prettier** 进行代码格式化

### 命名规范
- 组件：PascalCase（如 `StorageMonitor`）
- 函数：camelCase（如 `handleClearStorage`）
- 常量：UPPER_SNAKE_CASE（如 `STORAGE_KEYS`）
- 文件名：kebab-case（如 `storage-monitor.tsx`）

### 注释规范
- 使用 JSDoc 格式的函数注释
- 复杂逻辑添加行内注释
- TODO 和 FIXME 标记待办事项

## 核心功能说明

### 1. 视频生成

**API**: `POST /api/generate-video`

**模型**: Seedance 2.0 (doubao-seedance-2-0-260128)

**特性**:
- 支持纯文本生成视频
- 支持图生视频（首帧图片）
- 支持批量视频生成
- 自动任务轮询和状态管理

**使用示例**:
```typescript
const response = await fetch('/api/generate-video', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: '视频提示词',
    imageUrl: '首帧图片URL（可选）',
    duration: 5,
    videoRatio: '16:9',
  }),
});
```

### 2. 视频编辑

**API**: `POST /api/video-edit`

**功能**: 使用参考图片和视频进行视频编辑

**使用示例**:
```typescript
const response = await fetch('/api/video-edit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: '编辑提示词',
    referenceImageUrl: '参考图片URL',
    referenceVideoUrl: '参考视频URL',
    duration: 5,
    ratio: '16:9',
  }),
});
```

### 3. 状态持久化

**Hook**: `usePersistentState`

**功能**: 自动保存状态到 localStorage

**使用示例**:
```typescript
const [value, setValue] = usePersistentState('key', initialValue);
setValue(newValue); // 自动保存到 localStorage
```

**注意事项**:
- localStorage 限制在 5-10MB
- 大数据建议使用项目导出功能
- 定期清理旧数据以释放空间

### 4. 存储空间监控

**组件**: `StorageMonitor`

**功能**: 实时监控 localStorage 使用情况

**特性**:
- 自动检测存储空间
- 使用超过 50% 显示警告
- 使用超过 80% 显示清理对话框
- 支持数据备份和清理

## 常见问题

### Q1: 视频生成失败，提示"未配置 ARK_API_KEY"

**A**: 请确保：
1. ✅ 已创建 `.env.local` 文件
2. ✅ 已配置 `ARK_API_KEY` 环境变量
3. ✅ 已重启开发服务器

详细配置请参阅 [环境变量配置指南](ENV_SETUP.md)。

### Q2: localStorage 配额已满

**A**: 解决方案：
1. 使用存储监控组件查看使用情况
2. 导出数据备份
3. 清除存储空间
4. 定期清理旧数据

### Q3: 图片无法显示

**A**: 检查：
1. 图片 URL 是否有效
2. S3 存储配置是否正确
3. 网络连接是否正常
4. 浏览器控制台是否有错误

### Q4: 视频生成超时

**A**: 可能原因：
1. 视频内容较复杂，需要更长时间
2. 服务繁忙，排队等待时间较长
3. 网络连接问题

**解决方案**:
- 稍后重试（等待2-3分钟）
- 简化提示词内容
- 单个生成视频，避免同时生成多个

## 调试技巧

### 查看日志

```bash
# 开发环境日志
tail -n 50 /app/work/logs/bypass/app.log

# 浏览器控制台日志
tail -n 50 /app/work/logs/bypass/console.log
```

### 检查环境变量

```typescript
console.log('ARK_API_KEY:', process.env.ARK_API_KEY ? '已配置' : '未配置');
```

### 测试 API 接口

```bash
# 测试视频生成
curl -X POST http://localhost:5000/api/generate-video \
  -H "Content-Type: application/json" \
  -d '{"prompt":"test"}'

# 检查服务状态
curl -I http://localhost:5000
```

## 性能优化建议

### 前端优化
1. 使用 React.memo 避免不必要的重渲染
2. 使用 useMemo 和 useCallback 优化计算
3. 延迟加载大型组件
4. 使用图片懒加载

### 后端优化
1. 实现请求缓存
2. 使用流式响应
3. 优化数据库查询
4. 限制并发请求数量

### 存储优化
1. 定期清理 localStorage
2. 使用项目导出功能备份数据
3. 压缩大文件后再存储
4. 使用 S3 存储大型媒体文件

## 安全最佳实践

### API Key 管理
1. ⚠️ 永远不要将 API Key 提交到 Git
2. ⚠️ 使用 `.env.local` 存储敏感信息
3. ⚠️ 定期轮换 API Key
4. ⚠️ 为不同环境使用不同的 Key
5. ⚠️ 限制 API Key 权限范围

### 数据安全
1. 使用 HTTPS 传输数据
2. 验证用户输入
3. 实现访问控制
4. 定期备份数据

## 贡献指南

### 提交代码
1. 确保代码通过 `pnpm lint` 检查
2. 确保代码通过 `pnpm ts-check` 类型检查
3. 添加必要的注释和文档
4. 遵循代码规范

### 报告问题
1. 描述问题的详细信息
2. 提供复现步骤
3. 附上错误日志
4. 说明预期的行为

## 参考资料

- [Next.js 文档](https://nextjs.org/docs)
- [shadcn/ui 组件库](https://ui.shadcn.com/)
- [Seedance 2.0 文档](https://www.volcengine.com/docs/82379)
- [环境变量配置指南](ENV_SETUP.md)

## 更新日志

### 2026-04-05
- ✅ 移除即梦3.0pro模型，全面使用Seedance 2.0
- ✅ 新增视频编辑功能
- ✅ 修复localStorage配额错误
- ✅ 新增存储空间监控组件
- ✅ 完善环境变量配置文档

---

**最后更新**: 2026年4月5日
