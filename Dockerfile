FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.html admin.html styles.css app.js admin.js server.mjs ./

ENV PORT=4177
EXPOSE 4177

CMD ["npm", "start"]
