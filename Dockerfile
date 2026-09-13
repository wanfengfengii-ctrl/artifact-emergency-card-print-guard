# syntax=docker/dockerfile:1

# ---------- 依赖 ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- 构建（类型检查 + 产出静态文件） ----------
FROM deps AS build
COPY . .
RUN npm run build

# ---------- 页面服务：纯静态，无后端、无在线依赖 ----------
FROM nginx:1.27-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:80/ >/dev/null 2>&1 || exit 1

# ---------- 一次性 verify：单元测试 + 生产构建 ----------
FROM deps AS verify
COPY . .
CMD ["npm", "run", "verify"]
