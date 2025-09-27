FROM node:24.8.0-alpine

WORKDIR /app
COPY . .
RUN npm install

CMD ["npm", "run", "dev"]
