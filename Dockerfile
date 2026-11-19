FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY server ./server
COPY admin ./admin
COPY public ./public
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server/index.js"]
