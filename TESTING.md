# NanoClaw 测试指南

## 🧪 容器测试

### 当前状态
✅ Docker 镜像构建成功
✅ 容器可以启动和接收输入
✅ 输出格式正确
❌ 需要 Claude 认证才能完整测试

---

## 🔑 设置认证

### 步骤 1: 创建 .env 文件

```bash
cp .env.example .env
```

然后编辑 `.env` 文件，添加以下内一：

**选项 A: 使用 Claude Code OAuth Token**
```bash
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
```

获取方法：
```bash
# 如果已登录 Claude Code
cat ~/.claude/.credentials.json | grep token
```

**选项 B: 使用 Anthropic API Key**
```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
```

从 https://console.anthropic.com/ 获取

---

## 🧪 测试步骤

### 1. 基础容器测试（无需认证）

验证容器可以启动和解析输入：

```bash
echo '{"prompt":"test","groupFolder":"test","chatJid":"test@g.us","isMain":false}' | \
  docker run -i --rm nanoclaw-agent:latest
```

**预期输出**：
```json
{
  "status": "error",
  "result": null,
  "newSessionId": "...",
  "error": "Claude Code process exited with code 1"
}
```

✅ 如果看到这个输出，说明容器工作正常！

---

### 2. 带认证的完整测试

#### 准备测试环境

```bash
# 创建测试目录
mkdir -p groups/test
echo "Test group memory" > groups/test/CLAUDE.md

# 创建会话目录
mkdir -p data/sessions/test/.claude

# 创建环境文件目录
mkdir -p data/env
```

#### 提取认证凭据

```bash
# 从 .env 提取认证变量
grep -E "CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY" .env > data/env/env
```

#### 运行完整测试

```bash
echo '{"prompt":"What is 2+2?","groupFolder":"test","chatJid":"test@g.us","isMain":false}' | \
  docker run -i --rm \
  -v "$(pwd)/groups/test:/workspace/group" \
  -v "$(pwd)/data/sessions/test/.claude:/home/node/.claude" \
  -v "$(pwd)/data/env:/workspace/env-dir:ro" \
  nanoclaw-agent:latest
```

**预期输出**（如果认证成功）：
```json
{
  "status": "success",
  "result": "2 + 2 = 4",
  "newSessionId": "..."
}
```

---

### 3. 测试 NanoClaw 主应用

#### 完整系统测试

```bash
# 1. 确保 .env 有认证
cat .env | grep -E "CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY"

# 2. 编译
npm run build

# 3. 运行开发模式
npm run dev
```

#### 使用 /setup 技能

在另一个终端运行：
```bash
claude
# 然后在 Claude Code 中运行: /setup
```

这将指导你完成：
- WhatsApp 认证
- 组注册
- 服务配置

---

## 🔍 诊断指南

### 问题: "Claude Code process exited with code 1"

**原因**: 缺少认证凭据

**解决方案**:
1. 检查 `.env` 文件存在并包含认证
2. 运行容器时挂载 `/workspace/env-dir`
3. 确保 `data/env/env` 文件存在

**验证**:
```bash
# 检查 .env
cat .env | grep -E "CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY"

# 检查提取的凭据
cat data/env/env

# 测试容器内环境
docker run -i --rm \
  -v "$(pwd)/data/env:/workspace/env-dir:ro" \
  --entrypoint /bin/bash \
  nanoclaw-agent:latest \
  -c 'cat /workspace/env-dir/env'
```

---

### 问题: "Session not continuing"

**原因**: 会话目录未挂载或路径错误

**解决方案**:
```bash
# 确保会话目录存在
mkdir -p data/sessions/test/.claude

# 挂载时使用正确路径
-v "$(pwd)/data/sessions/test/.claude:/home/node/.claude"
# 注意: 必须是 /home/node/.claude，不是 /root/.claude
```

---

### 问题: "Permission denied"

**原因**: 文件所有权问题

**解决方案**:
```bash
# 检查权限
ls -la groups/test/

# 修复权限
chmod -R 755 groups/
chmod -R 755 data/
```

---

## 📊 验证清单

运行完整系统前的检查：

- [ ] Docker 镜像已构建 (`docker images | grep nanoclaw`)
- [ ] `.env` 文件存在并包含认证
- [ ] `data/env/env` 文件包含认证凭据
- [ ] 组目录存在 (`groups/main/`)
- [ ] 会话目录存在 (`data/sessions/main/.claude/`)
- [ ] TypeScript 已编译 (`npm run build`)
- [ ] 数据库目录存在 (`store/`)

---

## 🚀 快速开始（完整流程）

```bash
# 1. 克隆并进入项目
cd nanoclaw

# 2. 安装依赖
npm install

# 3. 创建 .env（添加你的认证）
cat > .env << EOF
CLAUDE_CODE_OAUTH_TOKEN=your-token-here
# 或
ANTHROPIC_API_KEY=your-api-key-here
EOF

# 4. 构建容器
./container/build.sh

# 5. 编译 TypeScript
npm run build

# 6. 运行 Claude Code 进行设置
claude
# 然后: /setup

# 7. 运行应用
npm run dev
```

---

## 📚 相关文档

- **完整架构**: `docs/ARCHITECTURE.md`
- **开发指南**: `docs/DEVELOPER_GUIDE.md`
- **故障排除**: `docs/TROUBLESHOOTING.md`
- **API 参考**: `docs/API.md`

---

## 💡 提示

### Docker vs Apple Container

当前你在使用 Docker（因为 Apple Container 不可用）。这完全正常！

**运行时检测日志**:
```
Using Docker runtime  # ← 你会看到这个
```

两者功能完全相同，只是：
- Apple Container: macOS 优化，启动更快
- Docker: 跨平台，更通用

### 开发建议

1. **使用开发模式**: `npm run dev`（自动重载）
2. **查看日志**: `tail -f logs/nanoclaw.log`
3. **调试容器**: 查看 `groups/*/logs/container-*.log`
4. **运行 /debug**: 在 Claude Code 中获取自动诊断

---

## ✅ 成功标志

当一切正常时，你会看到：

```bash
npm run dev
# 输出:
[INFO] Database initialized
[INFO] State loaded
[INFO] Using Docker runtime
[INFO] NanoClaw running (trigger: @Andy)
```

然后在 WhatsApp/Discord 发送 `@Andy hello`，应该会收到响应！

---

**记住**: 当前的 "error" 是因为缺少认证，不是容器本身的问题。添加认证后就会正常工作！🎉
