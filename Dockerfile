FROM node:26-alpine

WORKDIR /app

RUN apk add --no-cache libstdc++ sqlite sqlite-libs

ENV DATABASE_URL=
ENV ORIGIN=
ENV PORT=
ENV BOTS_CONFIG_FILE=
ENV LOG_LEVEL=
ENV NODE_PATH=/usr/local/lib/node_modules

COPY . /tmp/activitypub-bot
RUN npm install -g --install-links /tmp/activitypub-bot && rm -rf /tmp/activitypub-bot
RUN ln -s /usr/local/lib/node_modules /app/node_modules

CMD ["activitypub-bot"]
