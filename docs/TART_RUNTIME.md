# Tart Runtime for NanoClaw

Tart provides VM-level isolation for running AI agents in NanoClaw, offering stronger security than container-based approaches.

## Overview

**Tart** is a macOS virtualization tool built on Apple's Virtualization.framework. When used as a NanoClaw runtime, each agent execution runs in a completely isolated macOS VM that is created fresh and destroyed after use.

### Key Features

- ✅ **VM-Level Isolation** - Stronger than containers
- ✅ **YOLO Mode** - Fresh VM every time, zero state pollution
- ✅ **macOS Native** - Real macOS environment (not Linux containers)
- ✅ **GPU Support** - Access to Metal and macOS APIs
- ✅ **Zero Residual** - Complete cleanup after execution

## Installation

### Prerequisites

```bash
# Install Tart
brew install cirruslabs/cli/tart

# Install sshpass (required for SSH automation)
brew install hudochenkov/sshpass/sshpass
```

### Prepare Base Image

Run the preparation script once to create the base VM image:

```bash
cd nanoclaw
chmod +x scripts/prepare-tart-base.sh
./scripts/prepare-tart-base.sh
```

This will:
1. Pull macOS Tahoe with Xcode (~8GB download first time)
2. Install development tools (git, node, python, etc.)
3. Install AI CLIs (Claude Code, OpenCode, Codex, Gemini CLI, Kimi CLI)
4. Save as `tart_nanoclaw_base` for fast cloning

**Time**: ~15-20 minutes (first time only)

## Configuration

### Environment Variables

Add to `.env`:

```bash
# Container runtime selection
CONTAINER_RUNTIME=tart

# Tart-specific settings (optional, defaults shown)
TART_BASE_IMAGE=tart_nanoclaw_base
TART_VM_USERNAME=admin
TART_VM_PASSWORD=admin
TART_SSH_TIMEOUT=60000
```

### Per-Group Configuration

Override runtime for specific groups:

```json
// groups/sensitive/config.json
{
  "containerConfig": {
    "runtime": "tart",
    "timeout": 600000
  }
}
```

## Usage

### Basic Usage

Once configured, Tart works transparently:

```bash
# Set Tart as default
export CONTAINER_RUNTIME=tart

# Start NanoClaw
npm run dev

# Send message (will run in VM)
# In WhatsApp: @Andy Hello, what container are you in?
```

### Mixed Runtime Strategy

Use different runtimes for different security levels:

```bash
# Default: Fast response (Apple Container)
CONTAINER_RUNTIME=container

# Override for sensitive groups
groups/finance/config.json:
  { "containerConfig": { "runtime": "tart" } }

groups/personal/config.json:
  { "containerConfig": { "runtime": "docker" } }
```

## How It Works

### Execution Flow

```
1. User sends message
2. NanoClaw detects CONTAINER_RUNTIME=tart
3. Clone base image: tart clone tart_nanoclaw_base → nanoclaw-group-12345
4. Start VM: tart run nanoclaw-group-12345 --dir=project:/path/to/group
5. Wait for IP and SSH connection
6. Upload configs (.claude, .opencode)
7. Export API keys to VM
8. Execute agent (claude/codex/opencode)
9. Capture output
10. Stop and delete VM completely
```

**Duration**: ~5-10 seconds per execution (VM startup overhead)

### VM Lifecycle

```
Clone (CoW, instant) → Start (~3s) → SSH Ready (~2s) → Execute → Cleanup (complete destruction)
```

Each execution is a **completely fresh VM** - zero state carried over.

## Security Model

### Isolation Levels

| Runtime | Isolation | Persistence | Security |
|---------|-----------|-------------|----------|
| Apple Container | Container | Process lifetime | ⭐⭐⭐⭐ |
| Docker | Container | Process lifetime | ⭐⭐⭐⭐ |
| **Tart** | **Full VM** | **None (YOLO)** | **⭐⭐⭐⭐⭐** |

### What Makes Tart More Secure?

1. **Complete OS Isolation**: Runs full macOS kernel in VM
2. **No Shared Filesystem**: Only explicitly mounted directories visible
3. **Hardware Virtualization**: CPU-level isolation via Apple Virtualization.framework
4. **Zero Persistence**: Every execution starts from clean base image
5. **Network Isolation**: VM has separate network stack

### Attack Surface Comparison

**Container Escape Scenarios** (Container/Docker):
- Kernel vulnerabilities
- Namespace escapes
- Shared kernel exploits

**VM Escape Scenarios** (Tart):
- Hypervisor vulnerabilities (extremely rare)
- Requires hardware virtualization bug

## Performance

### Benchmarks

| Metric | Apple Container | Docker | Tart |
|--------|----------------|--------|------|
| Startup | ~1-2s | ~2-3s | **~5-10s** |
| Memory | ~100MB | ~150MB | **~500MB-1GB** |
| Disk (per run) | Minimal | Minimal | **CoW snapshot** |
| Cleanup | Stop container | Stop container | **Full VM delete** |

