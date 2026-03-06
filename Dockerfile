FROM node:18

WORKDIR /app

# Install dependencies first (better Docker layer caching)
COPY package*.json ./
RUN npm install --production

# Copy application source
COPY . .

# Backend listens on 8000 by default
EXPOSE 8000

# Start the SmartBin backend
CMD ["npm", "start"]