FROM node:20-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \
    iptables \
    git \
    curl \
    zsh \
    fzf \
    && rm -rf /var/lib/apt/lists/*

# Create user with Mac's UID (501) to match file ownership
RUN userdel -r node 2>/dev/null || true && \
    groupadd -g 501 claude && \
    useradd -u 501 -g 501 -m -s /bin/zsh claude && \
    apt-get update && apt-get install -y sudo && \
    echo "claude ALL=(root) NOPASSWD: /usr/sbin/iptables" >> /etc/sudoers.d/claude && \
    rm -rf /var/lib/apt/lists/*

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

# Install oh-my-zsh for the claude user
USER claude
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended || true
USER root

# Set up working directory
WORKDIR /workspace

# Copy package files for dependency caching
COPY package*.json ./
COPY client/package*.json ./client/

# Give claude user ownership of workspace
RUN chown -R claude:claude /workspace

# Default to zsh
ENV SHELL=/bin/zsh

# Keep container running for interactive use
CMD ["sleep", "infinity"]
