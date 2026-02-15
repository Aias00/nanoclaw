# Tart 集成到 NanoClaw 作为沙盒运行时方案

## 🎯 集成可行性分析

**结论**: ✅ **完全可行且推荐**

Tart 可以作为 NanoClaw 的第四种容器运行时，与现有的 Apple Container 和 Docker 并列。

---

## 📊 当前 NanoClaw 架构

### 现有运行时选择

```typescript
// 容器运行时检测
detectContainerRuntime(): 'container' | 'docker'

// AI 运行时选择
type AgentRuntime = 'claude' | 'codex' | 'opencode'
```

**两层架构**:
1. **容器层**: `container` (Apple Container) / `docker`
2. **AI 层**: `claude` (Agent SDK) / `codex` / `opencode`

### 集成后的新架构

```typescript
// 扩展容器运行时
detectContainerRuntime(): 'container' | 'docker' | 'tart'

// AI 运行时保持不变
type AgentRuntime = 'claude' | 'codex' | 'opencode'
```

**三种容器运行时 × 三种 AI 运行时 = 9 种组合**

---

## 🔄 集成方案设计

### 方案 A: Tart 作为容器运行时（推荐）

将 Tart 添加为第三种容器引擎，与 Apple Container 和 Docker 平级。

```typescript
// src/container-runner.ts

function detectContainerRuntime(): 'container' | 'docker' | 'tart' {
  if (CONTAINER_RUNTIME) return CONTAINER_RUNTIME;

  // 1. Try Apple Container (macOS native)
  try {
    execSync('container --version', { stdio: 'ignore' });
    CONTAINER_RUNTIME = 'container';
    logger.info('Using Apple Container runtime');
    return 'container';
  } catch {}

  // 2. Try Tart (macOS Virtualization.framework)
  try {
    execSync('tart --version', { stdio: 'ignore' });
    execSync('sshpass -V', { stdio: 'ignore' }); // Also requires sshpass
    CONTAINER_RUNTIME = 'tart';
    logger.info('Using Tart runtime');
    return 'tart';
  } catch {}

  // 3. Fallback to Docker
  try {
    execSync('docker --version', { stdio: 'ignore' });
    CONTAINER_RUNTIME = 'docker';
    logger.info('Using Docker runtime');
    return 'docker';
  } catch {}

  throw new Error('No container runtime found. Install Apple Container, Tart, or Docker.');
}
```

### 核心集成点

#### 1. **VM 生命周期管理**

```typescript
async function runTartAgent(
  group: RegisteredGroup,
  input: ContainerInput,
): Promise<ContainerOutput> {
  const vmName = `nanoclaw-${group.folder}-${Date.now()}`;
  const baseImage = process.env.TART_BASE_IMAGE || 'tart_yolo_base';

  try {
    // 1. Clone base image
    logger.info({ group: group.name }, 'Cloning Tart VM');
    execSync(`tart clone ${baseImage} ${vmName}`);

    // 2. Start VM with directory mount
    const groupDir = path.join(GROUPS_DIR, group.folder);
    execSync(`tart run ${vmName} --dir=project:${groupDir} --no-audio --no-clipboard &`);

    // 3. Wait for IP and SSH
    const vmIP = await waitForVMIP(vmName);
    await waitForSSH(vmIP);

    // 4. Upload configs and env vars
    await uploadConfigs(vmIP, group);
    await exportEnvVars(vmIP);

    // 5. Execute agent command
    const result = await executeAgentInVM(vmIP, input);

    return {
      status: 'success',
      result: result.stdout,
      newSessionId: result.sessionId,
    };
  } finally {
    // 6. Cleanup
    execSync(`tart stop ${vmName} || true`);
    execSync(`tart delete ${vmName} || true`);
  }
}
```

#### 2. **配置上传（批量优化）**

```typescript
async function uploadConfigs(vmIP: string, group: RegisteredGroup): Promise<void> {
  const configFiles = [
    path.join(HOME_DIR, '.claude'),
    path.join(HOME_DIR, '.claude.json'),
    path.join(HOME_DIR, '.opencode'),
  ].filter(fs.existsSync);

  if (configFiles.length === 0) return;

  // Batch upload using tar (减少 SSH 连接)
  const tarFile = `/tmp/nanoclaw-configs-${Date.now()}.tar.gz`;
  execSync(`tar -czf ${tarFile} -C ${HOME_DIR} ${configFiles.map(f => path.relative(HOME_DIR, f)).join(' ')}`);

  // Upload tar
  execSync(`sshpass -p admin scp ${tarFile} admin@${vmIP}:/tmp/configs.tar.gz`);

  // Extract on VM
  await executeSSH(vmIP, 'tar -xzf /tmp/configs.tar.gz -C /Users/admin && rm /tmp/configs.tar.gz');

  fs.unlinkSync(tarFile);
}
```

