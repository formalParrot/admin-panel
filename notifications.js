const express = require('express');
const requireAdmin = require('./middleware/requireAdmin');
const router = express.Router();

function createNotification(message, service) {
  const notification = {
    id: Date.now(),
    message,
    service,
    read: false,
    createdAt: new Date().toISOString()
  };
  notifications.push(notification);
  for (const client of clients) {
    client.write(`data: ${JSON.stringify(notification)}\n\n`);
  }
  return notification;
}

const notifications = [];
const clients = new Set();

let lastSeenAt = null;

router.post('/', requireAdmin, (req, res) => {
  const { message, service } = req.body;
  const notification = {
    id: Date.now(),
    message,
    service,
    read: false,
    createdAt: new Date().toISOString()
  };
  notifications.push(notification)

  for (const client of clients) {
    client.write(`data: ${JSON.stringify(notification)}\n\n`)
  }

  res.status(201).json(notification);
})

router.get('/', requireAdmin, (req, res) => {
  res.json(notifications);
})

router.patch('/:id/read', requireAdmin, (req, res) => {
  const n = notifications.find(n => n.id === Number(req.params.id));
  if (n) n.read = true;
  res.sendStatus(204)
})

router.get('/missed', requireAdmin, (req, res) => {
  const missed = lastSeenAt
    ? notifications.filter(n => new Date(n.createdAt) > new Date(lastSeenAt))
    : notifications;

  res.json(missed)
})

router.post('/mark-seen', requireAdmin, (req, res) => {
  lastSeenAt = new Date().toISOString();
  res.sendStatus(204);
});

router.get('/stream', requireAdmin, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.flushHeaders()

  clients.add(res)

  req.on('close', () => {
    clients.delete(res)
  })
})

module.exports = router
