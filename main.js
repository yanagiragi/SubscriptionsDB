const fs = require('fs')
const ipc = require('node-ipc')
const EventEmitter = require('events').EventEmitter
const { createLogger, format, transports } = require('winston')
const { combine, timestamp, label, printf } = format

const myFormat = printf(info => {
	return `${info.timestamp} [${info.label}] ${info.level}: ${info.message}`
})

const logger = createLogger({
	format: combine(
		label({ label: 'RagiDB' }),
		timestamp(),
		myFormat
	),
	transports: [new transports.Console()]
})

// path to container.json
const dataPath = './data/container.json'
var container = JSON.parse(fs.readFileSync(dataPath))
var dirty = false

var taskQueue = [] // task format = [ function , data ]
var readQueue = [] // read format = [ function , socket ]
const event = new EventEmitter()


// Setup ipc

ipc.config.id = 'RagiDB.server-6563349053925304016';
ipc.config.retry = 1500;
ipc.config.silent = true;


// Setup Event Handlers

event.on('RagiDB.DealAction.Task', () => {
	
	let [ action, param ] = taskQueue[0]	
	
	logger.log({
		level: 'info',
		message: `Dequeue Event: <${action.name}, ${param[0]}, ${param[1]}>`
	})

	taskQueue.splice(0,1)

	action(param)
});

event.on('RagiDB.DealAction.Save', () => {
	logger.log({
		level: 'info',
		message: 'Confirm Dirty, Save'
	})
	SaveDB();
});

event.on('RagiDB.DealAction.Read', () => {
	
	logger.log({
		level: 'info',
		message: 'Dealing Read Requests, ' + (dirty ? 'Using Cache' : "Remain Same")
	})
	
	if(dirty)
	{
		event.emit('RagiDB.DealAction.Save')
	}

	let [ action, socket ] = readQueue[0]
	
	readQueue.splice(0,1)
	
	ipc.server.emit(
		socket,
		'recv',
		container
	)

});

// Setup Event Loops

setInterval(function(){
	if(taskQueue.length > 0)
		event.emit('RagiDB.DealAction.Task');
}, 10)

setInterval(function(){
	if(readQueue.length > 0)
		event.emit('RagiDB.DealAction.Read');
}, 10)

setInterval(function(){
	if(dirty)
		event.emit('RagiDB.DealAction.Save');
}, 50)


// set up APIs

ipc.serve(() => {
	ipc.server.on('RagiDB.Noticed', message => {
		taskQueue.push([NoticeEntry, message])
	})
	ipc.server.on('RagiDB.Add', message => {
		taskQueue.push([Add, message])
	})
	ipc.server.on('RagiDB.Data', (message, socket) => {
		readQueue.push([ReadDB, socket])
	})
	ipc.server.on('socket.disconnected', (socket, destroyedSocketID) => {
		// console.log('socket ' + destroyedSocketID)
	})
});

ipc.server.start();


// Implemented functions

function ReadDB()
{
	container = JSON.parse(fs.readFileSync(dataPath))
}

function SaveDB()
{
	if(dirty){
		try{
			fs.writeFileSync(dataPath, JSON.stringify(container, null, 4))
		}
		catch(err){
			logger.log({
				level: 'error',
				message: `Error when writing file, error=<${err.message}>`
			})
			
			return
		}
		
		logger.log({
			level: 'info',
			message: 'Saving File Done, Restore Dirty to Clean'
		})
		dirty = false
	}
}

function NoticeEntry([containerId, listId])
{
	if(container.container[containerId] && container.container[containerId].list[listId]){
		container.container[containerId].list[listId].isNoticed = true;
		dirty = true;
		
		logger.log({
			level: 'info',
			message: `Read ContainerId<${containerId}> & ListId<${listId}>, title = ${container.container[containerId].list[listId].title}`
		});
	}
	else
		logger.log({
			level: 'error',
			message: `Error with ContainerId<${containerId}> & ListId<${listId}>`
		});
}

function CheckExisted(containerId, data)
{
	var existed = false
	
	if(container.container[containerId] && container.container[containerId].list){
		
		for(var entryId in container.container[containerId].list){
			
			let entry = container.container[containerId].list[entryId]
			let match = (
				entry.title == data.title && 
				entry.img == data.img &&
				entry.href == data.href
			)
			
			if(match){
				existed = true
				break
			}
		}
	}

	return existed
}

function GetContainerId(containerType, nickname)
{
	let typeId = container.types.indexOf(containerType)
	let idx = -1
	for(idx in container.container){
		if(container.container[idx].nickname == nickname && container.container[idx].typeId == typeId){
			break
		}
	}
	return idx >= container.container.length ? -1 : idx
}

function Add([containerType, nickname, data])
{
	let containerId = GetContainerId(containerType, nickname)//container.types.indexOf(containerType)

	var existed = CheckExisted(containerId, data)
	
	if(data && data.title && data.href && data.img && !existed)
	{
		dirty = true;
		container.container[containerId].list.push(data)
		logger.log({
			level: 'info',
			message: `Add New Entry, title = <${data.title}>`
		});
	}
	else{
		if(existed){
			logger.log({
				level: 'info',
				message: `Entry existed, title = <${data.title}>`
			})
		}
		else{
			if(data){
				logger.log({
					level: 'error',
					message: `Missing entry: <${data.title || null}, ${data.href || null}, ${data.img || null}, ${data.isNoticed || null}>`
				})
			}
			else{
				logger.log({
					level: 'error',
					message: `Missing entry: <${data || null}>`
				})
			}
		}
	}
}
