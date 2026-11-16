FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 8080
CMD ["sh", "-c", "node dist/src/prepare-db.js && npx prisma db push && node dist/src/server.js"]
