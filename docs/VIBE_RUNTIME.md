# Vibe Runtime for NanoClaw

Vibe provides **persistent Linux VM** isolation for running AI agents in NanoClaw, offering a balance between performance and security with state preservation.

## Overview

**Vibe** is a lightweight Linux VM tool built on macOS Virtualization.framework. When used as a NanoClaw runtime, agents run in a persistent Linux environment that maintains state across executions.

### Key Features

- ✅ **VM-Level Isolation** - Full Linux VM per group
- ✅ **Persistent State** - VM state preserved across runs
- ✅ **Linux Environment** - Real Linux tools and workflows
- ✅ **Fast Startup** - Quick boot after initial creation (~2s)
- ✅ **Low Overhead** - Lightweight compared to full macOS VMs

## Comparison with Other Runtimes

| Feature | Vibe | Tart | Container/Docker |
|---------|------|------|------------------|
| **Guest OS** | Linux | macOS | Linux/None |
| **Persistence** | ✅ Stateful | ❌ YOLO | ❌ Ephemeral |
| **Startup (first)** | ~5s | ~10s | ~1-2s |
| **Startup (after)** | ~2s | ~10s | ~1-2s |
| **Disk/Group** | 3GB | CoW | Minimal |
| **Use Case** | Dev environment | One-time secure | Quick tasks |

## Installation

### Prerequisites

```bash
# Check if vibe is installed
which vibe

# If not, install from source
git clone https://github.com/lynaghk/vibe.git
cd vibe
# Follow build instructions
```

### Prepare Base Image

Run the preparation script once to create the base Linux image:

```bash
cd nanoclaw
chmod +x scripts/prepare-vibe-base.sh
./scripts/prepare-vibe-base.sh
```

This will:
1. Create a 3GB Linux VM image
2. Install system packages (git, node, python, etc.)
3. Install AI CLIs (Claude Code, OpenCode, Codex, Gemini CLI, Kimi CLI)
4. Configure environment
5. Save as `data/vibe-images/base.raw`

**Time**: ~10-15 minutes (first time only)

## Configuration

### Environment Variables

Add to `.env`:

```bash
# Container runtime selection
CONTAINER_RUNTIME=vibe

# Vibe-specific settings (optional, defaults shown)
VIBE_BASE_IMAGE=base.raw
VIBE_IMAGES_DIR=./data/vibe-images
VIBE_CPUS=2
VIBE_RAM=2048
VIBE_TIMEOUT=300000
```

### Per-Group Configuration

Override settings for specific groups:

```json
// groups/dev/config.json
{
  "containerConfig": {
    "runtime": "vibe",
    "vibeImage": "custom-dev.raw",
    "cpus": 4,
    "ram": 4096,
    "timeout": 600000
  }
}
```

## Usage

### Basic Usage

Once configured, Vibe works transparently:

```bash
# Set Vibe as default
export CONTAINER_RUNTIME=vibe

# Start NanoClaw
npm run dev

# Send message (will run in persistent Linux VM)
# In WhatsApp: @Andy Hello, what's my Linux environment?
```

### Mixed Runtime Strategy

Use different runtimes for different purposes:

```bash
# Default: Fast response (Apple Container)
CONTAINER_RUNTIME=container

# Override for specific groups
groups/main/config.json:
  { "containerConfig": { "runtime": "container" } }

groups/dev/config.json:
  { "containerConfig": { "runtime": "vibe" } }  # Persistent dev environment

groups/finance/config.json:
  { "containerConfig": { "runtime": "tart" } }  # One-time secure tasks
```

## How It Works

### Execution Flow

```
1. User sends message
2. NanoClaw detects CONTAINER_RUNTIME=vibe
3. Get or create VM image: data/vibe-images/{group}.raw
4. Create execution script with agent command
5. Execute: vibe --mount /path:/workspace --script agent.sh image.raw
6. Parse output between NANOCLAW_OUTPUT_START/END markers
7. Return result (VM stays running, state preserved)
```

**Duration**: ~2-5 seconds per execution (after first boot)

### Image Management

```
Vibe Images:
├── base.raw (3GB)          - Base Linux image (shared)
├── main.raw (3GB)          - Main group image (cloned from base)
├── dev.raw (3GB)           - Dev group image
└── research.raw (3GB)      - Research group image

Each group gets its own image (copy-on-write on APFS)
```

## Persistent State

### What is Preserved

✅ **Installed packages** - `apt install`, `npm install`, etc.
✅ **Configuration files** - `.bashrc`, tool configs
✅ **File modifications** - Changes to `/workspace`
✅ **Command history** - Bash history
✅ **Downloaded data** - Cached files, cloned repos

### What is NOT Preserved

❌ **Running processes** - VM is stopped between executions
❌ **Network connections** - Sockets closed on shutdown
❌ **Temporary files** - `/tmp` may be cleared

## Managing State

### Reset a Group's Image

To clear accumulated state and start fresh:

```typescript
import { resetVibeImage } from './src/vibe-runner.js';

// Reset specific group
await resetVibeImage('dev');
```

Or via CLI:

```bash
# Delete group image (will be recreated from base)
rm data/vibe-images/dev.raw
```

### View Disk Usage

```typescript
import { getVibeImageStats } from './src/vibe-runner.js';

const stats = getVibeImageStats();
console.log(stats);
// [
//   { group: 'main', sizeMB: 3100, modified: Date(...) },
//   { group: 'dev', sizeMB: 3500, modified: Date(...) }
// ]
```

