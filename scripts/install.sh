#!/bin/bash
#
# Signal Drift - Installation Script
#
# Builds from source and installs as a system service.
# Supports Linux (Debian, Fedora, Arch) and macOS.
# Re-run to update to the latest version.
#
# Usage:
#   curl -sSL <raw-script-url> | bash
#   # or
#   ./install.sh
#

set -e

# Configuration
# Use current directory if it's a git repo, otherwise clone to ~/signal-drift
if [ -d ".git" ]; then
    BUILD_DIR="${SIGNAL_DRIFT_BUILD_DIR:-$(pwd)}"
else
    BUILD_DIR="${SIGNAL_DRIFT_BUILD_DIR:-$HOME/signal-drift}"
fi
INSTALL_DIR="${SIGNAL_DRIFT_INSTALL_DIR:-/opt/signal-drift}"
DATA_DIR="${SIGNAL_DRIFT_DATA_DIR:-}"
SERVICE_NAME="signal-drift"
NODE_VERSION="20"
PORT="${SIGNAL_DRIFT_PORT:-3001}"
REPO_URL="${SIGNAL_DRIFT_REPO:-https://github.com/jvanderberg/signal-drift.git}"
BRANCH="${SIGNAL_DRIFT_BRANCH:-main}"

# Detect OS
OS="$(uname -s)"
ARCH="$(uname -m)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Set platform-specific defaults
setup_platform() {
    case "$OS" in
        Linux)
            PLATFORM="linux"
            # Default data directory
            if [ -z "$DATA_DIR" ]; then
                DATA_DIR="/var/lib/signal-drift"
            fi
            # Detect package manager
            if command -v apt-get &> /dev/null; then
                PKG_MANAGER="apt"
            elif command -v dnf &> /dev/null; then
                PKG_MANAGER="dnf"
            elif command -v pacman &> /dev/null; then
                PKG_MANAGER="pacman"
            else
                log_error "No supported package manager found (apt, dnf, pacman)"
                exit 1
            fi
            ;;
        Darwin)
            PLATFORM="macos"
            if [ -z "$DATA_DIR" ]; then
                DATA_DIR="$HOME/Library/Application Support/signal-drift"
            fi
            if [ -z "$SIGNAL_DRIFT_INSTALL_DIR" ]; then
                INSTALL_DIR="/usr/local/signal-drift"
            fi
            if ! command -v brew &> /dev/null; then
                log_error "Homebrew is required. Install from https://brew.sh"
                exit 1
            fi
            PKG_MANAGER="brew"
            ;;
        *)
            log_error "Unsupported OS: $OS"
            exit 1
            ;;
    esac

    log_info "Platform: $PLATFORM ($ARCH)"
    log_info "Package manager: $PKG_MANAGER"
}

# Install system dependencies
install_dependencies() {
    log_info "Installing system dependencies..."

    case "$PKG_MANAGER" in
        apt)
            sudo apt-get update
            sudo apt-get install -y \
                build-essential python3 git curl \
                libudev-dev libusb-1.0-0-dev sqlite3
            ;;
        dnf)
            sudo dnf install -y \
                gcc gcc-c++ make python3 git curl \
                libudev-devel libusb1-devel sqlite
            ;;
        pacman)
            sudo pacman -Sy --noconfirm \
                base-devel python git curl \
                libusb sqlite
            ;;
        brew)
            brew install git libusb sqlite
            # Xcode command line tools for native modules
            if ! xcode-select -p &> /dev/null; then
                log_info "Installing Xcode command line tools..."
                xcode-select --install || true
            fi
            ;;
    esac

    log_success "Dependencies installed"
}

# Install Node.js
install_nodejs() {
    log_info "Checking Node.js..."

    if command -v node &> /dev/null; then
        CURRENT_NODE=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$CURRENT_NODE" -ge 18 ]; then
            log_success "Node.js $(node -v) already installed"
            return
        fi
        log_warn "Node.js too old ($(node -v)), upgrading..."
    fi

    log_info "Installing Node.js $NODE_VERSION..."

    case "$PKG_MANAGER" in
        apt)
            curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        dnf)
            curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | sudo bash -
            sudo dnf install -y nodejs
            ;;
        pacman)
            sudo pacman -S --noconfirm nodejs npm
            ;;
        brew)
            brew install node@${NODE_VERSION}
            brew link --overwrite node@${NODE_VERSION} || true
            ;;
    esac

    log_success "Node.js $(node -v) installed"
}

