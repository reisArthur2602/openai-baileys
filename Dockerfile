
FROM node:20-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build  # Certifique-se que o build gera dist/server.js

# Etapa 2 - Runtime
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
RUN npm install --omit=dev
EXPOSE 3000
CMD ["node", "dist/server.js"]
