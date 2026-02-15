# Vibe Integration Proposal for NanoClaw

## 🎯 可行性分析

**结论**: ✅ **完全可行，但与 Tart 有不同的定位**

Vibe 可以作为 NanoClaw 的第四种容器运行时，专注于**持久化 Linux VM 环境**。

---

## 📊 Vibe vs Tart 对比

### 核心差异

| 维度 | Vibe | Tart |
|------|------|------|
| **Guest OS** | **Linux** | **macOS** |
| **持久性** | **✅ 持久化磁盘** | ❌ 一次性克隆 |
| **工作模式** | 长期运行 VM | YOLO (每次全新) |
| **交互方式** | `--send`, `--expect`, `--script` | SSH (sshpass) |
| **适用场景** | 稳定开发环境 | 高安全一次性任务 |
| **启动速度** | ⚡ 快（已存在的 VM） | 🐢 慢（克隆 + 启动） |
| **磁盘占用** | 3GB 持久占用 | 基础镜像 + 临时 CoW |

### 互补性

**Vibe** = 持久化 Linux 环境（类似 Docker，但更隔离）
**Tart** = 临时 macOS 沙盒（一次性高安全）

---

## 🏗️ Vibe 工作原理

### 基本用法

```bash
# 启动 VM（如果不存在会创建）
vibe instance.raw

# 挂载目录
vibe --mount /host/path:/guest/path instance.raw

# 执行脚本
vibe --script setup.sh instance.raw

# 发送命令并等待输出
vibe --send "echo hello" --expect "hello" instance.raw

# 配置资源
vibe --cpus 4 --ram 4096 instance.raw
```

### 特点

1. **持久化磁盘**: `instance.raw` 保留状态
2. **脚本自动化**: 通过 `--script` 执行初始化
3. **命令注入**: 通过 `--send` 发送命令到 VM
4. **输出同步**: 通过 `--expect` 等待特定输出

---

## 🔄 集成方案设计

### 方案 A: Vibe 作为持久化运行时（推荐）

将 Vibe 添加为第四种容器运行时，定位为**持久化 Linux 环境**。

```typescript
// 扩展容器运行时
detectContainerRuntime(): 'container' | 'docker' | 'tart' | 'vibe'

// 运行时矩阵: 4 种容器 × 3 种 AI = 12 种组合
```

### 架构定位

```
Container Runtimes:
├── Apple Container  - macOS 容器（快速）
├── Docker          - 跨平台容器（通用）
├── Tart            - macOS VM（一次性高安全）
└── Vibe            - Linux VM（持久化开发环境）
```

---

## 🛠️ 实现设计

### 1. Vibe Runner 接口

```typescript
// src/vibe-runner.ts

export async function runVibeAgent(
  group: RegisteredGroup,
  input: ContainerInput,
): Promise<ContainerOutput> {
  const vibeImage = getVibeImagePath(group);
  const groupDir = path.join(GROUPS_DIR, group.folder);

  // Build vibe command
  const args = [
    '--mount', `${groupDir}:/workspace:read-write`,
    '--mount', `${DATA_DIR}/ipc/${group.folder}:/ipc:read-write`,
    '--script', createAgentScript(input),
    vibeImage,
  ];

  // Execute vibe
  const result = await executeVibe(args);

  return {
    status: result.exitCode === 0 ? 'success' : 'error',
    result: extractOutput(result.stdout),
  };
}
```

### 2. 命令执行方式

#### 方式 A: 使用 `--script`（推荐）

```typescript
function createAgentScript(input: ContainerInput): string {
  const scriptPath = `/tmp/nanoclaw-agent-${Date.now()}.sh`;
  const runtime = getAgentRuntime();

  let command: string;
  switch (runtime) {
    case 'claude':
      command = `cd /workspace && claude exec "${input.prompt}"`;
      break;
    case 'codex':
      command = `cd /workspace && codex exec "${input.prompt}"`;
      break;
    case 'opencode':
      command = `cd /workspace && opencode run "${input.prompt}"`;
      break;
  }

  const script = `
#!/bin/bash
set -e

# Source environment
source ~/.bashrc 2>/dev/null || true

# Execute agent
${command}
`;

  fs.writeFileSync(scriptPath, script);
  fs.chmodSync(scriptPath, 0o755);

  return scriptPath;
}
```

