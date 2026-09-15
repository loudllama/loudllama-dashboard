# LoudLlama Dashboard - Home Assistant add-on
FROM node:20-alpine

ENV LANG=C.UTF-8 \
    NODE_ENV=production \
    PORT=8099 \
    DATA_DIR=/data

WORKDIR /app

# Install backend dependencies first (better layer caching)
COPY backend/package*.json ./
RUN npm install --omit=dev

# Copy backend + frontend
COPY backend ./
COPY frontend ./public

# Persistent data directory (mounted by the Supervisor at runtime)
RUN mkdir -p /data/www

EXPOSE 8099

CMD ["node", "server.js"]
