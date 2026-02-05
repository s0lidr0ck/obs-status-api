FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cached until package files change)
COPY package.json package-lock.json* ./
RUN npm install

# Optional: bump this in EasyPanel to force a rebuild
ARG BUILD_ID=dev
ENV BUILD_ID=$BUILD_ID
LABEL org.opencontainers.image.revision=$BUILD_ID

# Copy application code (changes here force a rebuild of this layer)
COPY server.js ./

EXPOSE 8080
CMD ["npm", "start"]

