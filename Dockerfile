FROM node:16

WORKDIR /app

ADD package.json /app
ADD package-lock.json /app

RUN npm install

# change workdir
WORKDIR /app/bin