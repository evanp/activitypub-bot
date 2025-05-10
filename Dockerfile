FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++ py3-setuptools

COPY package.json package-lock.json ./
RUN npm install

COPY index.js .
COPY lib .
COPY README.md .

FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache libstdc++ sqlite sqlite-libs

COPY --from=builder /app/ ./

CMD ["npm", "start"]