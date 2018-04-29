const fs = require('fs')
const dataPath = './container.json'
var container = JSON.parse(fs.readFileSync(dataPath))

reMap()

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
			"typeId" : 1,
			"nickName": "MMD Teiba",
			"list" : 
			[
				{
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
