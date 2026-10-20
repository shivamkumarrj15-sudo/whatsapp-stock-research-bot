FROM node:22-bookworm-slim

# Install system dependencies, Chromium, and Python
RUN apt-get update && apt-get install -y --no-install-recommends \
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
    dumb-init \
    python3 \
    python3-pip \
    python3-venv \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=2785

WORKDIR /app

# Setup Python virtual environment & lightweight requirements
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all application code (including pre-built OpenWA dist)
COPY . .

# Install OpenWA production dependencies cleanly with --ignore-scripts
WORKDIR /app/OpenWA
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts && npm cache clean --force

WORKDIR /app
RUN chmod +x start.sh

EXPOSE 2785

ENTRYPOINT ["dumb-init", "--"]
CMD ["./start.sh"]
