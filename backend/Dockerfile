FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
# --omit=dev=false was never valid npm syntax (silently ignored, just warns
# every build) -- dropped, since plain `npm install` already installs
# devDependencies by default, which was the actual intent. The retry/timeout
# flags are new: confirmed live on 2026-08-16 that this host's connection to
# registry.npmjs.org has real intermittent multi-minute-scale packet loss
# (the same underlying issue connectivity_degraded/heartbeat.mjs now
# monitors for) -- npm's default retry behavior wasn't aggressive enough to
# ride it out, causing repeated build failures until a plain `npm install`
# with these flags, run directly outside Docker, succeeded by retrying
# through the blips instead of giving up on the first timeout.
RUN npm install --fetch-retries=5 --fetch-retry-mintimeout=5000 --fetch-retry-maxtimeout=60000 --fetch-timeout=120000

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
