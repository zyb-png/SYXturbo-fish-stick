FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.html styles.css app.js server.mjs ./
COPY assets ./assets

ENV PORT=4178
EXPOSE 4178

CMD ["npm", "start"]
