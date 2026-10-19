FROM node:20-bookworm-slim

# Install Python, Chromium, and required system dependencies for Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables for Chromium and Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=2785

WORKDIR /app

# Copy package files and build OpenWA
COPY OpenWA/package*.json ./OpenWA/
WORKDIR /app/OpenWA
RUN npm ci --include=dev && npm run build && npm prune --omit=dev

WORKDIR /app

# Setup Python virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all application code
COPY . .

# Ensure start script is executable
RUN chmod +x start.sh

EXPOSE 2785

CMD ["./start.sh"]
