FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install

COPY . .

RUN npm run build -w packages/shared && npm run build -w apps/web

EXPOSE 4173

CMD ["npm", "run", "preview", "-w", "apps/web"]
