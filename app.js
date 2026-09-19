require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt')
const session = require('express-session');
const requireAdmin = require('./middleware/requireAdmin');
const { loginLimiter, apiLimiter } = require('./middleware/rateLimiter');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express()
app.use(express.json());

const trustProxy = process.env.TRUST_PROXY;
app.set(
  'trust proxy',
  trustProxy === undefined ? 1 : trustProxy === 'true' ? true : Number(trustProxy)
);

const router = express.Router();

const notificationRouter = require('./notifications')
const webhookRouter = require('./webhook')

const allowedActions = {
  issue: "/lock/admin/issue",
  revoke: "/lock/admin/revoke",
  tokens: "/lock/admin/tokens"
};

const sessionStore = new session.MemoryStore();

app.use(session({
  name: 'admin_session',
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, //https
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.get("/admin", (req, res) => {
  res.set("Cache-Control", "no-store");

  if (!req.session?.admin) {
    return res.sendFile(__dirname + "/public/login.html");
  }

  return res.sendFile(__dirname + "/public/admin.html");
});

router.post("/login", loginLimiter, async (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({
      ok: false,
      error: "PIN required"
    });
  }

  const valid = await bcrypt.compare(
    pin,
    process.env.ADMIN_PIN
  );

  if (!valid) {
    return res.status(401).json({
      ok: false,
      error: "Invalid PIN"
    });
  }

  req.session.regenerate(err => {
    if (err) {
      return res.status(500).json({
        ok: false,
        error: "Failed to create session"
      });
    }

    req.session.admin = true;

    req.session.save((saveErr) => {
      if (saveErr) {
        return res.status(500).json({
          ok: false,
          error: "Failed to save session"
        });
      }

      return res.json({
        ok: true
      });
    });
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({
        ok: false,
        error: "Failed to log out."
      });
    };

    res.clearCookie("admin_session");

    return res.json({
      ok: true
    })
  });
})

router.post("/lock", requireAdmin, async (req, res) => {
  const { action, ...body } = req.body;

  const path = allowedActions[action];

  if (!path) {
    return res.status(400).json({
      error: "Invalid action"
    });
  }

  const base = (process.env.LOCK_INTERNAL_URL || process.env.LOCK_API_URL || "").replace(/\/+$/, "");
  const url = `${base}${path}`;

  console.log(`[lock] ${action} -> ${url}`);

  let response;
  try {
    response = await fetch(
      url,
      {
        method: action === "tokens" ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": process.env.LOCK_ADMIN_SECRET
        },
        ...(action !== "tokens" && {
          body: JSON.stringify(body)
        })
      }
    );
  } catch (err) {
    console.error(`[lock] ${action} fetch failed:`, err.message, err.cause || "");
    return res.status(502).json({
      error: "Lock API unreachable"
    });
  }

  console.log(`[lock] ${action} upstream status:`, response.status);

  const text = await response.text();

  if (response.status === 502) {
    console.error(`[lock] ${action} got 502 from upstream (origin behind Cloudflare likely down):`);
    console.error(`[lock] body (first 400 chars):`, text.slice(0, 400));
  } else {
    console.log(`[lock] ${action} response (first 500 chars):`, text.slice(0, 500));
  }

  return res.status(response.status).send(text);
});

router.all("/f42/*splat", requireAdmin, async (req, res) => {
  const splat = Array.isArray(req.params.splat) ? req.params.splat.join('/') : req.params.splat;

  try {
    const response = await fetch(`${(process.env.F42_INTERNAL_URL || 'https://api.justparrot.me').replace(/\/+$/, '')}/f42/${splat}`, {
      method: req.method,
      headers: {
        'Content-Type': "application/json",
        'x-api-key': process.env.F42_API_KEY,
      },
      ...(req.method !== "GET" && {
        body: JSON.stringify(req.body)
      })
    });

    const text = await response.text();

    return res.status(response.status).send(text);
  } catch (err) {
    console.error(`[f42] ${splat} fetch failed:`, err.message);
    return res.status(502).json({ error: "F42 API unreachable" });
  }
})

app.use("/admin", router);
app.use("/admin/notifications", notificationRouter)
app.use("/admin/webhook", webhookRouter)

app.get("/", (req, res) => res.redirect("/admin"));

app.get("/admin/style.css", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "style.css"));
});

app.use(express.static(path.join(__dirname, 'public/assets/')));

const PORT = process.env.PORT || 9879;
const server = app.listen(PORT, () => console.log(`Admin API running on port ${PORT}`));

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  console.log(`[f42:ws] upgrade request: ${req.url}`);

  if (!pathname.startsWith('/admin/f42/')) {
    console.log(`[f42:ws] path doesn't match: ${pathname}`);
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const splat = pathname.replace('/admin/f42/', '');

  const cookieLib = require('cookie');
  const signatureLib = require('cookie-signature');
  const cookies = cookieLib.parse(req.headers.cookie || '');
  const rawSid = cookies['admin_session'];
  console.log(`[f42:ws] cookie present: ${!!rawSid}`);
  let sid;
  if (rawSid && rawSid.startsWith('s:')) {
    sid = signatureLib.unsign(rawSid.slice(2), process.env.SESSION_SECRET);
  }
  console.log(`[f42:ws] session id after unsign: ${sid ? '(valid)' : '(invalid/none)'}`);

  const isAuthorized = () => {
    const crypto = require('crypto');
    const adminKey = process.env.ADMIN_KEY;
    const providedKey = req.headers['x-admin-key'];
    if (adminKey && providedKey && Buffer.from(providedKey).length === Buffer.from(adminKey).length) {
      try {
        return crypto.timingSafeEqual(Buffer.from(providedKey), Buffer.from(adminKey));
      } catch { /* fall through */ }
    }
    return false;
  };

  const proceed = (authorized) => {
    if (!authorized) {
      console.log(`[f42:ws] unauthorized, sending 401`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    console.log(`[f42:ws] authorized, upgrading...`);
    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const params = new URLSearchParams(url.search);
      if (!params.has('token')) {
        params.set('token', process.env.F42_API_KEY);
      }
      const qs = params.toString();
      const wsBase = process.env.F42_WS_INTERNAL_URL || 'wss://api.justparrot.me';
      const upstreamUrl = `${wsBase}/f42/${splat}${qs ? `?${qs}` : ''}`;

      console.log(`[f42:ws] client upgraded, connecting upstream: ${upstreamUrl}`);
      const upstream = new WebSocket(upstreamUrl, {
        headers: { 'x-api-key': process.env.F42_API_KEY }
      });

      upstream.on('open', () => {
        console.log(`[f42:ws] upstream open, bridging`);
        clientWs.on('message', (data) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
        });
        upstream.on('message', (data) => {
          if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
        });
      });

      clientWs.on('close', () => { console.log(`[f42:ws] client closed`); upstream.close(); });
      upstream.on('close', () => clientWs.close());
      upstream.on('error', (err) => {
        console.error(`[f42:ws] upstream error:`, err.message);
        clientWs.close(1011, 'Upstream error');
      });
      clientWs.on('error', (err) => {
        console.error(`[f42:ws] client error:`, err.message);
        upstream.close();
      });
    });
  };

  if (isAuthorized()) {
    return proceed(true);
  }

  if (!sid) {
    return proceed(false);
  }

  sessionStore.get(sid, (err, session) => {
    console.log(`[f42:ws] session lookup err=${!!err} admin=${session?.admin === true}`);
    proceed(!err && session?.admin === true);
  });
});

server.on('clientError', (err, socket) => {
  console.error('[f42:ws] clientError:', err.message);
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});
