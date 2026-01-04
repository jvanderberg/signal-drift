#!/bin/bash
#
# Lab Controller - Raspberry Pi Update Script
#
# Quick update script to pull latest changes and rebuild.
# Use this after initial installation.
#
# Usage:
#   ./update-raspberry-pi.sh
#

set -e

# Configuration (should match install script)
INSTALL_DIR="${LAB_CONTROLLER_INSTALL_DIR:-$HOME/lab-controller}"
SERVICE_NAME="lab-controller"
BRANCH="${LAB_CONTROLLER_BRANCH:-main}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

cd "$INSTALL_DIR"

log_info "Stopping service..."
sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true

log_info "Pulling latest changes..."
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

log_info "Installing dependencies..."
npm ci --ignore-scripts
npm rebuild better-sqlite3 serialport usb --build-from-source

log_info "Updating client dependencies..."
cd client
npm ci
cd ..

log_info "Building application..."
npm run build

log_info "Starting service..."
sudo systemctl start "$SERVICE_NAME"

sleep 2

if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
    log_success "Update complete! Service is running."
else
    echo "Service may have failed to start. Check: journalctl -u $SERVICE_NAME -f"
fi
