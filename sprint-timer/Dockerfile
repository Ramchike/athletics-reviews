FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS assets
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY setup-model.mjs ./
COPY public/ ./public/
RUN npm run setup

FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173
COPY --from=assets --chown=node:node /app/ ./
COPY --chown=node:node server.mjs ./
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4173/readyz').then(r=>{if(!r.ok) process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
