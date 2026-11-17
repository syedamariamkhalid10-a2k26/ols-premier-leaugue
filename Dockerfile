# OLS Premier League — production image
FROM node:22-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 TZ=Asia/Karachi
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the native modules ship ready-made binaries, so nothing needs compiling
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server ./server
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