#### 方式 B: 使用 `--send` + `--expect`

```typescript
async function executeAgentViaCommands(
  vibeImage: string,
  input: ContainerInput,
): Promise<string> {
  const runtime = getAgentRuntime();
  const command = buildAgentCommand(runtime, input);

  // Build vibe args with send/expect
  const args = [
    '--mount', `${groupDir}:/workspace`,
    '--send', `cd /workspace`,
    '--expect', '/workspace',
    '--send', command,
    '--expect', 'AGENT_DONE',  // Custom marker
    vibeImage,
  ];

  const proc = spawn('vibe', args);
  // ... capture output
}
```

### 3. 磁盘镜像管理

#### 每组独立镜像（推荐）

```typescript
function getVibeImagePath(group: RegisteredGroup): string {
  const vibeDir = path.join(DATA_DIR, 'vibe-images');
  fs.mkdirSync(vibeDir, { recursive: true });

  const imagePath = path.join(vibeDir, `${group.folder}.raw`);

  // If image doesn't exist, clone from base
  if (!fs.existsSync(imagePath)) {
    const baseImage = process.env.VIBE_BASE_IMAGE ||
                      path.join(vibeDir, 'base.raw');

    if (!fs.existsSync(baseImage)) {
      throw new Error(`Vibe base image not found: ${baseImage}`);
    }

    logger.info({ group: group.name }, 'Creating Vibe image from base');
    fs.copyFileSync(baseImage, imagePath);
  }

  return imagePath;
}
```

#### 共享基础镜像 + 快照（可选）

```typescript
// Use CoW if filesystem supports it (APFS)
execSync(`cp -c ${baseImage} ${imagePath}`);  // CoW copy on APFS
```

---

## 📁 文件结构

```
nanoclaw/
├── src/
│   ├── vibe-runner.ts           # 新增：Vibe VM 管理
│   ├── vibe-helper.ts           # 新增：Vibe 工具函数
│   └── container-runner.ts      # 修改：添加 Vibe 检测
├── scripts/
│   └── prepare-vibe-base.sh     # 新增：准备 Vibe 基础镜像
├── data/
│   └── vibe-images/             # 新增：存储 VM 镜像
│       ├── base.raw             # 基础镜像
│       ├── main.raw             # Main group 镜像
│       └── group1.raw           # Group1 镜像
└── docs/
    └── VIBE_RUNTIME.md          # 新增：Vibe 使用文档
```

---

## 🔒 安全模型

### Vibe 的安全特性

| 特性 | 评估 |
|------|------|
| **隔离级别** | ⭐⭐⭐⭐⭐ VM 级 |
| **Guest OS** | Linux（vs macOS for Tart） |
| **持久性** | ✅ 状态保留 |
| **文件系统隔离** | ✅ 只挂载指定目录 |
| **网络隔离** | ✅ 独立网络栈 |

### 与其他运行时的安全对比

| 运行时 | 隔离级别 | 持久性 | 适合场景 |
|--------|----------|--------|----------|
| Container | ⭐⭐⭐⭐ | ❌ 临时 | 快速响应 |
| Docker | ⭐⭐⭐⭐ | ❌ 临时 | 跨平台 |
| Tart | ⭐⭐⭐⭐⭐ | ❌ 临时 | 一次性高安全 |
| **Vibe** | **⭐⭐⭐⭐⭐** | **✅ 持久** | **长期开发环境** |

---

## 💡 使用场景

### Vibe 的独特价值

✅ **持久化开发环境**
- 不想每次都重新配置
- 需要保留历史和状态
- 类似"个人开发机"

✅ **Linux 特定任务**
- 需要 Linux 工具链
- 编译 Linux 程序
- 测试 Linux 脚本

✅ **长期运行任务**
- 后台监控服务
- 定时任务（已配置好的环境）
- 数据处理流水线

### 场景对比

| 场景 | 推荐运行时 | 原因 |
|------|-----------|------|
| 实时聊天 | Apple Container | 最快 |
| 财务审计 | Tart | 一次性，零残留 |
| **长期开发** | **Vibe** | **持久化，Linux** |
| 快速查询 | Codex/OpenCode | 无容器开销 |
| macOS 构建 | Tart | 真实 macOS |
| **Linux 工具** | **Vibe** | **Linux VM** |

