FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache libstdc++ sqlite sqlite-libs

ARG PACKAGE_VERSION

RUN npm init -y \
  && npm install --omit=dev @evanp/activitypub-bot@${PACKAGE_VERSION:-latest}

CMD ["sh", "-c", "node_modules/.bin/bot-server --database-url \"${DATABASE_URL-}\" --origin \"${ORIGIN-}\" --port \"${PORT-}\" --bots-config-file \"${BOTS_CONFIG_FILE-}\" --log-level \"${LOG_LEVEL-}\""]
