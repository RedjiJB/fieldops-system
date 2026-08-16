FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# Same retry/timeout tuning as backend/Dockerfile, same reason -- this
# host's connection to registry.npmjs.org has real intermittent packet
# loss, confirmed live 2026-08-16 (see backend/Dockerfile's comment).
RUN npm install --fetch-retries=5 --fetch-retry-mintimeout=5000 --fetch-retry-maxtimeout=60000 --fetch-timeout=120000
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