#### 3. **环境变量导出**

```typescript
async function exportEnvVars(vmIP: string): Promise<void> {
  const apiKeys = Object.keys(process.env)
    .filter(key => key.includes('API_KEY'))
    .map(key => `export ${key}="${process.env[key]}"`)
    .join('\n');

  if (apiKeys) {
    await executeSSH(vmIP, `cat >> ~/.zshenv << 'EOF'\n${apiKeys}\nEOF`);
  }
}
```

#### 4. **Agent 执行**

```typescript
async function executeAgentInVM(
  vmIP: string,
  input: ContainerInput,
): Promise<{ stdout: string; sessionId?: string }> {
  const runtime = getAgentRuntime(group);

  let command: string;
  switch (runtime) {
    case 'claude':
      command = `cd ~/project && claude --dangerously-skip-permissions exec "${input.prompt}"`;
      break;
    case 'codex':
      command = `cd ~/project && codex --yolo exec "${input.prompt}"`;
      break;
    case 'opencode':
      command = `cd ~/project && OPENCODE_YOLO=true opencode run "${input.prompt}"`;
      break;
  }

  const result = await executeSSH(vmIP, command);
  return {
    stdout: result.stdout,
    sessionId: extractSessionId(result.stdout),
  };
}
```

---

## 🔒 安全优势对比

### 当前架构安全性

| 运行时 | 隔离级别 | 持久性 | 清理方式 |
|--------|----------|--------|----------|
| **Apple Container** | 容器级 | 容器存活期间 | 容器停止时清理 |
| **Docker** | 容器级 | 容器存活期间 | `docker rm` |

### 集成 Tart 后的安全性

| 运行时 | 隔离级别 | 持久性 | 清理方式 |
|--------|----------|--------|----------|
| **Apple Container** | 容器级 | 容器存活期间 | 容器停止时清理 |
| **Docker** | 容器级 | 容器存活期间 | `docker rm` |
| **Tart** | **VM 级（更强）** | **一次性（YOLO）** | **`tart delete`（完全销毁）** |

### Tart 独特优势

✅ **完整 VM 隔离** - 比容器更强的隔离
✅ **一次性环境** - 每次全新 macOS，零状态污染
✅ **原生 macOS** - 真实 macOS 环境（非 Linux 容器）
✅ **GPU 支持** - 可访问 Metal API（容器做不到）
✅ **零残留** - `tart delete` 后完全消失
✅ **快照支持** - 可以保存 VM 状态（可选）

---

## 📁 文件结构

新增文件：

```
nanoclaw/
├── src/
│   ├── container-runner.ts      # 修改：添加 Tart 检测
│   ├── tart-runner.ts           # 新增：Tart VM 管理
│   ├── tart-ssh-helper.ts       # 新增：SSH 工具函数
│   └── config.ts                # 修改：添加 Tart 配置
├── scripts/
│   └── prepare-tart-base.sh     # 新增：准备 Tart 基础镜像
└── docs/
    └── TART_RUNTIME.md          # 新增：Tart 使用文档
```

---

## 🛠️ 配置示例

### .env 配置

```bash
# 容器运行时选择（自动检测或手动指定）
CONTAINER_RUNTIME=tart  # 或 'container', 'docker'

# Tart 特定配置
TART_BASE_IMAGE=tart_yolo_base
TART_VM_USERNAME=admin
TART_VM_PASSWORD=admin
TART_SSH_TIMEOUT=60000

# AI 运行时（与容器运行时独立）
AGENT_RUNTIME=claude  # 或 'codex', 'opencode'
```

### 每组配置

```typescript
// groups/main/config.json
{
  "containerConfig": {
    "runtime": "tart",  // 覆盖全局设置
    "timeout": 600000,
    "env": {
      "AGENT_RUNTIME": "claude"
    }
  }
}
```

---

## 🚀 集成步骤

### Phase 1: 核心集成（2-3 天）

1. **创建 `tart-runner.ts`**
   - VM 克隆和启动
   - IP 检测和 SSH 连接
   - 批量配置上传
   - Agent 执行和输出解析
   - VM 清理

2. **修改 `container-runner.ts`**
   - 添加 Tart 运行时检测
   - 路由到 `runTartAgent()`

