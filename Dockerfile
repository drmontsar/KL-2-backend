FROM oven/bun:1.2-alpine

WORKDIR /app

COPY package.json ./
RUN if [ -f bun.lockb ]; then bun install --frozen-lockfile; else bun install; fi

COPY . .

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001


CMD ["sh", "-c", "bun run migrate && bun run src/main.ts"]
