FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg nodejs npm ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -U yt-dlp
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
ENV PORT=8080
EXPOSE 8080
CMD ["npm","start"]