# Setup device permissions (Linux only)
setup_device_permissions() {
    if [ "$PLATFORM" != "linux" ]; then
        return
    fi

    log_info "Setting up device permissions..."

    # Serial device access
    if ! groups "$USER" | grep -q dialout 2>/dev/null; then
        sudo usermod -aG dialout "$USER" 2>/dev/null || true
        log_info "Added $USER to dialout group"
        NEEDS_LOGOUT=true
    fi

    # Create udev rules for USB-TMC devices
    UDEV_RULES="/etc/udev/rules.d/99-usbtmc.rules"
    sudo tee "$UDEV_RULES" > /dev/null << 'EOF'
# USB-TMC (Test & Measurement Class) devices
SUBSYSTEM=="usb", ATTR{idVendor}=="1ab1", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{bInterfaceClass}=="fe", ATTR{bInterfaceSubClass}=="03", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="f4ec", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="0957", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="0699", MODE="0666", GROUP="plugdev"
EOF

    if ! groups "$USER" | grep -q plugdev 2>/dev/null; then
        sudo usermod -aG plugdev "$USER" 2>/dev/null || true
        NEEDS_LOGOUT=true
    fi

    sudo udevadm control --reload-rules 2>/dev/null || true
    sudo udevadm trigger 2>/dev/null || true

    log_success "Device permissions configured"
}

# Clone or update source
setup_source() {
    log_info "Setting up source code..."

    if [ -d "$BUILD_DIR/.git" ]; then
        log_info "Updating existing source..."
        cd "$BUILD_DIR"
        # Pull current branch (don't force switch branches)
        git pull
    else
        log_info "Cloning repository..."
        git clone --branch "$BRANCH" "$REPO_URL" "$BUILD_DIR"
        cd "$BUILD_DIR"
    fi

    log_success "Source ready"
}

# Build application
build_application() {
    log_info "Building application..."
    cd "$BUILD_DIR"

    npm ci

    log_info "Building client..."
    cd client && npm ci && cd ..

    log_info "Compiling TypeScript..."
    npm run build

    log_success "Build complete"
}

# Install to system directory
install_application() {
    log_info "Installing to $INSTALL_DIR..."

    # Stop existing service
    stop_service 2>/dev/null || true

    # Create install directory
    sudo mkdir -p "$INSTALL_DIR"

    # Copy production files
    sudo rm -rf "$INSTALL_DIR/dist" "$INSTALL_DIR/client" "$INSTALL_DIR/node_modules"
    sudo cp -r "$BUILD_DIR/dist" "$INSTALL_DIR/"
    sudo mkdir -p "$INSTALL_DIR/client"
    sudo cp -r "$BUILD_DIR/client/dist" "$INSTALL_DIR/client/"
    sudo cp -r "$BUILD_DIR/node_modules" "$INSTALL_DIR/"
    sudo cp "$BUILD_DIR/package.json" "$INSTALL_DIR/"
    sudo cp "$BUILD_DIR/package-lock.json" "$INSTALL_DIR/"

    # Rebuild native modules for this system's Node.js version
    log_info "Rebuilding native modules for Node $(node -v)..."
    cd "$INSTALL_DIR"
    sudo npm rebuild

    log_success "Installed"
}

# Setup data directory
setup_data_directory() {
    log_info "Setting up data directory..."

    if [ "$PLATFORM" = "macos" ]; then
        mkdir -p "$DATA_DIR"
    else
        sudo mkdir -p "$DATA_DIR"
        sudo chown "$USER:$USER" "$DATA_DIR"
    fi

    log_success "Data directory: $DATA_DIR"
}

# Create environment file
setup_environment() {
    ENV_FILE="$INSTALL_DIR/.env"

    if sudo test -f "$ENV_FILE" 2>/dev/null || test -f "$ENV_FILE" 2>/dev/null; then
        log_info "Keeping existing configuration"
        return
    fi

    log_info "Creating configuration..."

    if [ "$PLATFORM" = "macos" ]; then
        cat > "$ENV_FILE" << EOF
PORT=$PORT
SIGNAL_DRIFT_DATA_DIR=$DATA_DIR
POLL_INTERVAL=250
HISTORY_WINDOW=1800000
SCAN_INTERVAL=10000
EOF
    else
        sudo tee "$ENV_FILE" > /dev/null << EOF
PORT=$PORT
SIGNAL_DRIFT_DATA_DIR=$DATA_DIR
POLL_INTERVAL=250
HISTORY_WINDOW=1800000
SCAN_INTERVAL=10000
EOF
        sudo chmod 644 "$ENV_FILE"
    fi

    log_success "Configuration created"
}

# Create systemd service (Linux)
create_systemd_service() {
    log_info "Creating systemd service..."

    sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" > /dev/null << EOF
[Unit]
Description=Signal Drift - Lab Equipment Control
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node dist/server/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable "$SERVICE_NAME"

    log_success "Systemd service configured"
}

# Create launchd service (macOS)
create_launchd_service() {
    log_info "Creating launchd service..."

    PLIST_FILE="$HOME/Library/LaunchAgents/com.signaldrift.server.plist"
    mkdir -p "$HOME/Library/LaunchAgents"

    cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.signaldrift.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>$INSTALL_DIR/dist/server/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PORT</key>
        <string>$PORT</string>
        <key>SIGNAL_DRIFT_DATA_DIR</key>
        <string>$DATA_DIR</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/signal-drift.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/signal-drift.error.log</string>
</dict>
</plist>
EOF

    log_success "Launchd service configured"
}

