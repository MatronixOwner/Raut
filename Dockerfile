FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY client ./client
COPY deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV RAUT_HOST=0.0.0.0 \
    RAUT_PORT=8787 \
    RAUT_DATA_DIR=/data \
    NODE_ENV=production

# Northflank/Render/Railway определяют порт из EXPOSE; entrypoint.sh
# дополнительно читает $PORT, если платформа его выставляет.
VOLUME ["/data"]
EXPOSE 8787

CMD ["/app/entrypoint.sh"]
