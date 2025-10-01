FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm i --production
COPY . .
VOLUME ["/app/.minecraft_profiles"]
ENV HOST=mariano123.ddns.net PORT=25565 NODE_ENV=production
CMD ["npm", "start"]