# Stop service
stop_service() {
    if [ "$PLATFORM" = "macos" ]; then
        launchctl unload "$HOME/Library/LaunchAgents/com.signaldrift.server.plist" 2>/dev/null || true
    else
        sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    fi
}

# Start service
start_service() {
    log_info "Starting service..."

    if [ "$PLATFORM" = "macos" ]; then
        launchctl load "$HOME/Library/LaunchAgents/com.signaldrift.server.plist"
    else
        sudo systemctl start "$SERVICE_NAME"
    fi

    sleep 2

    if [ "$PLATFORM" = "macos" ]; then
        if launchctl list | grep -q "com.signaldrift.server"; then
            log_success "Service started"
        else
            log_error "Service failed to start. Check ~/Library/Logs/signal-drift.log"
            exit 1
        fi
    else
        if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
            log_success "Service started"
        else
            log_error "Service failed. Check: journalctl -u $SERVICE_NAME -f"
            exit 1
        fi
    fi
}

# Get IP address
get_ip_address() {
    if [ "$PLATFORM" = "macos" ]; then
        ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo ""
    else
        hostname -I 2>/dev/null | awk '{print $1}' || echo ""
    fi
}

# Print completion
print_completion() {
    IP=$(get_ip_address)

    echo ""
    echo "=============================================="
    log_success "Signal Drift installed!"
    echo "=============================================="
    echo ""
    echo "  Install:  $INSTALL_DIR"
    echo "  Data:     $DATA_DIR"
    echo "  Config:   $INSTALL_DIR/.env"
    echo ""
    echo "Web interface:"
    echo "  http://localhost:$PORT"
    [ -n "$IP" ] && echo "  http://$IP:$PORT"
    echo ""

    if [ "$PLATFORM" = "macos" ]; then
        echo "Commands:"
        echo "  Logs:      tail -f ~/Library/Logs/signal-drift.log"
        echo "  Restart:   launchctl unload ~/Library/LaunchAgents/com.signaldrift.server.plist && launchctl load ~/Library/LaunchAgents/com.signaldrift.server.plist"
        echo "  Stop:      launchctl unload ~/Library/LaunchAgents/com.signaldrift.server.plist"
    else
        echo "Commands:"
        echo "  Logs:      journalctl -u $SERVICE_NAME -f"
        echo "  Restart:   sudo systemctl restart $SERVICE_NAME"
        echo "  Stop:      sudo systemctl stop $SERVICE_NAME"
    fi
    echo "  Update:    $0"
    echo "  Uninstall: $0 --uninstall"
    echo ""

    if [ "$NEEDS_LOGOUT" = true ]; then
        echo -e "${YELLOW}NOTE: Log out and back in for USB/serial permissions.${NC}"
        echo ""
    fi
}

# Uninstall
uninstall() {
    log_info "Uninstalling Signal Drift..."

    stop_service 2>/dev/null || true

    if [ "$PLATFORM" = "macos" ]; then
        rm -f "$HOME/Library/LaunchAgents/com.signaldrift.server.plist"
    else
        sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
        sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
        sudo systemctl daemon-reload
        sudo rm -f "/etc/udev/rules.d/99-usbtmc.rules"
        sudo udevadm control --reload-rules 2>/dev/null || true
    fi

    sudo rm -rf "$INSTALL_DIR" 2>/dev/null || rm -rf "$INSTALL_DIR"

    log_success "Uninstalled"
    echo ""
    echo "Kept: $BUILD_DIR (source)"
    echo "Kept: $DATA_DIR (data)"
}

# Main
main() {
    echo ""
    echo "=============================================="
    echo "  Signal Drift - Installer"
    echo "=============================================="
    echo ""

    if [ "$1" = "--uninstall" ] || [ "$1" = "-u" ]; then
        setup_platform
        uninstall
        exit 0
    fi

    if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --uninstall, -u    Remove installation"
        echo "  --help, -h         Show help"
        echo ""
        echo "Environment variables:"
        echo "  SIGNAL_DRIFT_BUILD_DIR    Source directory (default: ~/signal-drift-src)"
        echo "  SIGNAL_DRIFT_INSTALL_DIR  Install directory (default: /opt/signal-drift)"
        echo "  SIGNAL_DRIFT_DATA_DIR     Data directory (platform default)"
        echo "  SIGNAL_DRIFT_PORT         Server port (default: 3001)"
        echo "  SIGNAL_DRIFT_REPO         Git repository URL"
        echo "  SIGNAL_DRIFT_BRANCH       Git branch (default: main)"
        echo ""
        echo "Re-run to update."
        exit 0
    fi

    NEEDS_LOGOUT=false

    setup_platform
    install_dependencies
    install_nodejs
    setup_device_permissions
    setup_source
    build_application
    install_application
    setup_data_directory
    setup_environment

    if [ "$PLATFORM" = "macos" ]; then
        create_launchd_service
    else
        create_systemd_service
    fi

    start_service
    print_completion
}

main "$@"
