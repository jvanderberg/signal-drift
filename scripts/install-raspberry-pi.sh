#!/bin/bash
#
# Lab Controller - Raspberry Pi Installation Script
#
# This script installs Lab Controller on a Raspberry Pi and configures it
# to run as a systemd service at boot.
#
# Usage:
#   curl -sSL <raw-script-url> | bash
#   # or
#   ./install-raspberry-pi.sh
#
# Requirements:
#   - Raspberry Pi OS (Debian-based)
#   - Internet connection
#   - sudo access
#

set -e

# Configuration
INSTALL_DIR="${LAB_CONTROLLER_INSTALL_DIR:-$HOME/lab-controller}"
DATA_DIR="${LAB_CONTROLLER_DATA_DIR:-/var/lib/lab-controller}"
SERVICE_NAME="lab-controller"
NODE_VERSION="20"
PORT="${LAB_CONTROLLER_PORT:-3001}"
REPO_URL="${LAB_CONTROLLER_REPO:-https://github.com/your-org/lab-controller.git}"
BRANCH="${LAB_CONTROLLER_BRANCH:-main}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running on Raspberry Pi / Debian-based system
check_system() {
    log_info "Checking system compatibility..."

    if ! command -v apt-get &> /dev/null; then
        log_error "This script requires apt-get (Debian-based system)"
        exit 1
    fi

    # Check architecture
    ARCH=$(uname -m)
    log_info "Detected architecture: $ARCH"

    if [[ "$ARCH" == "armv7l" ]] || [[ "$ARCH" == "aarch64" ]] || [[ "$ARCH" == "x86_64" ]]; then
        log_success "Architecture supported"
    else
        log_warn "Untested architecture: $ARCH - proceeding anyway"
    fi
}

# Install system dependencies
install_dependencies() {
    log_info "Installing system dependencies..."

    sudo apt-get update
    sudo apt-get install -y \
        build-essential \
        python3 \
        git \
        curl \
        libudev-dev \
        libusb-1.0-0-dev \
        sqlite3

    log_success "System dependencies installed"
}

# Install Node.js
install_nodejs() {
    log_info "Checking Node.js installation..."

    if command -v node &> /dev/null; then
        CURRENT_NODE=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$CURRENT_NODE" -ge 18 ]; then
            log_success "Node.js v$(node -v) already installed"
            return
        else
            log_warn "Node.js version too old (v$(node -v)), upgrading..."
        fi
    fi

    log_info "Installing Node.js $NODE_VERSION..."

    # Use NodeSource repository
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
    sudo apt-get install -y nodejs

    log_success "Node.js $(node -v) installed"
    log_info "npm version: $(npm -v)"
}

# Setup USB/serial device permissions
setup_device_permissions() {
    log_info "Setting up device permissions..."

    # Add user to dialout group for serial access
    if ! groups "$USER" | grep -q dialout; then
        sudo usermod -aG dialout "$USER"
        log_info "Added $USER to dialout group"
        NEEDS_LOGOUT=true
    else
        log_info "User already in dialout group"
    fi

    # Create udev rules for USB-TMC devices (Rigol, etc.)
    UDEV_RULES="/etc/udev/rules.d/99-usbtmc.rules"
    log_info "Creating udev rules at $UDEV_RULES..."

    sudo tee "$UDEV_RULES" > /dev/null << 'EOF'
# USB-TMC (Test & Measurement Class) devices
# Allow non-root access to USB-TMC devices

# Rigol devices (Vendor ID: 1ab1)
SUBSYSTEM=="usb", ATTR{idVendor}=="1ab1", MODE="0666", GROUP="plugdev"

# Generic USB-TMC class devices
SUBSYSTEM=="usb", ATTR{bInterfaceClass}=="fe", ATTR{bInterfaceSubClass}=="03", MODE="0666", GROUP="plugdev"

# Siglent devices (Vendor ID: f4ec)
SUBSYSTEM=="usb", ATTR{idVendor}=="f4ec", MODE="0666", GROUP="plugdev"

# Keysight/Agilent devices (Vendor ID: 0957)
SUBSYSTEM=="usb", ATTR{idVendor}=="0957", MODE="0666", GROUP="plugdev"

# Tektronix devices (Vendor ID: 0699)
SUBSYSTEM=="usb", ATTR{idVendor}=="0699", MODE="0666", GROUP="plugdev"
EOF

    # Add user to plugdev group
    if ! groups "$USER" | grep -q plugdev; then
        sudo usermod -aG plugdev "$USER"
        log_info "Added $USER to plugdev group"
        NEEDS_LOGOUT=true
    fi

    # Reload udev rules
    sudo udevadm control --reload-rules
    sudo udevadm trigger

    log_success "Device permissions configured"
}

# Clone or update repository
setup_repository() {
    log_info "Setting up application..."

    if [ -d "$INSTALL_DIR" ]; then
        log_info "Directory exists, updating..."
        cd "$INSTALL_DIR"
        git fetch origin
        git checkout "$BRANCH"
        git pull origin "$BRANCH"
    else
        log_info "Cloning repository to $INSTALL_DIR..."
        git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi

    log_success "Repository ready at $INSTALL_DIR"
}

# Install npm dependencies and build
build_application() {
    log_info "Installing npm dependencies..."
    cd "$INSTALL_DIR"

    # Install root dependencies
    npm ci --ignore-scripts

    # Rebuild native modules from source (important for ARM)
    log_info "Building native modules (this may take a few minutes on Pi)..."
    npm rebuild better-sqlite3 serialport usb --build-from-source

    # Install client dependencies
    log_info "Installing client dependencies..."
    cd client
    npm ci
    cd ..

    # Build for production
    log_info "Building application..."
    npm run build

    log_success "Application built successfully"
}

