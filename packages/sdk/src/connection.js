/**
 * AXIP SDK — WebSocket Connection Manager
 *
 * Wraps the ws WebSocket client with:
 *   - Auto-reconnect with exponential backoff
 *   - Heartbeat timer
 *   - JSON message parsing
 *   - Event-based interface
 *
 * This layer is protocol-agnostic — it handles raw WebSocket plumbing.
 * The AXIPAgent class adds protocol semantics on top.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

export class AXIPConnection extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string} opts.url - WebSocket URL (e.g. 'wss://relay.axiosaiinnovations.com' for production, 'ws://127.0.0.1:4200' for local dev)
   * @param {boolean} [opts.reconnect=true] - Auto-reconnect on disconnect
   * @param {number} [opts.heartbeatInterval=30000] - Heartbeat interval in ms
   * @param {number} [opts.maxReconnectDelay=30000] - Max delay between reconnects
   */
  constructor({ url, reconnect = true, heartbeatInterval = 30000, maxReconnectDelay = 30000 }) {
    super();
    this.url = url;
    this.shouldReconnect = reconnect;
    this.heartbeatInterval = heartbeatInterval;
    this.maxReconnectDelay = maxReconnectDelay;

    this.ws = null;
    this.connected = false;
    this.reconnectDelay = 1000;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
  }

  /**
   * Open the WebSocket connection.
   * Returns a promise that resolves when connected.
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
      } catch (err) {
        reject(err);
        return;
      }

      // Resolve/reject only for the initial connection attempt
      let settled = false;

      this.ws.on('open', () => {
        this.connected = true;
        this.reconnectDelay = 1000; // Reset backoff on successful connect
        this._startHeartbeat();
        this.emit('connected');

        if (!settled) {
          settled = true;
          resolve();
        }
      });

      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.emit('message', msg);
        } catch (err) {
          console.warn(`[connection] Malformed message received: ${err.message}`);
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
        this._stopHeartbeat();
        this.emit('disconnected');
        this._scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        // Don't log ECONNREFUSED during reconnect attempts — it's expected
        if (err.code !== 'ECONNREFUSED') {
          console.error(`[connection] WebSocket error: ${err.message}`);
        }

        if (!settled) {
          settled = true;
          reject(err);
        }
        // The 'close' event fires after 'error', which handles reconnect
      });
    });
  }

  /**
   * Send a JSON message over the WebSocket.
   * @param {Object} msg - Message object to serialize and send
   */
  send(msg) {
    if (!this.connected || !this.ws) {
      throw new Error('Not connected');
    }
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Gracefully disconnect. Disables auto-reconnect.
   */
  disconnect() {
    this.shouldReconnect = false;
    this._stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  _scheduleReconnect() {
    if (!this.shouldReconnect) return;

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        // connect() failed, 'close' handler will fire and re-schedule
      }
    }, this.reconnectDelay);

    // Exponential backoff with cap
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  /**
   * Start the heartbeat interval timer.
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.emit('heartbeat-needed');
    }, this.heartbeatInterval);
  }

  /**
   * Stop the heartbeat timer.
   */
  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