### Performance Tips

1. **Base Image Optimization**: Pre-install all tools in base image
2. **Selective Use**: Use Tart for sensitive tasks, containers for frequent tasks
3. **Parallel Execution**: Multiple VMs can run concurrently (memory permitting)

## Troubleshooting

### VM Won't Start

```bash
# Check Tart installation
tart --version

# Check base image exists
tart list | grep tart_nanoclaw_base

# If missing, run preparation script
./scripts/prepare-tart-base.sh
```

### SSH Connection Fails

```bash
# Check sshpass is installed
sshpass -V

# Check VM is running
tart list

# Get VM IP manually
tart ip <vm-name>

# Try manual SSH
sshpass -p admin ssh admin@<vm-ip>
```

### Slow Startup

**Expected**: VM startup takes ~5-10s (vs 1-2s for containers)

**If slower than 15s**:
- Check system load (Activity Monitor)
- Ensure enough RAM (1GB+ free per VM)
- Check if base image is on SSD

### Cleanup Issues

```bash
# Manually stop all VMs
tart list | grep nanoclaw | xargs -I {} tart stop {}

# Manually delete all VMs
tart list | grep nanoclaw | xargs -I {} tart delete {}
```

## Advanced Usage

### Custom Base Image

Create a specialized base image:

```bash
# Clone existing base
tart clone tart_nanoclaw_base my_custom_base

# Start and customize
tart run my_custom_base

# (In VM) Install additional tools
brew install custom-tool

# Stop to save
tart stop my_custom_base

# Use custom base
export TART_BASE_IMAGE=my_custom_base
```

### Debugging Inside VM

When agent execution fails, the VM is deleted. To debug:

```typescript
// Temporarily modify tart-runner.ts
// Comment out the cleanup section in finally block

try {
  // ... execution code
} finally {
  // logger.info(..., 'Cleaning up Tart VM');
  // execSync(`tart stop ${vmName}`);
  // execSync(`tart delete ${vmName}`);
  console.log(`VM preserved for debugging: ${vmName}`);
  console.log(`Connect with: tart run ${vmName}`);
}
```

Then SSH into the preserved VM:

```bash
tart ip nanoclaw-group-12345
ssh admin@<ip>  # password: admin
cd ~/project
# Inspect state, run commands manually
```

### Snapshots for Auditing

Enable VM snapshots for compliance:

```bash
# After agent execution, before cleanup
tart stop nanoclaw-group-12345
tart clone nanoclaw-group-12345 audit-snapshot-$(date +%s)

# Later: review snapshot
tart run audit-snapshot-1234567890
```

## Comparison with Other Runtimes

### When to Use Tart

✅ **High-security scenarios** (financial data, compliance)
✅ **One-time sensitive tasks** (password resets, auth changes)
✅ **Untrusted code execution** (testing third-party scripts)
✅ **macOS-specific tasks** (Xcode builds, Metal GPU)
✅ **Audit trails** (snapshot VMs for compliance)

### When to Use Containers

✅ **High-frequency tasks** (real-time chat responses)
✅ **Low-latency requirements** (<2s response time)
✅ **Resource-constrained environments** (limited RAM)
✅ **Development/testing** (faster iteration)

### Decision Matrix

| Scenario | Recommended Runtime |
|----------|---------------------|
| Real-time chat | Apple Container / Docker |
| Financial reports | **Tart** |
| Code review | Apple Container |
| Production deploys | **Tart** |
| Quick queries | Codex/OpenCode (no container) |
| Compliance audit | **Tart + snapshots** |

## FAQ

**Q: Does Tart work on Intel Macs?**
A: Yes, but it's slower. Tart is optimized for Apple Silicon.

**Q: Can I run multiple VMs concurrently?**
A: Yes, limited by available RAM (~1GB per VM).

**Q: Is the base image updated automatically?**
A: No. Re-run `prepare-tart-base.sh` to rebuild with latest tools.

**Q: Can I use Linux instead of macOS?**
A: No, Tart only supports macOS VMs. Use Docker for Linux.

**Q: How much disk space does this use?**
A: Base image: ~15GB. Each clone uses CoW (copy-on-write), so minimal additional space during execution.

**Q: Can I access host filesystem from VM?**
A: Only explicitly mounted directories (via `--dir=project:...`)

## See Also

- [Tart Documentation](https://github.com/cirruslabs/tart)
- [NanoClaw Architecture](./ARCHITECTURE.md)
- [Security Model](./SECURITY.md)
- [Container Runner](../src/container-runner.ts)
- [Tart Runner](../src/tart-runner.ts)

---

**Version**: 1.0
**Last Updated**: 2026-02-07
