FROM node:20-alpine AS builder

WORKDIR /app

# Install all dependencies (dev dependencies are included by default)
COPY package*.json ./
RUN npm install --progress=false

COPY tsconfig.json ./
COPY src ./src

# Run TypeScript compiler using the installed binary
RUN ./node_modules/.bin/tsc

FROM node:20-alpine

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm install --only=production --progress=false --loglevel=error || \
    (echo "npm install failed, retrying..." && npm install --only=production --progress=false)

COPY --from=builder /app/dist ./dist

CMD ["npm", "start"]

