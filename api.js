const ipc = require('node-ipc')
const md5 = require('crypto').createHash('md5')

ipc.config.id = 'ragiDB.client' + md5.update(Date.now().toString())
ipc.config.retry = 1500;
ipc.config.silent = true;

exports.GetContainer = GetContainer
exports.AddEntry = AddEntry
exports.exit = function()
{
	ipc.disconnect(processName)
}

const processName = 'RagiDB.server-6563349053925304016'

function GetContainer()
{
	return new Promise( (resolve, reject) => {
		
		if(!ipc.of[processName]){
			ipc.connectTo(processName, () => {})
		}

		ipc.of[processName].emit('RagiDB.Data')
			
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
			ipc.connectTo(processName, () => {})
		}
		
		resolve(ipc.of[processName].emit('RagiDB.Add', entry))
	})
}