3. **修改 `config.ts`**
   - 添加 Tart 配置常量

### Phase 2: 工具集成（1-2 天）

4. **创建 `prepare-tart-base.sh`**
   ```bash
   #!/bin/bash
   # 基于 tart-yolo-claude/yolo_tart_prepare.sh

   tart pull ghcr.io/cirruslabs/macos-tahoe-xcode:latest
   tart clone macos-tahoe-xcode tart_nanoclaw_base

   # Install tools: git, node, claude, codex, opencode
   tart run tart_nanoclaw_base &
   # ... SSH setup and tool installation

   tart stop tart_nanoclaw_base
   ```

5. **创建辅助函数**
   - `waitForVMIP()` - 轮询 `tart ip`
   - `waitForSSH()` - 测试 SSH 连接
   - `executeSSH()` - 执行 SSH 命令
   - `uploadViaSCP()` - 文件上传

### Phase 3: 测试和文档（1-2 天）

6. **单元测试**
   - Tart 检测逻辑
   - VM 生命周期管理
   - 错误处理和清理

7. **集成测试**
   - 完整消息流程
   - 多组并发运行
   - 故障恢复

8. **文档**
   - `docs/TART_RUNTIME.md`
   - README 更新
   - 故障排查指南

---

## 💡 使用场景

### 场景 1: 高安全任务

```typescript
// 运行在完全隔离的 VM 中
CONTAINER_RUNTIME=tart
AGENT_RUNTIME=claude

// 每次执行都是全新 macOS
// 完全无法访问主机系统
```

### 场景 2: macOS 特定任务

```bash
# 需要 Xcode、Metal、或 macOS API
CONTAINER_RUNTIME=tart  # 真实 macOS
TART_BASE_IMAGE=macos-tahoe-xcode

# 任务：编译 Swift 项目、测试 iOS 应用
```

### 场景 3: 多运行时组合

```bash
# Main group: 快速响应（Apple Container）
groups/main/config.json:
  { "containerConfig": { "runtime": "container" } }

# Sensitive group: 高安全（Tart VM）
groups/finance/config.json:
  { "containerConfig": { "runtime": "tart" } }

# Research group: 灵活性（Docker）
groups/research/config.json:
  { "containerConfig": { "runtime": "docker" } }
```

---

## 📊 性能影响分析

| 指标 | Apple Container | Docker | Tart |
|------|----------------|--------|------|
| **启动时间** | ~1-2s | ~2-3s | **~5-10s** (克隆 + 启动) |
| **内存开销** | ~100MB | ~150MB | **~500MB-1GB** (完整 VM) |
| **隔离强度** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | **⭐⭐⭐⭐⭐** |
| **清理彻底性** | ⭐⭐⭐ | ⭐⭐⭐⭐ | **⭐⭐⭐⭐⭐** |
| **macOS 原生** | ❌ Linux | ❌ Linux | **✅ 真实 macOS** |

**权衡**:
- Tart 启动较慢，但隔离更强
- 适合**低频高安全**任务（如财务数据处理）
- 不适合高频快速响应场景

---

## 🔧 实现细节

### 1. SSH 辅助函数

```typescript
// src/tart-ssh-helper.ts

export async function executeSSH(
  ip: string,
  command: string,
  username = 'admin',
  password = 'admin',
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const sshCmd = spawn('sshpass', [
      '-p', password,
      'ssh',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'PreferredAuthentications=password',
      '-t',
      `${username}@${ip}`,
      `source ~/.zshenv && ${command}`,
    ]);

    let stdout = '';
    let stderr = '';

    sshCmd.stdout.on('data', (data) => { stdout += data.toString(); });
    sshCmd.stderr.on('data', (data) => { stderr += data.toString(); });

    sshCmd.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code || 0 });
    });

    sshCmd.on('error', reject);
  });
}

export async function waitForVMIP(vmName: string, maxAttempts = 30): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const ip = execSync(`tart ip ${vmName}`, { encoding: 'utf8' }).trim();
      if (ip) return ip;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Failed to get IP for VM ${vmName}`);
}

