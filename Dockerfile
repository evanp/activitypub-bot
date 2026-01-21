FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache libstdc++ sqlite sqlite-libs

ARG PACKAGE_VERSION

ENV DATABASE_URL=
ENV ORIGIN=
ENV PORT=
ENV BOTS_CONFIG_FILE=
ENV LOG_LEVEL=

RUN npm install -g @evanp/activitypub-bot@${PACKAGE_VERSION:-latest}

CMD ["activitypub-bot"]
