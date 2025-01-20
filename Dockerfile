FROM node:22-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/ ./

CMD ["npm", "start"]