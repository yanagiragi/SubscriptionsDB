#!/bin/bash

ROOT="/SubscriptionsDB"
RESTORE_SQL="/Backups/backup.sql"

if [ -f "${RESTORE_SQL}" ]; then

	echo "Detect ${RESTORE_SQL} exists. Restore Database ..."
	
	# remove authencation of postgresql
	sed -i 's/md5/trust/' /etc/postgresql/11/main/pg_hba.conf
	service postgresql restart

	# Restore database
	psql -U postgres -h localhost -c 'create database subscriptions'
	psql -U postgres -h localhost -d subscriptions -f "${RESTORE_SQL}"

	echo "Restore Database Done."
fi

# Setup crontab to backup databases
echo "0 0 * * * /bin/bash /Backups/backup_docker_db.sh" | crontab -
service cron start

# Start subscriptionsDB host
echo "Start SubscriptionDB ..."
cd ${ROOT}/bin && \
	pm2 start ecosystem_docker.config.js && \
	pm2 logs 0