export async function waitForSSH(ip: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await executeSSH(ip, 'echo hello');
      return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Failed to connect via SSH to ${ip}`);
}
```

### 2. 主 Tart Runner

```typescript
// src/tart-runner.ts

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { executeSSH, waitForVMIP, waitForSSH } from './tart-ssh-helper.js';
import type { RegisteredGroup } from './types.js';
import type { ContainerInput, ContainerOutput } from './container-runner.js';

const TART_BASE_IMAGE = process.env.TART_BASE_IMAGE || 'tart_nanoclaw_base';
const TART_USERNAME = process.env.TART_VM_USERNAME || 'admin';
const TART_PASSWORD = process.env.TART_VM_PASSWORD || 'admin';

export async function runTartAgent(
  group: RegisteredGroup,
  input: ContainerInput,
): Promise<ContainerOutput> {
  const vmName = `nanoclaw-${group.folder}-${Date.now()}`;
  let vmIP: string | null = null;

  try {
    // 1. Clone base image
    logger.info({ group: group.name, vmName }, 'Cloning Tart base image');
    execSync(`tart clone ${TART_BASE_IMAGE} ${vmName}`);

    // 2. Start VM with project mount
    const groupDir = path.join(GROUPS_DIR, group.folder);
    logger.info({ group: group.name, groupDir }, 'Starting Tart VM');
    execSync(`tart run ${vmName} --dir=project:${groupDir} --no-audio --no-clipboard &`);

    // 3. Wait for VM to boot
    vmIP = await waitForVMIP(vmName);
    logger.info({ group: group.name, vmIP }, 'VM IP obtained');
    await waitForSSH(vmIP);
    logger.info({ group: group.name, vmIP }, 'SSH connection established');

    // 4. Create ~/project symlink
    await executeSSH(vmIP, 'ln -sfn "/Volumes/My Shared Files/project" ~/project', TART_USERNAME, TART_PASSWORD);

    // 5. Upload configs
    await uploadConfigs(vmIP, group);

    // 6. Export env vars
    await exportEnvVars(vmIP);

    // 7. Execute agent
    const result = await executeAgentInVM(vmIP, group, input);

    return {
      status: 'success',
      result: result.stdout,
      newSessionId: result.sessionId,
    };
  } catch (error) {
    logger.error({ group: group.name, error }, 'Tart agent execution failed');
    return {
      status: 'error',
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Cleanup
    logger.info({ group: group.name, vmName }, 'Cleaning up Tart VM');
    try {
      execSync(`tart stop ${vmName}`, { stdio: 'ignore' });
      await new Promise(resolve => setTimeout(resolve, 1000));
      execSync(`tart delete ${vmName}`, { stdio: 'ignore' });
    } catch (cleanupError) {
      logger.error({ cleanupError }, 'Failed to cleanup Tart VM');
    }
  }
}
```

---

## 📋 配置检查清单

### 安装前置条件

```bash
# 检查 Tart
tart --version

# 检查 sshpass
sshpass -V

# 如果缺失，安装
brew install cirruslabs/cli/tart
brew install hudochenkov/sshpass/sshpass
```

### 准备基础镜像

```bash
# 运行准备脚本
./scripts/prepare-tart-base.sh

# 验证镜像存在
tart list | grep tart_nanoclaw_base
```

### 测试 Tart 运行时

```bash
# 设置环境变量
export CONTAINER_RUNTIME=tart
export AGENT_RUNTIME=claude

# 启动 NanoClaw
npm run dev

# 发送测试消息
# 在 WhatsApp 中: @Andy 你好，使用的是什么容器？
```

---

## 🎯 总结

### 集成价值

| 优势 | 说明 |
|------|------|
| **安全性提升** | VM 级隔离 > 容器级隔离 |
| **零状态污染** | 每次全新环境，无历史残留 |
| **macOS 原生** | 真实 macOS，支持 Xcode/Metal |
| **灵活选择** | 3 种容器 × 3 种 AI = 9 种组合 |
| **渐进采用** | 不破坏现有架构，可选启用 |

### 推荐策略

```typescript
// 默认：快速响应（Apple Container + Claude）
CONTAINER_RUNTIME=container
AGENT_RUNTIME=claude

// 高安全：完全隔离（Tart + Claude）
groups/finance/config.json:
  { "containerConfig": { "runtime": "tart" } }

// 轻量级：快速查询（进程 + Codex）
groups/quick/config.json:
  { "containerConfig": { "runtime": "none" }, "env": { "AGENT_RUNTIME": "codex" } }
```

### 实施建议

1. ✅ **Phase 1**: 实现核心 Tart runner（2-3 天）
2. ✅ **Phase 2**: 集成到 container-runner.ts（1 天）
3. ✅ **Phase 3**: 测试和文档（1-2 天）
4. ✅ **可选**: 添加 Tart 特定优化（快照、预热等）

**总工时估算**: 4-6 天完整集成

---

**文档版本**: v1.0 (2026-02-07)
**作者**: Claude Sonnet 4.5
