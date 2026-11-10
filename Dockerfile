FROM oven/bun:1.2-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001


CMD ["sh", "-c", "bun run migrate && bun run dev"]
