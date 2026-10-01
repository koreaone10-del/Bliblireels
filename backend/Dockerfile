FROM node:22-bookworm-slim

# System dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        zip \
        python3 \
        python3-pip \
        ca-certificates \
        curl \
    && python3 -m pip install \
        --break-system-packages \
        --no-cache-dir \
        -U "yt-dlp[default,curl-cffi]" \
    && yt-dlp --version \
    && ffmpeg -version \
    && rm -rf /var/lib/apt/lists/*

# Application
WORKDIR /app

COPY package.json .

RUN npm install --omit=dev

COPY server.js .

# Runtime configuration
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
