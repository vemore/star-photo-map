# --- Build stage ---
FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json ./
COPY src/ src/
COPY public/ public/

RUN npm run build

# --- Production stage ---
FROM node:22-slim AS production

# better-sqlite3 needs build tools for native compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server/ server/
COPY tsconfig.server.json ./
COPY --from=build /app/dist dist/
COPY public/data/ dist/data/

RUN mkdir -p /data uploads

ENV PORT=3001
ENV DB_PATH=/data/data.db

EXPOSE 3001

CMD ["npx", "tsx", "server/index.ts"]
