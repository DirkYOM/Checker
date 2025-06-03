# Dockerfile
FROM electronuserland/builder:wine

# Set working directory
WORKDIR /app

# Create all necessary directories and set permissions
RUN mkdir -p /.cache /.npm /app/.npm /app/out /tmp/electron-packager && \
    chmod -R 777 /.cache /.npm /app/.npm /app/out /tmp/electron-packager && \
    chown -R 1000:1000 /.cache /.npm /app/.npm /app/out /tmp/electron-packager

# Install build essentials
RUN apt-get update && apt-get install -y \
    wine64 \
    mono-complete \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first
COPY package*.json ./
COPY forge.config.js ./

# Set npm cache location
ENV NPM_CONFIG_CACHE=/app/.npm
ENV ELECTRON_CACHE="/app/.cache/electron"
ENV ELECTRON_BUILDER_CACHE="/app/.cache/electron-builder"

# Set permissions for app directory
RUN chown -R 1000:1000 /app

# Switch to builder user
USER 1000:1000

# Install electron-forge globally first
RUN npm install -g @electron-forge/cli

# Install project dependencies
RUN npm install --no-optional

# Copy the rest of the code
COPY --chown=1000:1000 . .

# Build command
CMD ["npx", "electron-forge", "package", "--platform=win32", "--arch=x64"]