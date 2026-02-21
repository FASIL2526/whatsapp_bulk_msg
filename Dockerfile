# Use a specialized Puppeteer image that already includes all Chrome dependencies
FROM ghcr.io/puppeteer/puppeteer:22.6.0

# Set environment to skip automatic chrome installs (we use the pre-installed one)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    AUTO_INSTALL_CHROME=false

# Switch to root to manage file permissions safely
USER root

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Ensure the data directory exists and is writable
RUN mkdir -p /app/data && chmod -R 777 /app/data

# Expose the application port
EXPOSE 3000

# Run the application
CMD ["node", "index.js"]
