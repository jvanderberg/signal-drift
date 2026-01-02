#!/bin/bash
# Initialize firewall rules for secure Claude Code operation
# Only allows outbound connections to essential services

set -e

echo "Initializing firewall rules..."

# Check if we have iptables
if ! command -v iptables &> /dev/null; then
    echo "Warning: iptables not available, skipping firewall setup"
    exit 0
fi

# Use sudo if not root
IPTABLES="iptables"
if [ "$(id -u)" -ne 0 ]; then
    IPTABLES="sudo iptables"
fi

if ! $IPTABLES -L &> /dev/null 2>&1; then
    echo "Warning: No permission to manage iptables, skipping firewall setup"
    echo "Run container with --cap-add=NET_ADMIN to enable firewall"
    exit 0
fi

# Flush existing rules
$IPTABLES -F OUTPUT 2>/dev/null || true

# Allow loopback
$IPTABLES -A OUTPUT -o lo -j ACCEPT

# Allow established connections
$IPTABLES -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS (needed for hostname resolution)
$IPTABLES -A OUTPUT -p udp --dport 53 -j ACCEPT
$IPTABLES -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Allow HTTPS (443) to specific domains
# Claude API and OAuth
$IPTABLES -A OUTPUT -p tcp --dport 443 -d api.anthropic.com -j ACCEPT
$IPTABLES -A OUTPUT -p tcp --dport 443 -d claude.ai -j ACCEPT

# npm registry
$IPTABLES -A OUTPUT -p tcp --dport 443 -d registry.npmjs.org -j ACCEPT

# GitHub (for git operations and package downloads)
$IPTABLES -A OUTPUT -p tcp --dport 443 -d github.com -j ACCEPT
$IPTABLES -A OUTPUT -p tcp --dport 443 -d raw.githubusercontent.com -j ACCEPT
$IPTABLES -A OUTPUT -p tcp --dport 443 -d objects.githubusercontent.com -j ACCEPT

# Node.js (for node-gyp to download headers for native modules)
$IPTABLES -A OUTPUT -p tcp --dport 443 -d nodejs.org -j ACCEPT

# GitHub SSH (for git clone/push via SSH)
$IPTABLES -A OUTPUT -p tcp --dport 22 -d github.com -j ACCEPT

# Allow HTTP for npm (some packages)
$IPTABLES -A OUTPUT -p tcp --dport 80 -d registry.npmjs.org -j ACCEPT

# Log dropped packets (optional, for debugging)
# $IPTABLES -A OUTPUT -j LOG --log-prefix "DROPPED: "

# Drop everything else
$IPTABLES -A OUTPUT -j DROP

echo "Firewall initialized. Allowed destinations:"
echo "  - api.anthropic.com (Claude API)"
echo "  - claude.ai (Claude Max OAuth)"
echo "  - registry.npmjs.org (npm)"
echo "  - github.com (git)"
echo "  - nodejs.org (node-gyp headers)"
echo "  - DNS (port 53)"
echo "All other outbound connections blocked."
