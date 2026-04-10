# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json *.ts ./
RUN npx tsc

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1001 -S rpcaas && adduser -S rpcaas -u 1001 -G rpcaas

COPY --from=builder /app/package.json /app/package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist

USER rpcaas
ENV NODE_ENV=production
ENV PORT=3100
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3100/health || exit 1

CMD ["node", "dist/index.js"]
