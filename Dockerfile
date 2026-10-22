# Use an official, lightweight Node.js runtime as the base image
FROM node:20-alpine

# Production mode: turns on stricter checks (the app refuses to start
# without SESSION_SECRET, so login cookies are never signed with a default key).
ENV NODE_ENV=production

# Set the working directory inside the container
WORKDIR /app

# Copy only package files first (so Docker can cache the npm install layer
# separately from the rest of the code, which makes rebuilds faster)
COPY package*.json ./

# Install production dependencies only.
# better-sqlite3 is a native module: normally a ready-made binary is downloaded,
# but if none exists for this platform it is compiled, which needs python/make/g++.
# They are installed for the build and removed straight afterwards to keep the image small.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci --omit=dev \
    && apk del .build-deps

# Now copy the rest of the application code
COPY . .

# The SQLite database file lives in /app/data. Mount a volume here to keep data
# when the container is replaced: docker run -v borrowbox-data:/app/data ...
ENV DB_PATH=/app/data/borrowbox.db
VOLUME ["/app/data"]

# Run as the unprivileged "node" user instead of root
RUN chown -R node:node /app
USER node

# Document which port the app listens on (informational; doesn't publish it)
EXPOSE 3000

# Container health check (same /health route the pipeline uses)
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Command that runs when a container starts from this image
CMD ["npm", "start"]
