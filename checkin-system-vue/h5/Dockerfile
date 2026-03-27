FROM docker.1ms.run/library/node:18 AS build
WORKDIR /app
COPY . .
RUN npm install --registry=https://registry.npmmirror.com && npm run build
FROM docker.1ms.run/library/nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
