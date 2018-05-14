const fs = require('fs')
const dataPath = './container.json'
var container = JSON.parse(fs.readFileSync(dataPath))

reMap2()

function listType()
{
	types = []
	for(var i in container){
		types.push(i)
	}
	console.log(types)
}

function countLength()
{
	var count = 0

	for(var i in container){
		count += container[i].containerList.length
	}

	console.log(count)
}

// migrate old container.json to new format
function reMap()
{
	newContainer = {"types": [], container: []}
	types = []

	for(var i in container){
		
		var type = i.substring(0, i.lastIndexOf('[') - 1)
		var nickname = i.substring(i.lastIndexOf('[') + 1, i.lastIndexOf(']'))
		
		if(types.indexOf(type) == -1)
			types.push(type)
		
		list = container[i].containerList.map(x => {
			x.href = container[i].sitePrefix + x.href.substring(1)
			return x
		})

		newContainer.container.push(
			{
				"typeId": types.indexOf(type),
				"nickname": nickname,
				"list": list
			}
		)
	}

	newContainer.types = types

	console.log(JSON.stringify(newContainer,null,4))
}

function reMap2()
{
	data = JSON.parse(fs.readFileSync(dataPath))

	for(var i in data.container)
	{
		//console.log(data.container[i])
		data.container[i].id = i;

		for(var j in data.container[i].list)
			data.container[i].list[j].id = parseInt(j)
	}

	console.log(JSON.stringify(data, null, 4))
}

/*
{
	"schema": 
	[
		{
			// id = index
			"typeName": baidu,
		},
		{
			"typeName": ruten
		}
	],

	"container":
	[
		{
			"id": 0,
			"typeId" : 1,
			"nickName": "MMD Teiba",
			"list" : 
			[
				{
					"id": 0,
					"title": "",
					"href": "",
					"img": "",
					"isNoticed": ""
				}
			]
		},
		{

		}
	]
}
*/
