FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist ./dist
ENV NODE_ENV=production
ENV PORT=8081
EXPOSE 8081
CMD ["node","dist/index.js"]
