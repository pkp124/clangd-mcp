FROM node:22-bookworm-slim

ARG CLANGD_VERSION=22.1.6

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      clang \
      curl \
      g++ \
      unzip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL -o /tmp/clangd.zip \
      "https://github.com/clangd/clangd/releases/download/${CLANGD_VERSION}/clangd-linux-${CLANGD_VERSION}.zip" \
    && curl -fsSL -o /tmp/clangd-index.zip \
      "https://github.com/clangd/clangd/releases/download/${CLANGD_VERSION}/clangd_indexing_tools-linux-${CLANGD_VERSION}.zip" \
    && unzip -qo /tmp/clangd.zip -d /opt/clangd \
    && unzip -qo /tmp/clangd-index.zip -d /opt/clangd-index \
    && install -m 0755 "$(find /opt -type f -name clangd -path '*/bin/*' | head -n 1)" /usr/local/bin/clangd \
    && install -m 0755 "$(find /opt -type f -name clangd-indexer -path '*/bin/*' | head -n 1)" /usr/local/bin/clangd-indexer \
    && install -m 0755 "$(find /opt -type f -name clangd-index-server -path '*/bin/*' | head -n 1)" /usr/local/bin/clangd-index-server \
    && rm -f /tmp/clangd.zip /tmp/clangd-index.zip

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build && npm prune --omit=dev

ENTRYPOINT ["node", "dist/src/main.js"]
CMD ["serve"]
