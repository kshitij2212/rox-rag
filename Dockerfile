# Use Node.js 20 slim as base image
FROM node:20-slim

# Create and set the working directory
WORKDIR /app

# Install build dependencies for native modules (node-pty)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies (including postinstall patches)
RUN npm ci --omit=dev

# Copy source code and other required directories
COPY src/ ./src/
COPY config/ ./config/
COPY images/ ./images/
COPY roxstar-user-question-set.md ./

# Expose the port the dashboard runs on
EXPOSE 4000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=4000

# Run the dashboard command
CMD ["npm", "run", "dashboard"]
