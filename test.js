t = require('./api.js')

version = 2

if(version == 0)
{
	t.AddEntry([18, {
	"title" : "tset1235",
	"img" : '123',
	"href" : "11",
	"isNoticed" : false
	}])
	.then(() => t.GetContainer())
	.then(data => console.log(JSON.stringify(data,null,4)))
}
else if(version == 1)
{
	t.AddEntry([18, {
		"title" : "tset2",
		"img" : '123',
		"href" : "11",
		"isNoticed" : false
		}])
	.then( () => t.AddEntry([18, {
		"title" : "tset1",
		"img" : '123',
		"href" : "11",
		"isNoticed" : false
		}]))
	.then(() => t.GetContainer())
	.then(data => console.log(JSON.stringify(data,null,4)))
}
else if(version == 2)
{

	t.GetContainer().then( data => 
		t.AddEntry([18, {
			"title" : "ta",
			"img" : '123',
			"href" : "11",
			"isNoticed" : false
			}])
		)
	.then( () => t.AddEntry([18, {
		"title" : "ta1",
		"img" : '123',
		"href" : "11",
		"isNoticed" : false
		}]))
	//.then(data => console.log(JSON.stringify(data,null,4)))
}
