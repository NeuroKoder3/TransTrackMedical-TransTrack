# syntax=docker/dockerfile:1.6
# -----------------------------------------------------------------------------
# TransTrack API server image.
# Multi-stage build: deps → runtime, non-root, minimal attack surface.
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY server/package.json server/package.json
WORKDIR /app/server
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HTTP_HOST=0.0.0.0 \
    HTTP_PORT=8080 \
    HL7_MLLP_PORT=2575
WORKDIR /app
COPY --from=deps /app/server/node_modules /app/server/node_modules
COPY server /app/server
# The server reuses the existing HL7 v2 parser and clinical calculators
# from the Electron app to avoid divergence — copy that subtree too.
COPY electron/services/hl7v2.cjs            /app/electron/services/hl7v2.cjs
COPY electron/services/calculators          /app/electron/services/calculators

WORKDIR /app/server
USER node
EXPOSE 8080 2575
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.HTTP_PORT+'/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
CMD ["node", "src/index.js"]
