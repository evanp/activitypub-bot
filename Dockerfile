FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache libstdc++ sqlite sqlite-libs

ARG PACKAGE_VERSION

ENV DATABASE_URL \
    ORIGIN \
    PORT \
    BOTS_CONFIG_FILE \
    LOG_LEVEL

RUN npm init -y \
  && npm install --omit=dev @evanp/activitypub-bot@${PACKAGE_VERSION:-latest}

CMD ["npx", "activitypub-bot"]
