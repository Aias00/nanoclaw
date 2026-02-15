#!/bin/bash

# Prepare Tart base image for NanoClaw
# This script pulls the macOS image and installs required tools

set -euo pipefail

BASE_IMAGE="ghcr.io/cirruslabs/macos-tahoe-xcode:latest"
PREPARED_IMAGE_NAME="tart_nanoclaw_base"
RUNNER_USERNAME="admin"
RUNNER_PASSWORD="admin"
RUNNER_IP=""

echo "[*] NanoClaw Tart Base Image Preparation"
echo "[*] ======================================="

# Check dependencies
check_dependencies() {
    if ! command -v tart &>/dev/null; then
        echo "[-] tart could not be found"
        echo "[!] Install with: brew install cirruslabs/cli/tart"
        exit 1
    fi

    if ! command -v sshpass &>/dev/null; then
        echo "[-] sshpass could not be found"
        echo "[!] Install with: brew install hudochenkov/sshpass/sshpass"
        exit 1
    fi

    echo "[+] Dependencies OK"
}

# Pull base image
pull_base_image() {
    if tart list | grep -q "^$BASE_IMAGE"; then
        echo "[*] Base image already exists: $BASE_IMAGE"
    else
        echo "[*] Pulling base image: $BASE_IMAGE"
        tart pull "$BASE_IMAGE"
    fi
}

# Clone to prepared image
clone_image() {
    if tart list | grep -q "^$PREPARED_IMAGE_NAME"; then
        echo "[!] Prepared image already exists: $PREPARED_IMAGE_NAME"
        read -p "Delete and recreate? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "[*] Deleting existing image..."
            tart delete "$PREPARED_IMAGE_NAME"
        else
            echo "[*] Using existing image"
            return
        fi
    fi

    echo "[*] Cloning base image to: $PREPARED_IMAGE_NAME"
    tart clone "$BASE_IMAGE" "$PREPARED_IMAGE_NAME"
}

# Start VM and wait for SSH
start_vm() {
    echo "[*] Starting VM: $PREPARED_IMAGE_NAME"
    tart run "$PREPARED_IMAGE_NAME" --no-audio --no-clipboard &

    echo "[*] Waiting for VM to boot..."
    local BOOT_ATTEMPTS=0
    while [ -z "$RUNNER_IP" ] && [ $BOOT_ATTEMPTS -lt 30 ]; do
        sleep 2
        echo -n "."
        BOOT_ATTEMPTS=$((BOOT_ATTEMPTS + 1))
        RUNNER_IP=$(tart ip "$PREPARED_IMAGE_NAME" 2>/dev/null || true)
    done
    echo

    if [ -z "$RUNNER_IP" ]; then
        echo "[-] Failed to get IP address"
        exit 1
    fi

    echo "[+] VM IP: $RUNNER_IP"

    # Wait for SSH
    echo "[*] Waiting for SSH connectivity..."
    while [ $BOOT_ATTEMPTS -lt 60 ]; do
        if sshpass -p "$RUNNER_PASSWORD" ssh -o StrictHostKeyChecking=no \
            -o UserKnownHostsFile=/dev/null \
            -o PreferredAuthentications=password \
            -o ConnectTimeout=5 \
            "$RUNNER_USERNAME@$RUNNER_IP" "echo hello" &>/dev/null; then
            echo "[+] SSH connectivity established"
            break
        fi
        echo -n "."
        sleep 2
        BOOT_ATTEMPTS=$((BOOT_ATTEMPTS + 1))
    done
    echo

    if [ $BOOT_ATTEMPTS -ge 60 ]; then
        echo "[-] Failed to establish SSH connectivity"
        exit 1
    fi
}

# Execute command on VM
execute_vm() {
    local CMD="$1"
    echo "[*] Executing: $CMD"
    sshpass -p "$RUNNER_PASSWORD" ssh -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        -o PreferredAuthentications=password \
        -t "$RUNNER_USERNAME@$RUNNER_IP" \
        "source ~/.zshenv 2>/dev/null; $CMD"
}

# Install tools on VM
install_tools() {
    echo "[*] Installing development tools..."

    # Ensure PATH is set correctly
    execute_vm "cat >> ~/.zshenv << 'EOF'
export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:\$PATH
export PATH=\$HOME/.local/bin:\$PATH
export PNPM_HOME=\$HOME/Library/pnpm
export PATH=\$PNPM_HOME:\$PATH
EOF"

    # Source environment
    execute_vm "source ~/.zshenv"

    # Install Homebrew packages
    echo "[*] Installing Homebrew packages..."
    execute_vm "brew update" || true
    execute_vm "brew install git curl wget htop vim nano jq yq coreutils python@3.13 node || true"

    # Install pnpm for Node packages
    echo "[*] Installing pnpm..."
    execute_vm "npm install -g pnpm || true"

    # Install uv for Python packages
    echo "[*] Installing uv..."
    execute_vm "curl -LsSf https://astral.sh/uv/install.sh | sh" || true
    execute_vm "source ~/.zshenv"

    # Install Claude Code
    echo "[*] Installing Claude Code..."
    execute_vm "curl -fsSL https://claude.ai/install.sh | sh" || true

    # Install OpenCode
    echo "[*] Installing OpenCode..."
    execute_vm "curl -fsSL https://opencode.ai/install | sh" || true

    # Install Codex via pnpm
    echo "[*] Installing Codex..."
    execute_vm "pnpm add -g @openai/codex || true"

    # Install Gemini CLI via pnpm
    echo "[*] Installing Gemini CLI..."
    execute_vm "pnpm add -g @google/gemini-cli || true"

    # Install Kimi CLI via uv
    echo "[*] Installing Kimi CLI..."
    execute_vm "uv tool install kimi-cli || true"

    echo "[+] Tool installation completed"
}

# Stop and save VM
stop_vm() {
    echo "[*] Stopping VM..."
    tart stop "$PREPARED_IMAGE_NAME"
    echo "[+] VM stopped and saved"
}

# Main execution
main() {
    check_dependencies
    pull_base_image
    clone_image

    # Only proceed if we created or want to update the image
    if tart list | grep -q "^$PREPARED_IMAGE_NAME"; then
        start_vm
        install_tools
        stop_vm

        echo
        echo "[+] ====================================="
        echo "[+] Base image preparation completed!"
        echo "[+] Image name: $PREPARED_IMAGE_NAME"
        echo "[+] ====================================="
        echo
        echo "[*] You can now use Tart runtime in NanoClaw by setting:"
        echo "    CONTAINER_RUNTIME=tart"
        echo
    fi
}

main
