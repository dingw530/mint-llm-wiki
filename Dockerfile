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
COPY apps/server/package.json ./apps/server/
COPY apps/client/package.json ./apps/client/
COPY apps/electron/package.json ./apps/electron/
COPY apps/agent-eval/package.json ./apps/agent-eval/
COPY apps/website/package.json ./apps/website/

# 安装全部依赖（含 devDependencies，构建时需要）
RUN npm ci

# ── 复制源码 ──
COPY scripts/ ./scripts/
COPY apps/server/tsconfig.json ./apps/server/
COPY apps/server/ ./apps/server/
COPY apps/client/ ./apps/client/
COPY apps/electron/endpoints-manifest.json ./apps/electron/
COPY apps/agent-eval/ ./apps/agent-eval/
COPY apps/website/ ./apps/website/

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
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/client/package.json ./apps/client/
COPY --from=builder /app/apps/electron/package.json ./apps/electron/

# 生产依赖 node_modules（已 prune）
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/node_modules ./apps/server/node_modules

# 编译后的服务端和客户端
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/docker-entry.js ./apps/server/
COPY --from=builder /app/apps/client/dist ./apps/client/dist

# ── 环境变量 ──
ENV PORT=3001 \
    NODE_ENV=production

# 数据卷挂载点（SQLite 数据库）
VOLUME ["/app/data"]

EXPOSE 3001

CMD ["node", "--dns-result-order=ipv4first", "apps/server/docker-entry.js"]
