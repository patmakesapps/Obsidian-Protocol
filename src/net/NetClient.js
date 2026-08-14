/**
 * Thin WebSocket client for the multiplayer relay.
 *
 * Owns nothing but the socket: connection, JSON framing, and a handler map.
 * Game-facing logic (avatars, damage, scoreboard) lives in Netplay — this
 * class is deliberately dumb so it can also be used by the menu for one-shot
 * queries like the leaderboard.
 */
export class NetClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.handlers = new Map();
    this.onClose = null;
  }

  /**
   * Which relay to talk to, in priority order:
   *  1. `?server=` in the URL (ad-hoc testing)
   *  2. VITE_MP_SERVER baked in at build time — this is how a static deploy
   *     (Vercel/Firebase) points at a relay hosted elsewhere
   *  3. the host the page came from: port 8081 in dev, same port in prod,
   *     which covers LAN play and the all-in-one `npm run play` server
   */
  static defaultUrl() {
    const params = new URLSearchParams(window.location.search);
    const override = params.get('server');
    if (override) return override.startsWith('ws') ? override : `ws://${override}`;

    const configured = import.meta.env?.VITE_MP_SERVER;
    if (configured) return configured.startsWith('ws') ? configured : `wss://${configured}`;

    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.hostname || 'localhost';
    // Vite dev serves on 5173; the relay is a separate process on 8081. In a
    // production deploy the node server serves both game and relay on one port.
    const port = window.location.port === '5173' ? '8081' : window.location.port;
    return `${scheme}://${host}${port ? `:${port}` : ''}`;
  }

  connect(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(new Error('SERVER UNREACHABLE'));
      }, timeoutMs);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.connected = true;
        resolve(this);
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('SERVER UNREACHABLE'));
      };
      ws.onclose = () => {
        this.connected = false;
        this.onClose?.();
      };
      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        this.handlers.get(msg.t)?.(msg);
      };
    });
  }

  on(type, handler) {
    this.handlers.set(type, handler);
    return this;
  }

  send(message) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(message));
  }

  /** Sends a request and resolves on the first message of one of `replyTypes`. */
  request(message, replyTypes, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        for (const t of replyTypes) this.handlers.delete(t);
        reject(new Error('SERVER TIMEOUT'));
      }, timeoutMs);
      for (const t of replyTypes) {
        this.on(t, (msg) => {
          clearTimeout(timer);
          for (const t2 of replyTypes) this.handlers.delete(t2);
          resolve(msg);
        });
      }
      this.send(message);
    });
  }

  close() {
    this.onClose = null;
    this.ws?.close();
  }
}
