FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++ py3-setuptools

COPY package.json package-lock.json ./
RUN npm ci

COPY index.js .
COPY lib .
COPY README.md .

FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache libstdc++ sqlite sqlite-libs

COPY --from=builder /app/ ./

CMD ["npm", "start"]