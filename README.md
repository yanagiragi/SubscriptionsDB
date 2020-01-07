# SubscriptionsDB

### Run Server

```bash
cd bin && sh run.sh
```

### Data Format (data/container.json)

```
{
  "types": [
    "baidu"
  ],
  "container": [
    {
      "id": 0, // id != container 中的 index, 因為可能會有跳號的情形 (例如: id 不連續)
      "typeId" : 1, // 對應 types 中的 "baidu"
      "nickName": "MMD Teiba",
      "list" : [
        {
          "id": 0, // id != list 中的 index, 因為可能會有跳號的情形 (例如: id 不連續)
          "title": "456",
          "href": "https://123.com/456",
          "img": "NULL", // 'NULL' 代表沒有資料
          "isNoticed": false
        }
      ]
    }
  ]
}
```
