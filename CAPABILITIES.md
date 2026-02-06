# Nanoclaw Capabilities

Nanoclaw is a powerful, multi-platform AI agent runtime environment that acts as your personal, programmable super-assistant. Following the merge of Gunabot features, it now combines robust cross-platform messaging with flexible AI execution strategies.

## 1. Multi-Platform Connectivity

Nanoclaw acts as a unified presence across multiple communication channels, maintaining a shared identity and memory context.

*   **WhatsApp**:
    *   Full support for direct messages and group chats.
    *   **Voice Transcription**: Automatically transcribes voice notes using OpenAI Whisper, allowing the agent to read and reply to audio messages.
*   **Discord**:
    *   Operates as a Discord Bot in servers and DMs.
    *   Supports channel-based isolation and permission management.
*   **X (Twitter)**:
    *   Capabilities to post tweets, reply, like, and quote.
    *   Useful for social media management and automated content sharing.

## 2. Flexible AI Runtimes ("The Brain")

Nanoclaw allows you to switch between different execution engines based on the complexity and security requirements of the task.

*   **Claude Agent SDK (Default)**:
    *   **Full Capability**: Can read/write files, execute terminal commands, search the web, and use tools.
    *   **Secure**: Runs inside isolated environments (Apple Container or Docker) to prevent system-wide damage.
    *   **Best for**: Complex coding tasks, research, system administration, and multi-step workflows.
*   **Codex CLI**:
    *   **Lightweight**: A faster, lower-overhead executor for simple commands and scripts.
    *   **Best for**: Quick queries, simple calculations, or tasks where full agent overhead is unnecessary.

## 3. Task Execution & Automation

Nanoclaw is designed to *do* things, not just talk.

*   **System Operations**: Execute Shell/Linux commands to manage servers, check status, or deploy applications.
*   **File Management**: Create, read, edit, and organize files within its workspace.
*   **Web Capabilities**: Browse the web, fetch pages, and perform research (via MCP tools).
*   **Task Scheduler**:
    *   Built-in Cron scheduler for recurring tasks (e.g., "Check server status every morning").
    *   Supports one-off reminders and delayed execution.
*   **Parallel Processing**: Handles multiple requests and tasks simultaneously without blocking.

## 4. Architecture & Security

*   **Group Isolation**: Every group chat or channel has its own isolated filesystem workspace and memory. Information does not leak between contexts.
*   **IPC (Inter-Process Communication)**: A secure mechanism allowing distinct groups or tasks to communicate.
    *   *Example*: A monitoring task in a "Server Admin" group can send an alert to a "General" group via IPC.
*   **Docker & Linux Support**: Fully containerized deployment support for easy hosting on any Linux server.

## Summary

Nanoclaw is your **Personal AI Operating System**. Whether acting as a coding partner, a server admin, a social media manager, or a personal secretary, it provides a unified, programmable interface to your digital life.
