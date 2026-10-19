FROM apify/actor-node-playwright-chrome:22

WORKDIR /home/myuser

COPY --chown=myuser:myuser package*.json ./

RUN npm ci --omit=dev

COPY --chown=myuser:myuser . ./

CMD ["npm", "start"]