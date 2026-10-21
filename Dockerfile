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
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    API_MASTER_KEY=owa_k1_51a2d39a164c4046f38e56e5bb62b535a01bb822c7676bfce6957dbc0b1bf97b \
    NODE_ENV=production

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
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

WORKDIR /app
RUN chmod +x start.sh

EXPOSE 2785 10000

ENTRYPOINT ["dumb-init", "--"]
CMD ["./start.sh"]
