# NanoClaw Documentation Index

Complete documentation for NanoClaw - your personal, containerized Claude assistant.

---

## 📚 Documentation Overview

| Document | Purpose | Audience |
|----------|---------|----------|
| [README](../README.md) | Project overview and quick start | Everyone |
| [ARCHITECTURE](./ARCHITECTURE.md) | System design and data flow | Developers, Contributors |
| [DEVELOPER_GUIDE](./DEVELOPER_GUIDE.md) | Development workflows and tutorials | Developers |
| [API](./API.md) | Function signatures and interfaces | Developers, Advanced Users |
| [TROUBLESHOOTING](./TROUBLESHOOTING.md) | Common issues and solutions | Users, Operators |
| [SECURITY](./SECURITY.md) | Security model and best practices | Security Auditors, DevOps |
| [REQUIREMENTS](./REQUIREMENTS.md) | Design decisions and philosophy | Contributors, Architects |
| [SPEC](./SPEC.md) | Detailed technical specification | Developers, Integrators |

---

## 🚀 Getting Started

**New to NanoClaw?** Start here:

1. **[README](../README.md)** - Understand the philosophy and setup
2. **[Quick Start Guide](#quick-start-guide)** (below) - Get running in 10 minutes
3. **[TROUBLESHOOTING](./TROUBLESHOOTING.md)** - If you hit issues

**Want to extend NanoClaw?**

1. **[ARCHITECTURE](./ARCHITECTURE.md)** - Understand how it works
2. **[DEVELOPER_GUIDE](./DEVELOPER_GUIDE.md)** - Learn development workflows
3. **[API](./API.md)** - Reference for functions and types

**Building integrations?**

1. **[SPEC](./SPEC.md)** - Complete technical specification
2. **[API](./API.md)** - Integration points and interfaces
3. **[SECURITY](./SECURITY.md)** - Security considerations

---

## Quick Start Guide

### Prerequisites

- macOS or Linux
- Node.js 20+
- [Claude Code](https://claude.ai/download)
- Apple Container (macOS) or Docker (Linux)

### Installation

```bash
# 1. Clone repository
git clone https://github.com/gavrielc/nanoclaw.git
cd nanoclaw

# 2. Install dependencies
npm install

# 3. Run setup via Claude Code
claude
# Then in Claude Code: /setup
```

The `/setup` skill will guide you through:
- WhatsApp authentication
- Container image build
- Service configuration
- First group registration

### First Steps

1. **Authenticate WhatsApp**: Scan QR code when prompted
2. **Register your first group**: From self-chat, send `@Andy add group "Family Chat"`
3. **Test the bot**: Send `@Andy hello` in the registered group
4. **Schedule a task**: `@Andy remind me every Monday at 9am to review tasks`

### Learn More

- **Architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Customization**: Run `/customize` skill in Claude Code
- **Debugging**: Run `/debug` skill in Claude Code

---

## 📖 Document Summaries

### [README.md](../README.md)

**What it covers**:
- Project philosophy ("small enough to understand")
- Core features and capabilities
- Quick start instructions
- Comparison with OpenClaw
- Contributing guidelines (skills over features)

**When to read**: First document to read. Essential for understanding "why NanoClaw exists".

---

### [ARCHITECTURE.md](./ARCHITECTURE.md)

**What it covers**:
- System architecture diagrams
- Complete file structure
- Core module deep-dives:
  - Main application (message routing)
  - Container runner (isolation)
  - Database (persistence)
  - IPC system (container ↔ host communication)
  - Task scheduler (cron/interval/once)
- Security model (4-layer isolation)
- Technology stack
- Message flow examples
- Key design decisions

**When to read**:
- Understanding how NanoClaw works internally
- Contributing features or fixes
- Debugging complex issues
- Security auditing

**Key sections**:
- [System Architecture](./ARCHITECTURE.md#system-architecture) - Visual overview
- [Core Modules](./ARCHITECTURE.md#core-modules) - Deep technical dives
- [Security Model](./ARCHITECTURE.md#security-model) - Isolation and permissions

---

### [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)

**What it covers**:
- Development environment setup
- Running locally (dev and production modes)
- Understanding code flow (step-by-step traces)
- Debugging techniques
- Writing skills (skill file format and examples)
- Adding new features:
  - New message channels
  - New MCP tools
  - New integrations
- Testing workflows
- Common issues and solutions
- Performance tips

**When to read**:
- Setting up development environment
- Making your first contribution
- Adding a new integration
- Debugging issues locally

**Key sections**:
- [Understanding the Code Flow](./DEVELOPER_GUIDE.md#understanding-the-code-flow) - Trace execution
- [Writing Skills](./DEVELOPER_GUIDE.md#writing-skills) - Contribute via skills
- [Adding New Features](./DEVELOPER_GUIDE.md#adding-new-features) - Extension patterns

---

### [API.md](./API.md)

**What it covers**:
- Complete API reference for all modules:
  - Database API (queries, mutations)
  - Container Runner API (spawning agents)
  - IPC API (MCP tools available in containers)
  - Task Scheduler API
  - Channel APIs (WhatsApp, Discord)
- Type definitions (TypeScript interfaces)
- Configuration reference
- Error handling patterns
- Performance considerations
- Migration guide

**When to read**:
- Integrating with NanoClaw programmatically
- Understanding function signatures
- Writing tests
- Extending core modules

**Key sections**:
- [IPC API](./API.md#ipc-api) - Tools available inside containers
- [Type Definitions](./API.md#type-definitions) - Core data structures
- [Configuration Reference](./API.md#configuration-reference) - All environment variables

---

### [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

**What it covers**:
- Installation issues
- WhatsApp issues (connection, authentication)
- Discord issues (bot permissions, intents)
- Container issues (exit codes, timeouts, mounts)
- Session issues (context not continuing)
- Task scheduler issues (tasks not running)
- IPC issues (stuck files, authorization)
- Performance issues (CPU, memory, slow processing)
- Debug techniques (logging, database queries, tracing)

**When to read**:
- Something isn't working
- Performance problems
- Before asking for help (check common issues first)

**Key sections**:
- [Container Issues](./TROUBLESHOOTING.md#container-issues) - Most common problems
- [Debug Techniques](./TROUBLESHOOTING.md#debug-techniques) - How to diagnose
- [Quick Reference](./TROUBLESHOOTING.md#quick-reference) - Common commands

---

### [SECURITY.md](./SECURITY.md)

**What it covers**:
- Security model overview
- Container isolation (filesystem, process, network)
- Cross-group isolation
- Privilege tiers (main vs. other groups)
- Mount security (allowlist system)
- Threat model and mitigations
- Best practices
- Attack scenarios and defenses

**When to read**:
- Security auditing
- Understanding isolation guarantees
- Configuring mount allowlists
- Deploying in production

**Key sections**:
- [Container Isolation](./SECURITY.md#container-isolation) - Security boundaries
- [Threat Model](./SECURITY.md#threat-model) - What we protect against
- [Best Practices](./SECURITY.md#best-practices) - Secure configuration

---

### [REQUIREMENTS.md](./REQUIREMENTS.md)

**What it covers**:
- Why NanoClaw exists (OpenClaw critique)
- Design philosophy:
  - Small enough to understand
  - Security through isolation
  - Built for one user
  - Customization = code changes
  - AI-native development
  - Skills over features
- Vision and goals
- Architecture decisions (why file-based IPC, why SQLite, etc.)
- Integration points
- Request for Skills (RFS) - contribution ideas

**When to read**:
- Understanding project philosophy
- Contributing skills or features
- Deciding if NanoClaw fits your needs
- Architectural discussions

---

### [SPEC.md](./SPEC.md)

**What it covers**:
- Complete technical specification
- Folder structure (detailed)
- Configuration (all options)
- Memory system (hierarchical CLAUDE.md files)
- Session management
- Message flow (detailed diagrams)
- Commands reference
- Scheduled tasks (types, modes, management)
- MCP servers (nanoclaw server tools)
- Deployment (launchd, service management)
- Security considerations
- Troubleshooting

**When to read**:
- Building compatible tools
- Deep understanding of all features
- Reference for exact behavior
- Deployment planning

---

## 🔍 Finding Information

### By Task

| I want to... | Read... |
|--------------|---------|
| Understand what NanoClaw is | [README](../README.md) |
| Install and run NanoClaw | [README Quick Start](../README.md#quick-start), [SPEC Deployment](./SPEC.md#deployment) |
| Understand how it works | [ARCHITECTURE](./ARCHITECTURE.md) |
| Set up development environment | [DEVELOPER_GUIDE Setup](./DEVELOPER_GUIDE.md#development-setup) |
| Add a new integration | [DEVELOPER_GUIDE Adding Features](./DEVELOPER_GUIDE.md#adding-new-features) |
| Write a skill | [DEVELOPER_GUIDE Writing Skills](./DEVELOPER_GUIDE.md#writing-skills) |
| Look up a function | [API Reference](./API.md) |
| Fix a problem | [TROUBLESHOOTING](./TROUBLESHOOTING.md) |
| Understand security model | [SECURITY](./SECURITY.md) |
| Understand design decisions | [REQUIREMENTS](./REQUIREMENTS.md) |
| Get exact specification | [SPEC](./SPEC.md) |

### By Component

| Component | Documents |
|-----------|-----------|
| **WhatsApp** | [SPEC Message Flow](./SPEC.md#message-flow), [TROUBLESHOOTING WhatsApp Issues](./TROUBLESHOOTING.md#whatsapp-issues) |
| **Discord** | [API Channel APIs](./API.md#channel-apis), [TROUBLESHOOTING Discord Issues](./TROUBLESHOOTING.md#discord-issues) |
| **Containers** | [ARCHITECTURE Container Runner](./ARCHITECTURE.md#2-container-runner-srccontainer-runnerts), [TROUBLESHOOTING Container Issues](./TROUBLESHOOTING.md#container-issues) |
| **Database** | [API Database API](./API.md#database-api), [ARCHITECTURE Database](./ARCHITECTURE.md#3-database-srcdbts) |
| **IPC** | [API IPC API](./API.md#ipc-api), [ARCHITECTURE IPC System](./ARCHITECTURE.md#4-ipc-system-containeragent-runnersrcipc-mcpts) |
| **Scheduler** | [API Task Scheduler API](./API.md#task-scheduler-api), [SPEC Scheduled Tasks](./SPEC.md#scheduled-tasks) |
| **Sessions** | [SPEC Session Management](./SPEC.md#session-management), [TROUBLESHOOTING Session Issues](./TROUBLESHOOTING.md#session-issues) |
| **Security** | [SECURITY](./SECURITY.md), [ARCHITECTURE Security Model](./ARCHITECTURE.md#security-model) |

### By Role

**End User**:
1. [README](../README.md) - What is NanoClaw?
2. [Quick Start Guide](#quick-start-guide) - Get running
3. [TROUBLESHOOTING](./TROUBLESHOOTING.md) - Fix issues

**Developer**:
1. [ARCHITECTURE](./ARCHITECTURE.md) - How it works
2. [DEVELOPER_GUIDE](./DEVELOPER_GUIDE.md) - Development workflows
3. [API](./API.md) - Function reference

**Contributor**:
1. [REQUIREMENTS](./REQUIREMENTS.md) - Philosophy
2. [DEVELOPER_GUIDE Writing Skills](./DEVELOPER_GUIDE.md#writing-skills) - Skill format
3. [CONTRIBUTING](../CONTRIBUTING.md) - Contribution guidelines

**Security Auditor**:
1. [SECURITY](./SECURITY.md) - Security model
2. [ARCHITECTURE Security Model](./ARCHITECTURE.md#security-model) - Implementation
3. [SPEC Security Considerations](./SPEC.md#security-considerations) - Detailed spec

**DevOps/SRE**:
1. [SPEC Deployment](./SPEC.md#deployment) - Service management
2. [TROUBLESHOOTING](./TROUBLESHOOTING.md) - Operations guide
3. [API Configuration Reference](./API.md#configuration-reference) - All settings

---

## 🛠️ Common Workflows

### Contributing a Skill

1. Read [REQUIREMENTS](./REQUIREMENTS.md) - Understand "skills over features"
2. Read [DEVELOPER_GUIDE Writing Skills](./DEVELOPER_GUIDE.md#writing-skills)
3. Create `.claude/skills/your-skill/SKILL.md`
4. Test with Claude Code
5. Submit PR

### Adding a New Channel

1. Read [ARCHITECTURE Channel Pattern](./ARCHITECTURE.md#unique-features)
2. Read [DEVELOPER_GUIDE Adding Features](./DEVELOPER_GUIDE.md#adding-a-new-message-channel)
3. Create `src/your-channel.ts`
4. Integrate in `src/index.ts`
5. Test and document

### Debugging an Issue

1. Check [TROUBLESHOOTING](./TROUBLESHOOTING.md) for common issues
2. Enable debug logging (see [DEVELOPER_GUIDE Debug Techniques](./DEVELOPER_GUIDE.md#debug-techniques))
3. Trace through [ARCHITECTURE Message Flow](./ARCHITECTURE.md#message-flow-example)
4. Check [API Error Handling](./API.md#error-handling)
5. Run `/debug` skill in Claude Code

### Security Review

1. Read [SECURITY](./SECURITY.md) - Complete security model
2. Review [ARCHITECTURE Security Model](./ARCHITECTURE.md#security-model)
3. Check mount allowlist configuration
4. Audit registered groups and permissions
5. Review container logs for unauthorized attempts

---

## 📝 Documentation Standards

### Updating Documentation

When making changes:

1. **Code changes** → Update API.md if signatures change
2. **New features** → Update ARCHITECTURE.md and DEVELOPER_GUIDE.md
3. **Configuration** → Update API.md Configuration Reference
4. **Common issues** → Add to TROUBLESHOOTING.md
5. **Design decisions** → Document in REQUIREMENTS.md or ARCHITECTURE.md

### Writing Style

- **Be concise**: Short sentences, active voice
- **Be specific**: Exact file paths, line numbers, commands
- **Be practical**: Real examples, not theoretical
- **Be current**: Update outdated information immediately

---

## 🤝 Getting Help

1. **Read Documentation**: Start with [README](../README.md)
2. **Check Troubleshooting**: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
3. **Run Debug Skill**: `claude` then `/debug`
4. **Search Issues**: [GitHub Issues](https://github.com/gavrielc/nanoclaw/issues)
5. **Ask Questions**: [GitHub Discussions](https://github.com/gavrielc/nanoclaw/discussions)

---

## 📦 Additional Resources

- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines
- [CLAUDE.md](../CLAUDE.md) - Project context for Claude Code
- [CAPABILITIES.md](../CAPABILITIES.md) - Feature overview
- Skills in `.claude/skills/` - Guided workflows for common tasks

---

## 🔄 Document Change Log

| Date | Document | Changes |
|------|----------|---------|
| 2024-02-06 | All | Initial comprehensive documentation created |

---

**Remember**: NanoClaw is designed to be understood. When in doubt, read the source code - it's small enough to comprehend in under an hour.

For questions, improvements, or corrections to this documentation, please open an issue or pull request.
