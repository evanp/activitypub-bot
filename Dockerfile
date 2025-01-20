FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY index.js .
COPY lib .
COPY README.md .

FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/ ./

CMD ["npm", "start"]