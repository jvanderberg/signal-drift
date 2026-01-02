#!/bin/bash
# Initialize firewall rules for secure Claude Code operation
# Only allows outbound connections to essential services

set -e

echo "Initializing firewall rules..."

# Check if we have iptables permissions
if ! command -v iptables &> /dev/null; then
    echo "Warning: iptables not available, skipping firewall setup"
    exit 0
fi

if ! iptables -L &> /dev/null 2>&1; then
    echo "Warning: No permission to manage iptables, skipping firewall setup"
    echo "Run container with --cap-add=NET_ADMIN to enable firewall"
    exit 0
fi

# Flush existing rules
iptables -F OUTPUT 2>/dev/null || true

# Allow loopback
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS (needed for hostname resolution)
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Allow HTTPS (443) to specific domains
# Claude API
iptables -A OUTPUT -p tcp --dport 443 -d api.anthropic.com -j ACCEPT

# npm registry
iptables -A OUTPUT -p tcp --dport 443 -d registry.npmjs.org -j ACCEPT

# GitHub (for git operations and package downloads)
iptables -A OUTPUT -p tcp --dport 443 -d github.com -j ACCEPT
iptables -A OUTPUT -p tcp --dport 443 -d raw.githubusercontent.com -j ACCEPT
iptables -A OUTPUT -p tcp --dport 443 -d objects.githubusercontent.com -j ACCEPT

# GitHub SSH (for git clone/push via SSH)
iptables -A OUTPUT -p tcp --dport 22 -d github.com -j ACCEPT

# Allow HTTP for npm (some packages)
iptables -A OUTPUT -p tcp --dport 80 -d registry.npmjs.org -j ACCEPT

# Log dropped packets (optional, for debugging)
# iptables -A OUTPUT -j LOG --log-prefix "DROPPED: "

# Drop everything else
iptables -A OUTPUT -j DROP

echo "Firewall initialized. Allowed destinations:"
echo "  - api.anthropic.com (Claude API)"
echo "  - registry.npmjs.org (npm)"
echo "  - github.com (git)"
echo "  - DNS (port 53)"
echo "All other outbound connections blocked."
