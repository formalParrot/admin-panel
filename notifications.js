const express = require('express');
const requireAdmin = require('./middleware/requireAdmin');
const router = express.Router();

function broadcast(notification) {
  for (const client of clients) {
    try {
      client.write(`data: ${JSON.stringify(notification)}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

function createNotification(message, service) {
  const notification = {
    id: Date.now(),
    message,
    service,
    read: false,
    createdAt: new Date().toISOString()
  };
  notifications.push(notification);
  broadcast(notification);
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
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering
  });
  res.flushHeaders();

  res.write(':ok\n\n'); // initial comment so client knows it's connected
  clients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
      clients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

module.exports = router
