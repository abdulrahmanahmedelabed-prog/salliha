# خادم صلّحها: المزامنة + صفحة التتبّع + نسخة الويب من التطبيق
FROM node:22-slim
WORKDIR /app
COPY server ./server
COPY www ./www
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
VOLUME /data
EXPOSE 8080
HEALTHCHECK CMD node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "server/server.js"]
