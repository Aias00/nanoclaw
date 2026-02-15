#!/bin/bash

# Prepare Vibe base image for NanoClaw
# This script creates a Linux VM image with required tools

set -euo pipefail

VIBE_IMAGES_DIR="${VIBE_IMAGES_DIR:-./data/vibe-images}"
BASE_IMAGE_NAME="base.raw"
BASE_IMAGE_PATH="$VIBE_IMAGES_DIR/$BASE_IMAGE_NAME"

# Disk size for VM (3GB)
DISK_SIZE_MB=3072

echo "[*] NanoClaw Vibe Base Image Preparation"
echo "[*] ======================================"

# Check dependencies
check_dependencies() {
    if ! command -v vibe &>/dev/null; then
        echo "[-] vibe could not be found"
        echo "[!] Install from: https://github.com/lynaghk/vibe/"
        exit 1
    fi

    echo "[+] Vibe version:"
    vibe --version || true
    echo ""
}

# Create base image
create_base_image() {
    mkdir -p "$VIBE_IMAGES_DIR"

    if [ -f "$BASE_IMAGE_PATH" ]; then
        echo "[!] Base image already exists: $BASE_IMAGE_PATH"
        read -p "Delete and recreate? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "[*] Deleting existing image..."
            rm -f "$BASE_IMAGE_PATH"
        else
            echo "[*] Using existing image"
            return
        fi
    fi

    echo "[*] Creating base image: $BASE_IMAGE_PATH"
    echo "[*] Size: ${DISK_SIZE_MB}MB"

    # Create empty disk image
    dd if=/dev/zero of="$BASE_IMAGE_PATH" bs=1m count=$DISK_SIZE_MB

    echo "[+] Base image created"
}

# Bootstrap VM with basic tools
bootstrap_vm() {
    echo "[*] Bootstrapping VM with tools..."

    # Create setup script
    local SETUP_SCRIPT="/tmp/vibe-setup-$$.sh"

    cat > "$SETUP_SCRIPT" << 'SETUP_EOF'
#!/bin/bash
set -e

echo "[VM] Starting system setup..."

# Update package lists
apt-get update -qq

# Install basic tools
echo "[VM] Installing basic tools..."
apt-get install -y -qq \
    curl \
    wget \
    git \
    vim \
    nano \
    jq \
    build-essential \
    python3 \
    python3-pip \
    nodejs \
    npm

# Install pnpm for Node packages
echo "[VM] Installing pnpm..."
npm install -g pnpm

# Install uv for Python packages
echo "[VM] Installing uv..."
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

# Install Claude Code
echo "[VM] Installing Claude Code..."
curl -fsSL https://claude.ai/install.sh | sh || true

# Install OpenCode
echo "[VM] Installing OpenCode..."
curl -fsSL https://opencode.ai/install | sh || true

# Install Codex via pnpm
echo "[VM] Installing Codex..."
pnpm add -g @openai/codex || true

# Install Gemini CLI via pnpm
echo "[VM] Installing Gemini CLI..."
pnpm add -g @google/gemini-cli || true

# Install Kimi CLI via uv
echo "[VM] Installing Kimi CLI..."
uv tool install kimi-cli || true

# Setup environment
echo "[VM] Configuring environment..."
cat >> ~/.bashrc << 'BASHRC_EOF'
# NanoClaw environment
export PATH=$HOME/.local/bin:$PATH
export PATH=$HOME/.cargo/bin:$PATH

# Prompt
PS1='\u@nanoclaw:\w\$ '
BASHRC_EOF

echo "[VM] Setup completed"
echo "NANOCLAW_SETUP_COMPLETE"
SETUP_EOF

    chmod +x "$SETUP_SCRIPT"

    # Run setup in VM
    echo "[*] Running setup script in VM..."
    echo "[*] This may take 10-15 minutes..."

    vibe \
        --cpus 2 \
        --ram 2048 \
        --script "$SETUP_SCRIPT" \
        --expect "NANOCLAW_SETUP_COMPLETE" 300 \
        "$BASE_IMAGE_PATH"

    local EXIT_CODE=$?

    # Cleanup
    rm -f "$SETUP_SCRIPT"

    if [ $EXIT_CODE -eq 0 ]; then
        echo "[+] VM setup completed successfully"
    else
        echo "[-] VM setup failed with exit code $EXIT_CODE"
        exit 1
    fi
}

# Test the VM
test_vm() {
    echo "[*] Testing VM..."

    # Create test script
    local TEST_SCRIPT="/tmp/vibe-test-$$.sh"

    cat > "$TEST_SCRIPT" << 'TEST_EOF'
#!/bin/bash
echo "NANOCLAW_TEST_START"
python3 --version
node --version
git --version
echo "NANOCLAW_TEST_END"
TEST_EOF

    chmod +x "$TEST_SCRIPT"

    vibe \
        --cpus 2 \
        --ram 2048 \
        --script "$TEST_SCRIPT" \
        --expect "NANOCLAW_TEST_END" 30 \
        "$BASE_IMAGE_PATH"

    local EXIT_CODE=$?
    rm -f "$TEST_SCRIPT"

    if [ $EXIT_CODE -eq 0 ]; then
        echo "[+] VM test passed"
    else
        echo "[-] VM test failed"
        exit 1
    fi
}

# Get image info
show_info() {
    echo ""
    echo "[+] ====================================="
    echo "[+] Base image preparation completed!"
    echo "[+] ====================================="
    echo ""
    echo "[*] Image location: $BASE_IMAGE_PATH"
    echo "[*] Image size: $(du -h "$BASE_IMAGE_PATH" | cut -f1)"
    echo ""
    echo "[*] You can now use Vibe runtime in NanoClaw by setting:"
    echo "    CONTAINER_RUNTIME=vibe"
    echo "    VIBE_BASE_IMAGE=$BASE_IMAGE_NAME"
    echo ""
}

# Main execution
main() {
    check_dependencies
    create_base_image
    bootstrap_vm
    test_vm
    show_info
}

main
