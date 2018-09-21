const ipc = require('node-ipc')
const md5 = require('crypto').createHash('md5')

ipc.config.id = 'ragiDB.client' + md5.update(Date.now().toString())
ipc.config.retry = 1500;
ipc.config.silent = true;
ipc.config.maxRetries = 10;

exports.GetContainer = GetContainer
exports.AddEntry = AddEntry
exports.Exit = Exit
exports.NoticeEntry = NoticeEntry
exports.NoticeEntryAll = NoticeEntryAll

const processName = 'RagiDB.server-6563349053925304016'

function GetContainer()
{
	return new Promise( (resolve, reject) => {
		
		if(!ipc.of[processName]){
			ipc.connectTo(processName, () => {
				ipc.of[processName].on('connect', () => {
					ipc.of[processName].emit('RagiDB.Data')
				})
			})
		}
		else{
			ipc.of[processName].emit('RagiDB.Data')
		}
			
		ipc.of[processName].on('recv', (data) => {
			ipc.disconnect(processName)
			resolve(data)
		})
	})
}

function AddEntry(entry)
{
	return new Promise((resolve, reject) => {
		
		if(!ipc.of[processName]){
			ipc.connectTo(processName, () => {
				ipc.of[processName].on('connect', () => {
					resolve(ipc.of[processName].emit('RagiDB.Add', entry))
				})
			})
		}
		else{
			resolve(ipc.of[processName].emit('RagiDB.Add', entry))
		}
	})
}

function Exit()
{
	ipc.disconnect(processName)
}

function NoticeEntry(containerId, entryId)
{
	return new Promise((resolve, reject) => {
			
		if(!ipc.of[processName]){
			ipc.connectTo(processName, () => {})
		}
		
		resolve(ipc.of[processName].emit('RagiDB.Noticed', [containerId, entryId]))
	})
}

function NoticeEntryAll(containerId, entryIds)
{
	return new Promise((resolve, reject) => {
		
		tasks = []

		entryIds.map( x => tasks.push(NoticeEntry(containerId, x)) )

		Promise.all(tasks).then(() => {
			// 10 for current settings, choosing 10 is due to same interval in main.js dealing taskQueue
			// +1 to force reading after all tasks have been done
			// However, if taskQueue is not empty before sending current tasks, it may still send read request while not all tasks have been done
			setTimeout(resolve, (tasks.length + 1) * 10)
		})

	})
}
