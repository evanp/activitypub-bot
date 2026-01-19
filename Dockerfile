FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache libstdc++ sqlite sqlite-libs

ARG PACKAGE_VERSION

RUN npm init -y \
  && npm install --omit=dev @evanp/activitypub-bot@${PACKAGE_VERSION:-latest}

CMD ["node", "node_modules/@evanp/activitypub-bot/index.js"]
