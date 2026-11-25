# syntax=docker/dockerfile:1
# Image du site « __SITE_NAME__ » : construction, puis une image légère qui ne contient que le serveur construit.
# Voir HEBERGEMENT.md.

FROM node:24-slim AS construction
WORKDIR /app
# git et les certificats : pnpm va chercher backoffice-core dans son dépôt git.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global corepack@latest && corepack enable
ENV PNPM_HOME=/pnpm CI=true NUXT_TELEMETRY_DISABLED=1
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm exec nuxt build

FROM node:24-slim
ENV NODE_ENV=production PORT=3000 NUXT_DATA_DIR=/data
WORKDIR /app
COPY --from=construction /app/.output ./.output
# Le dossier de données (base, fichiers de la médiathèque, sauvegardes) : à garder dans un volume.
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/robots.txt').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