## Performance

### Benchmarks

| Metric | First Execution | Subsequent |
|--------|----------------|------------|
| VM Boot | ~5s | ~2s |
| Agent Execution | +2-10s | +2-10s |
| Total | ~7-15s | ~4-12s |

### Disk Space

- Base image: 3GB
- Each group: +3GB (copy-on-write)
- 5 groups: ~15GB total

### Memory

- Per VM: 2GB RAM (configurable)
- 3 concurrent VMs: 6GB RAM needed

## Troubleshooting

### VM Won't Start

```bash
# Check vibe installation
which vibe
vibe --version

# Check base image exists
ls -lh data/vibe-images/base.raw

# If missing, run preparation script
./scripts/prepare-vibe-base.sh
```

### Slow Performance

```bash
# Increase resources for group
# In groups/{name}/config.json:
{
  "containerConfig": {
    "cpus": 4,
    "ram": 4096
  }
}
```

### Disk Space Issues

```bash
# Check disk usage
du -sh data/vibe-images/*.raw

# Remove unused images
rm data/vibe-images/old-group.raw

# Reset bloated image
rm data/vibe-images/dev.raw  # Will be recreated
```

### Agent Output Not Captured

The output markers may not be working. Check:

```bash
# View raw vibe output
VIBE_DEBUG=1 npm run dev

# Manual test
vibe --script test.sh data/vibe-images/main.raw
```

## Advanced Usage

### Custom Base Image

Create a specialized base image:

```bash
# Clone existing base
cp data/vibe-images/base.raw data/vibe-images/custom-base.raw

# Start VM and customize
vibe data/vibe-images/custom-base.raw

# (In VM) Install additional tools
apt-get install -y custom-package

# Shutdown preserves changes

# Use custom base for a group
# In .env or group config:
VIBE_BASE_IMAGE=custom-base.raw
```

### Shared Tools Across Groups

Install common tools in base image, then clone for each group:

```bash
# Update base image
vibe data/vibe-images/base.raw
# Install tools, then exit

# Reset all groups to get updates
rm data/vibe-images/main.raw
rm data/vibe-images/dev.raw
# Will be recreated from updated base
```

### Pre-warming VM

Keep VM ready for faster first execution:

```bash
# Start VM in background
vibe --send "echo ready" \
     --expect "ready" \
     data/vibe-images/main.raw &

# Now first execution will be faster
```

## Use Cases

### When to Use Vibe

✅ **Persistent Development Environment**
- Need Linux tools installed once
- Want to preserve dependencies
- Working on long-running projects

✅ **Linux-Specific Tasks**
- Compile Linux binaries
- Test Linux scripts
- Use Linux-only tools

✅ **Iterative Workflows**
- Clone repos once, iterate many times
- Install heavy dependencies once
- Build incremental state

### When to Use Other Runtimes

❌ **High Security** → Use Tart (one-time, zero residue)
❌ **Fast Response** → Use Containers (1-2s startup)
❌ **macOS Tools** → Use Tart (real macOS)
❌ **Limited Disk** → Use Containers (minimal space)

## Security Considerations

### Isolation Level

- ✅ **VM-level isolation** - Strong boundary
- ⚠️ **Persistent state** - Potential accumulation of sensitive data
- ✅ **Per-group images** - Groups cannot access each other

### Security Best Practices

1. **Reset images periodically** for sensitive groups
2. **Use Tart for one-time tasks** that handle secrets
3. **Monitor disk usage** to detect unexpected growth
4. **Review mounted directories** in group configs

## Comparison Matrix

| Scenario | Container | Docker | Tart | Vibe |
|----------|-----------|--------|------|------|
| Real-time chat | ✅ Best | ✅ Good | ❌ Slow | ⚠️ OK |
| Financial audit | ⚠️ OK | ⚠️ OK | ✅ Best | ❌ Persistent |
| **Linux development** | ⚠️ OK | ✅ Good | ❌ macOS | **✅ Best** |
| **Iterative work** | ❌ No state | ❌ No state | ❌ No state | **✅ Best** |
| Quick queries | ✅ Best | ✅ Good | ❌ Slow | ⚠️ OK |
| macOS builds | ❌ Linux | ❌ Linux | ✅ Best | ❌ Linux |
| Limited disk | ✅ Best | ✅ Good | ⚠️ OK | ❌ 3GB/group |

## FAQ

**Q: Why does each group need its own 3GB image?**
A: To maintain isolation between groups. On APFS, copy-on-write reduces actual disk usage.

**Q: Can I share one image across groups?**
A: Not recommended - groups would share state and interfere with each other.

**Q: How do I update tools in existing images?**
A: Either update base and reset groups, or run update commands in each group's VM.

**Q: Is Vibe faster than Tart?**
A: Yes for subsequent runs (~2s vs ~10s), but both are slower than containers.

**Q: Can I use Vibe on Linux?**
A: No, Vibe requires macOS Virtualization.framework. Use Docker on Linux.

**Q: What if I run out of disk space?**
A: Delete unused group images or increase group limit. Consider Tart (YOLO) instead.

## See Also

- [Vibe GitHub](https://github.com/lynaghk/vibe/)
- [Tart Runtime](./TART_RUNTIME.md) - For one-time macOS VMs
- [NanoClaw Architecture](./ARCHITECTURE.md)
- [Container Runner](../src/container-runner.ts)
- [Vibe Runner](../src/vibe-runner.ts)

---

**Version**: 1.0
**Last Updated**: 2026-02-07
