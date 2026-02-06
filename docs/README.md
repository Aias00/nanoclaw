# NanoClaw Documentation

Welcome to the NanoClaw documentation!

## Quick Navigation

- **[Documentation Index](INDEX.md)** - Start here for a complete overview
- **[Architecture](ARCHITECTURE.md)** - How NanoClaw works
- **[Developer Guide](DEVELOPER_GUIDE.md)** - Build and extend
- **[API Reference](API.md)** - Function signatures
- **[Troubleshooting](TROUBLESHOOTING.md)** - Fix issues
- **[Security](SECURITY.md)** - Security model
- **[Requirements](REQUIREMENTS.md)** - Design philosophy
- **[Specification](SPEC.md)** - Complete spec

## Getting Started

### I'm New to NanoClaw

1. Read the main [README](../README.md) to understand what NanoClaw is
2. Follow the [Quick Start Guide](INDEX.md#quick-start-guide) to install
3. Check [Troubleshooting](TROUBLESHOOTING.md) if you hit issues

### I Want to Contribute

1. Read [Requirements](REQUIREMENTS.md) to understand the philosophy
2. Read [Developer Guide - Writing Skills](DEVELOPER_GUIDE.md#writing-skills)
3. See [Contributing Guide](../CONTRIBUTING.md)

### I'm Building an Integration

1. Read [Architecture](ARCHITECTURE.md) to understand the system
2. Read [API Reference](API.md) for integration points
3. See [Developer Guide - Adding Features](DEVELOPER_GUIDE.md#adding-new-features)

### I'm Debugging

1. Check [Troubleshooting](TROUBLESHOOTING.md) for common issues
2. Run the `/debug` skill in Claude Code
3. Enable debug logging (see [Developer Guide](DEVELOPER_GUIDE.md#enable-debug-logging))

### I'm Auditing Security

1. Read [Security](SECURITY.md) for the security model
2. Review [Architecture - Security Model](ARCHITECTURE.md#security-model)
3. Check mount allowlist configuration

## Document Summaries

| Document | What It Covers |
|----------|----------------|
| **[INDEX](INDEX.md)** | Documentation overview, guides by role, finding information |
| **[ARCHITECTURE](ARCHITECTURE.md)** | System design, module deep-dives, data flow, design decisions |
| **[DEVELOPER_GUIDE](DEVELOPER_GUIDE.md)** | Setup, workflows, writing skills, adding features, testing |
| **[API](API.md)** | Function signatures, types, configuration, error handling |
| **[TROUBLESHOOTING](TROUBLESHOOTING.md)** | Common issues, debug techniques, quick reference |
| **[SECURITY](SECURITY.md)** | Isolation model, threat analysis, best practices |
| **[REQUIREMENTS](REQUIREMENTS.md)** | Philosophy, vision, architectural decisions |
| **[SPEC](SPEC.md)** | Complete technical specification, all features |

## By Topic

### Installation & Setup
- [Quick Start Guide](INDEX.md#quick-start-guide)
- [Installation Issues](TROUBLESHOOTING.md#installation-issues)
- [Development Setup](DEVELOPER_GUIDE.md#development-setup)

### Architecture & Design
- [System Architecture](ARCHITECTURE.md#system-architecture)
- [Core Modules](ARCHITECTURE.md#core-modules)
- [Design Decisions](ARCHITECTURE.md#key-design-decisions)
- [Philosophy](REQUIREMENTS.md#philosophy)

### Development
- [Running Locally](DEVELOPER_GUIDE.md#running-locally)
- [Understanding Code Flow](DEVELOPER_GUIDE.md#understanding-the-code-flow)
- [Adding Features](DEVELOPER_GUIDE.md#adding-new-features)
- [Writing Skills](DEVELOPER_GUIDE.md#writing-skills)

### API & Integration
- [Database API](API.md#database-api)
- [Container Runner API](API.md#container-runner-api)
- [IPC API](API.md#ipc-api)
- [Channel APIs](API.md#channel-apis)

### Operations
- [Deployment](SPEC.md#deployment)
- [Service Management](SPEC.md#managing-the-service)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Performance Tips](DEVELOPER_GUIDE.md#performance-tips)

### Security
- [Security Model](SECURITY.md)
- [Container Isolation](ARCHITECTURE.md#1-container-isolation)
- [Mount Security](ARCHITECTURE.md#4-mount-security)
- [Best Practices](SECURITY.md#best-practices)

## Need Help?

1. **Search the docs**: Use your browser's search (Cmd/Ctrl+F)
2. **Check [INDEX](INDEX.md)**: Organized by task and role
3. **Run `/debug`**: In Claude Code for automated diagnostics
4. **GitHub Issues**: [Report bugs or ask questions](https://github.com/gavrielc/nanoclaw/issues)

---

**Remember**: NanoClaw is designed to be understood. When documentation isn't enough, read the source code - it's small enough to comprehend in under an hour.
