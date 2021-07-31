FROM node:16

WORKDIR /SubscriptionsDB

ADD . /SubscriptionsDB

RUN npm install && \
	npm install -g pm2

RUN apt update && \
	apt install -y postgresql-11

CMD [ "bash", "/SubscriptionsDB/bin/docker_run.sh" ]
