# SubscriptionsDB

SubscriptionsDB is the backend part of my personal crawler. It is responsible for application logic (CRUD) above crawled data.

* For storage part, we used to store data as json file, now changed to postgres for performance & stability.

* We design two tables to store the crawled result. One act as temporarily storage to store unread crawled results, another act as persistent storage since the read data is never change to unread. The read data is stored to determine a crawl result is new or not and to reflect how the information changes in a certain amount of time.

* Another alternative is use AWS RDS to store the data, however it is now deprecated due to cost.
