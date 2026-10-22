FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm config set registry https://registry.npmmirror.com \
  && npm ci
COPY client client
COPY server server
COPY scripts scripts
RUN npm run build -w client

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/app/data
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm config set registry https://registry.npmmirror.com \
  && npm ci --omit=dev \
  && npm cache clean --force
COPY --from=build /app/client/dist client/dist
COPY server server
RUN mkdir -p /app/data
EXPOSE 8787
CMD ["node", "server/src/index.js"]