# Create data directory
setup_data_directory() {
    log_info "Setting up data directory at $DATA_DIR..."

    sudo mkdir -p "$DATA_DIR"
    sudo chown "$USER:$USER" "$DATA_DIR"

    log_success "Data directory ready"
}

# Create environment file
setup_environment() {
    log_info "Creating environment configuration..."

    ENV_FILE="$INSTALL_DIR/.env"

    if [ -f "$ENV_FILE" ]; then
        log_info "Environment file exists, keeping current configuration"
    else
        cat > "$ENV_FILE" << EOF
# Lab Controller Configuration
# Generated by install-raspberry-pi.sh

PORT=$PORT
LAB_CONTROLLER_DATA_DIR=$DATA_DIR

# Device polling interval (ms)
POLL_INTERVAL=250

# Chart history window (ms) - default 30 minutes
HISTORY_WINDOW=1800000

# Device rescan interval (ms) - default 10 seconds
SCAN_INTERVAL=10000

# Uncomment to use simulated devices (for testing without hardware)
# USE_SIMULATED_DEVICES=true
EOF
        log_success "Environment file created at $ENV_FILE"
    fi
}

# Create systemd service
create_systemd_service() {
    log_info "Creating systemd service..."

    SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

    sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Lab Controller - Lab Equipment Control Interface
Documentation=https://github.com/your-org/lab-controller
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node dist/server/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=false
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$DATA_DIR $INSTALL_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

    # Reload systemd
    sudo systemctl daemon-reload

    # Enable service to start at boot
    sudo systemctl enable "$SERVICE_NAME"

    log_success "Systemd service created and enabled"
}

# Start the service
start_service() {
    log_info "Starting Lab Controller service..."

    sudo systemctl start "$SERVICE_NAME"

    # Wait a moment for startup
    sleep 3

    if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
        log_success "Service started successfully"
    else
        log_error "Service failed to start. Check logs with: journalctl -u $SERVICE_NAME -f"
        sudo systemctl status "$SERVICE_NAME" --no-pager
        exit 1
    fi
}

# Get IP address
get_ip_address() {
    # Try to get the primary IP address
    IP=$(hostname -I | awk '{print $1}')
    echo "$IP"
}

# Print completion message
print_completion() {
    IP=$(get_ip_address)

    echo ""
    echo "=============================================="
    log_success "Lab Controller installed successfully!"
    echo "=============================================="
    echo ""
    echo "Installation details:"
    echo "  Install directory: $INSTALL_DIR"
    echo "  Data directory:    $DATA_DIR"
    echo "  Service name:      $SERVICE_NAME"
    echo "  Port:              $PORT"
    echo ""
    echo "Access the web interface at:"
    echo "  http://localhost:$PORT"
    if [ -n "$IP" ]; then
        echo "  http://$IP:$PORT"
    fi
    echo ""
    echo "Useful commands:"
    echo "  View logs:        journalctl -u $SERVICE_NAME -f"
    echo "  Restart service:  sudo systemctl restart $SERVICE_NAME"
    echo "  Stop service:     sudo systemctl stop $SERVICE_NAME"
    echo "  Check status:     sudo systemctl status $SERVICE_NAME"
    echo ""

    if [ "$NEEDS_LOGOUT" = true ]; then
        echo -e "${YELLOW}NOTE: You need to log out and back in for USB/serial"
        echo -e "device permissions to take effect.${NC}"
        echo ""
    fi
}

# Uninstall function
uninstall() {
    log_info "Uninstalling Lab Controller..."

    # Stop and disable service
    if sudo systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        sudo systemctl stop "$SERVICE_NAME"
    fi

    if sudo systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
        sudo systemctl disable "$SERVICE_NAME"
    fi

    # Remove service file
    if [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
        sudo rm "/etc/systemd/system/${SERVICE_NAME}.service"
        sudo systemctl daemon-reload
    fi

    # Remove udev rules
    if [ -f "/etc/udev/rules.d/99-usbtmc.rules" ]; then
        sudo rm "/etc/udev/rules.d/99-usbtmc.rules"
        sudo udevadm control --reload-rules
    fi

    log_success "Service and udev rules removed"
    log_info "Application files at $INSTALL_DIR were NOT removed"
    log_info "Data at $DATA_DIR was NOT removed"
    echo ""
    echo "To completely remove, run:"
    echo "  rm -rf $INSTALL_DIR"
    echo "  sudo rm -rf $DATA_DIR"
}

# Main installation flow
main() {
    echo ""
    echo "=============================================="
    echo "  Lab Controller - Raspberry Pi Installer"
    echo "=============================================="
    echo ""

    # Handle uninstall flag
    if [ "$1" = "--uninstall" ] || [ "$1" = "-u" ]; then
        uninstall
        exit 0
    fi

    # Show help
    if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --uninstall, -u    Remove the service and udev rules"
        echo "  --help, -h         Show this help message"
        echo ""
        echo "Environment variables:"
        echo "  LAB_CONTROLLER_INSTALL_DIR  Installation directory (default: ~/lab-controller)"
        echo "  LAB_CONTROLLER_DATA_DIR     Data directory (default: /var/lib/lab-controller)"
        echo "  LAB_CONTROLLER_PORT         Server port (default: 3001)"
        echo "  LAB_CONTROLLER_REPO         Git repository URL"
        echo "  LAB_CONTROLLER_BRANCH       Git branch to install (default: main)"
        echo ""
        exit 0
    fi

    NEEDS_LOGOUT=false

    check_system
    install_dependencies
    install_nodejs
    setup_device_permissions
    setup_repository
    build_application
    setup_data_directory
    setup_environment
    create_systemd_service
    start_service
    print_completion
}

# Run main function
main "$@"
