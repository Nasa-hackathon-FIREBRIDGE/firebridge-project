# syntax=docker/dockerfile:1

FROM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS build

WORKDIR /workspace/firebridge-backend

COPY --from=backend /package.json /package-lock.json ./
COPY --from=backend /apps/api/package.json ./apps/api/package.json
COPY --from=backend /apps/worker/package.json ./apps/worker/package.json
COPY --from=backend /packages ./packages
COPY --from=backend /tsconfig.base.json ./

RUN npm ci

WORKDIR /workspace/firebridge-frontend

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL=https://astramind.solutions/api/v1
ARG VITE_MAP_STYLE_URL=
ARG VITE_BASEMAP_PROVIDER=

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_MAP_STYLE_URL=${VITE_MAP_STYLE_URL}
ENV VITE_BASEMAP_PROVIDER=${VITE_BASEMAP_PROVIDER}

RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03
USER root
RUN apk upgrade --no-cache
USER 101:101

COPY nginx.main.conf /etc/nginx/nginx.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/firebridge-frontend/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
