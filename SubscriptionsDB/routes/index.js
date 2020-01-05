const express = require('express');
const router = express.Router();

router.get('/', function(req, res, next) {
  res.send('Yello. This is SubscriptionDB entry point.')
});

// api for notification
router.get('/containerType', function(req, res, next) {
  res.send('Yello.')
});

router.get('/notice/:containerId/:entryId', function(req, res, next) {
  const containerId = req.params.containerId
  const entryId = req.params.entryId
  console.log(containerId)
  console.log(entryId)
  res.send('respond with a resource' + containerId + ' ' + entryId);
});

router.get('/noticeAll/:containerId', function(req, res, next) {
  const containerId = req.params.containerId
  console.log(containerId)
  console.log(entryId)
  res.send('respond with a resource' + containerId + ' ' + entryId);
});

router.post('/addEntry', function(req, res, next) {
  console.log(req.body)
  res.send('respond with a resource' + JSON.stringify(req.body));
});

module.exports = router;