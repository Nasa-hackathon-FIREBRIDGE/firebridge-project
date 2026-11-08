# syntax=docker/dockerfile:1

FROM node:22-alpine AS build

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

ARG VITE_API_URL=http://localhost:3000/api/v1
ARG VITE_MAP_STYLE_URL=
ARG VITE_BASEMAP_PROVIDER=

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_MAP_STYLE_URL=${VITE_MAP_STYLE_URL}
ENV VITE_BASEMAP_PROVIDER=${VITE_BASEMAP_PROVIDER}

RUN npm run build

FROM nginx:stable-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/firebridge-frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]