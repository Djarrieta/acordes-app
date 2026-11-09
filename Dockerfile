FROM oven/bun:1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg unzip \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
        -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && curl -fsSL https://deno.land/install.sh | sh -s -- -y --no-modify-path \
    && ln -s /root/.deno/bin/deno /usr/local/bin/deno \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data /app/data/audio

ENV HOST=0.0.0.0
ENV PORT=4173
ENV DB_PATH=/app/data/app.sqlite
ENV HOME=/tmp
EXPOSE 4173

CMD ["bun", "src/index.ts"]
