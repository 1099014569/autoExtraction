FROM node:20-bookworm-slim AS base

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install

COPY . .

RUN npm run build -w packages/shared && npm run build -w apps/api

EXPOSE 8787

CMD ["npm", "run", "start", "-w", "apps/api"]