---

## 🚀 配置示例

### 环境变量

```bash
# .env
CONTAINER_RUNTIME=vibe

# Vibe-specific
VIBE_BASE_IMAGE=/path/to/base.raw
VIBE_CPUS=2
VIBE_RAM=2048  # MB
VIBE_TIMEOUT=300000  # ms
```

### 每组配置

```json
// groups/dev/config.json
{
  "containerConfig": {
    "runtime": "vibe",
    "vibeImage": "custom-dev.raw",
    "cpus": 4,
    "ram": 4096
  }
}
```

### 混合策略示例

```bash
# Main: 快速 + macOS
groups/main/config.json:
  { "containerConfig": { "runtime": "container" } }

# Finance: 高安全 + 一次性
groups/finance/config.json:
  { "containerConfig": { "runtime": "tart" } }

# Dev: 持久化 + Linux
groups/dev/config.json:
  { "containerConfig": { "runtime": "vibe" } }

# Research: 标准容器
groups/research/config.json:
  { "containerConfig": { "runtime": "docker" } }
```

---

## 📊 性能分析

### 启动时间对比

| 运行时 | 首次启动 | 后续启动 | 说明 |
|--------|----------|----------|------|
| Container | ~1s | ~1s | 容器启动 |
| Docker | ~2s | ~2s | 容器启动 |
| Tart | ~10s | ~10s | 每次克隆 + 启动 |
| **Vibe** | **~5s** | **~2s** | **VM 已存在时快** |

### 磁盘占用

| 运行时 | 基础镜像 | 每组额外 | 总计（3 组） |
|--------|----------|----------|--------------|
| Container | ~500MB | ~10MB | ~530MB |
| Docker | ~200MB | ~10MB | ~230MB |
| Tart | ~15GB | ~100MB | ~15.3GB |
| **Vibe** | **~3GB** | **~3GB** | **~12GB** |

**注意**: Vibe 每组一个独立镜像（3GB），适合少量组。

---

## 🔧 实现步骤

### Phase 1: 核心集成（2-3 天）

1. **创建 vibe-helper.ts**
   - `executeVibe()` - 执行 vibe 命令
   - `createAgentScript()` - 生成执行脚本
   - `extractOutput()` - 解析输出
   - `checkVibeDependency()` - 检查 vibe 命令

2. **创建 vibe-runner.ts**
   - `runVibeAgent()` - 主运行器
   - `getVibeImagePath()` - 镜像管理
   - `mountDirectories()` - 目录挂载配置
   - `cleanupVibe()` - 可选清理

3. **修改 container-runner.ts**
   - 添加 Vibe 检测
   - 路由到 `runVibeAgent()`

4. **修改 config.ts**
   - 添加 Vibe 配置常量

### Phase 2: 镜像管理（1-2 天）

5. **创建 prepare-vibe-base.sh**
   - 下载或创建 Linux 镜像
   - 安装开发工具
   - 安装 AI CLI
   - 保存为 base.raw

6. **镜像复制策略**
   - 每组独立镜像 vs 共享镜像
   - CoW 优化（APFS）
   - 镜像备份机制

### Phase 3: 测试和文档（1-2 天）

7. **测试**
   - 单组执行
   - 多组并发
   - 持久性验证
   - 错误处理

8. **文档**
   - VIBE_RUNTIME.md
   - 镜像管理指南
   - 故障排查

---

## ⚠️ 挑战和限制

### 技术挑战

1. **输出捕获**
   - Vibe 通过控制台输出，需要解析
   - 需要可靠的输出标记（`--expect`）

2. **磁盘空间**
   - 每组 3GB，5 个组 = 15GB
   - 需要定期清理机制

3. **并发控制**
   - 多个 Vibe VM 同时运行
   - RAM 限制（每个 2GB+）

4. **状态管理**
   - 持久化 = 可能积累垃圾
   - 需要重置/清理策略

### 建议的解决方案

