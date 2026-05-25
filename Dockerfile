# Production Docker image for the CRS backend.
# Build:  docker build -t crs-backend .
# Run:    docker run -p 3000:3000 --env-file .env -v $(pwd)/db:/app/db -v $(pwd)/public/uploads:/app/public/uploads crs-backend
FROM node:20-alpine

# Native compilation tools for better-sqlite3.
RUN apk add --no-cache --virtual .build-deps python3 make g++

WORKDIR /app

# Install deps first (cached layer).
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Drop the build toolchain to keep the image small.
RUN apk del .build-deps

# App source.
COPY . .

# Persistent volumes for the database and uploaded files.
VOLUME ["/app/db", "/app/public/uploads"]

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
