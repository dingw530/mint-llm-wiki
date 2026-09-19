# ============================================================
# Stage 1: 构建阶段 — 编译 server + client
# ============================================================
FROM node:20.19.4-bookworm AS builder

WORKDIR /app

# 安装编译原生模块所需的系统工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# ── 先复制依赖配置文件（利用 Docker layer 缓存） ──
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY electron/package.json ./electron/
COPY agent-eval/package.json ./agent-eval/
COPY website/package.json ./website/

# 安装全部依赖（含 devDependencies，构建时需要）
RUN npm ci

# ── 复制源码 ──
COPY scripts/ ./scripts/
COPY server/tsconfig.json ./server/
COPY server/ ./server/
COPY client/ ./client/
COPY electron/endpoints-manifest.json ./electron/
COPY agent-eval/ ./agent-eval/
COPY website/ ./website/

# 构建
RUN npm run build

# 清理 devDependencies，仅保留生产依赖
RUN npm prune --omit=dev

# ============================================================
# Stage 2: 运行阶段 — 最小化镜像
# ============================================================
FROM node:20.19.4-bookworm-slim

WORKDIR /app

# ── 从构建阶段复制产物 ──
# 基础配置文件（workspaces 结构）
COPY --from=builder /app/package.json ./
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/client/package.json ./client/
COPY --from=builder /app/electron/package.json ./electron/

# 生产依赖 node_modules（已 prune）
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/node_modules ./server/node_modules

# 编译后的服务端和客户端
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/docker-entry.js ./server/
COPY --from=builder /app/client/dist ./client/dist

# ── 环境变量 ──
ENV PORT=3001 \
    NODE_ENV=production

# 数据卷挂载点（SQLite 数据库）
VOLUME ["/app/data"]

EXPOSE 3001

CMD ["node", "--dns-result-order=ipv4first", "server/docker-entry.js"]