```typescript
// 1. 输出标记
const script = `
#!/bin/bash
echo "NANOCLAW_OUTPUT_START"
${agentCommand}
echo "NANOCLAW_OUTPUT_END"
`;

// 2. 磁盘清理
async function cleanupVibeImages() {
  // Delete images not used in 30 days
  // Or provide /vibe-reset command
}

// 3. 并发限制
const MAX_CONCURRENT_VIBE = 3;
const vibeQueue = new Queue({ concurrency: MAX_CONCURRENT_VIBE });

// 4. 镜像重置
async function resetVibeImage(group: RegisteredGroup) {
  const imagePath = getVibeImagePath(group);
  const baseImage = VIBE_BASE_IMAGE;

  fs.unlinkSync(imagePath);
  fs.copyFileSync(baseImage, imagePath);
}
```

---

## 🎯 推荐策略

### 集成优先级

| 优先级 | 运行时 | 原因 |
|--------|--------|------|
| P0 | Apple Container | 默认，最快 |
| P1 | Docker | 跨平台必备 |
| P2 | Tart | 高安全场景 |
| **P3** | **Vibe** | **特定需求（Linux + 持久化）** |

### 何时集成 Vibe

**立即集成**，如果：
- ✅ 需要 Linux 工具链（编译、测试）
- ✅ 需要持久化开发环境
- ✅ 有充足磁盘空间（15GB+）
- ✅ 组数量有限（<5 个）

**暂缓集成**，如果：
- ❌ 只用 macOS 工具
- ❌ 磁盘空间紧张
- ❌ 大量群聊（>10 个）
- ❌ 全部需求容器已满足

---

## 💡 集成后的完整架构

### 4 种容器 × 3 种 AI = 12 种组合

|  | Claude SDK | Codex | OpenCode |
|--|------------|-------|----------|
| **Apple Container** (macOS 容器) | ✅ | ✅ | ✅ |
| **Docker** (跨平台容器) | ✅ | ✅ | ✅ |
| **Tart** (macOS VM, 一次性) | ✅ | ✅ | ✅ |
| **Vibe** (Linux VM, 持久化) | ✅ | ✅ | ✅ |

### 选择决策树

```
需要隔离？
├─ 否 → 直接运行（Codex/OpenCode，无容器）
└─ 是 → 需要持久化？
    ├─ 是 → 需要 Linux？
    │   ├─ 是 → Vibe（Linux VM 持久化）
    │   └─ 否 → 考虑容器或自行管理持久化
    └─ 否 → 需要最高安全？
        ├─ 是 → Tart（macOS VM 一次性）
        └─ 否 → 需要 macOS 原生？
            ├─ 是 → Apple Container
            └─ 否 → Docker
```

---

## 📚 工作量估算

| Phase | 任务 | 预计时间 |
|-------|------|----------|
| Phase 1 | vibe-helper.ts + vibe-runner.ts | 2-3 天 |
| Phase 2 | 镜像管理 + prepare 脚本 | 1-2 天 |
| Phase 3 | 测试 + 文档 | 1-2 天 |
| **总计** |  | **4-7 天** |

---

## 🎯 建议

### 个人建议：先观察需求

1. **Tart 已经提供 VM 级隔离**
   - 如果需要一次性高安全 → 已有 Tart
   - 如果需要持久化 → 可以用容器 + volume

2. **Vibe 的独特价值是 Linux + 持久化**
   - 如果确实需要 Linux 环境 → 集成 Vibe
   - 否则 Tart + Docker 已足够

3. **磁盘空间考虑**
   - Vibe 每组 3GB
   - 5 组 = 15GB
   - 如果磁盘紧张，可能不合适

### 建议的集成顺序

1. ✅ **已完成**: Apple Container + Docker + Tart + OpenCode
2. ⏳ **观察需求**: 看是否真需要 Linux 持久化环境
3. 🔄 **按需集成**: 如果有明确 Linux 需求，再集成 Vibe

---

## 📋 总结

### 可行性
✅ **完全可行** - Vibe 技术上可以集成

### 必要性
⚠️ **视需求而定**
- 如果需要 Linux + 持久化 → 很有价值
- 如果只需隔离 → Tart/Docker 已足够

### 推荐行动
1. **暂时不急于集成**
2. **先用 Tart 观察效果**
3. **如果出现明确 Linux 需求，再集成 Vibe**
4. **或者作为可选 Skill 提供** (`/add-vibe`)

---

**文档版本**: v1.0 (2026-02-07)
**状态**: 📋 提案（待决策）
