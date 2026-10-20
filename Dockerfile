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

# Install OpenWA production dependencies with --ignore-scripts
WORKDIR /app/OpenWA
RUN npm ci --omit=dev --ignore-scripts \
    && node scripts/patch-wwebjs-201832.js \
    && node scripts/patch-wwebjs-newsletter-preview.js \
    && node scripts/patch-wwebjs-status.js \
    && node scripts/patch-wwebjs-ready-sync.js \
    && node scripts/patch-wwebjs-participant-arity.js \
    && node scripts/patch-wwebjs-block.js \
    && node scripts/patch-wwebjs-group-description.js \
    && node scripts/patch-wwebjs-media-id.js \
    && node scripts/patch-wwebjs-send-error.js \
    && node scripts/patch-baileys-appstate.js \
    && node scripts/patch-baileys-newsletter-create.js \
    && node scripts/patch-baileys-pairing.js \
    && npm cache clean --force

WORKDIR /app
RUN chmod +x start.sh

EXPOSE 2785

ENTRYPOINT ["dumb-init", "--"]
CMD ["./start.sh"]
