FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production || npm i --production
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
