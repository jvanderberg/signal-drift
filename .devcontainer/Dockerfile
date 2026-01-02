FROM node:20-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \
    iptables \
    git \
    curl \
    zsh \
    fzf \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

# Install oh-my-zsh for better shell experience (optional)
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended || true

# Ensure node user home directory exists with correct permissions
# The .claude directory will be mounted from host
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node

# Set up working directory
WORKDIR /workspace

# Copy package files for dependency caching
COPY package*.json ./
COPY client/package*.json ./client/

# Default to zsh
ENV SHELL=/bin/zsh
ENV HOME=/home/node

# Keep container running for interactive use
CMD ["sleep", "infinity"]
