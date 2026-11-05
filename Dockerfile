FROM oven/bun:1
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY public ./public

ENV HOST=0.0.0.0
ENV PORT=4173
EXPOSE 4173

CMD ["bun", "src/index.ts"]
