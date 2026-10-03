/**
 * SECTION 7G — a WebSocket client that can genuinely STOP READING.
 *
 * Bun's `WebSocket` drains the socket for you: frames are parsed and handed to `onmessage` whether
 * the application wants them or not, so it cannot model a slow consumer. A slow consumer is defined
 * by the bytes sitting unread in the kernel receive buffer, which is what applies TCP backpressure to
 * the sender — and that only happens if nobody reads.
 *
 * So this does the RFC 6455 handshake by hand over a raw socket and then simply stops reading. It
 * parses only enough of the frame format to count text frames when it IS reading; the point is the
 * pause, not a complete protocol implementation.
 */
import net from "node:net";
import crypto from "node:crypto";

export class RawWsClient {
  readonly label: string;
  opened = false;
  closed = false;
  framesRead = 0;
  bytesBuffered = 0;
  handshakeStatus: number | null = null;
  error: string | null = null;
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private reading = true;

  constructor(label: string) {
    this.label = label;
  }

  /** Completes the upgrade and starts reading. Resolves false if the upgrade was not accepted. */
  connect(host: string, port: number, path: string, timeoutMs = 15_000): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (v: boolean) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };

      const key = crypto.randomBytes(16).toString("base64");
      const sock = new net.Socket();
      this.socket = sock;
      const guard = setTimeout(() => {
        this.error = "handshake timeout";
        settle(false);
      }, timeoutMs);

      sock.on("error", (err) => {
        this.error = err.message;
        clearTimeout(guard);
        settle(false);
      });
      sock.on("close", () => {
        this.closed = true;
        clearTimeout(guard);
        settle(this.opened);
      });

      sock.on("data", (raw: Buffer | string) => {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        if (!this.opened) {
          this.buffer = Buffer.concat([this.buffer, chunk]);
          const end = this.buffer.indexOf("\r\n\r\n");
          if (end === -1) return;
          const head = this.buffer.subarray(0, end).toString();
          const statusLine = head.split("\r\n")[0] ?? "";
          this.handshakeStatus = Number(statusLine.split(" ")[1] ?? 0);
          if (this.handshakeStatus !== 101) {
            this.error = `upgrade refused: ${statusLine}`;
            clearTimeout(guard);
            settle(false);
            sock.destroy();
            return;
          }
          this.opened = true;
          this.buffer = this.buffer.subarray(end + 4);
          clearTimeout(guard);
          settle(true);
          this.drain();
          return;
        }
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.bytesBuffered = this.buffer.length;
        if (this.reading) this.drain();
      });

      sock.connect(port, host, () => {
        sock.write(
          `GET ${path} HTTP/1.1\r\n` +
            `Host: ${host}:${port}\r\n` +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Key: ${key}\r\n` +
            "Sec-WebSocket-Version: 13\r\n" +
            "\r\n",
        );
      });
    });
  }

  /**
   * Minimal frame walk: advances past complete frames and counts them. Control frames are counted
   * too — the question this client answers is "how many bytes has the server pushed", not "what did
   * they say".
   */
  private drain(): void {
    while (this.buffer.length >= 2) {
      const second = this.buffer[1]!;
      const masked = (second & 0x80) !== 0;
      let len = second & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        len = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (masked) offset += 4;
      if (this.buffer.length < offset + len) return;
      this.buffer = this.buffer.subarray(offset + len);
      this.framesRead++;
    }
    this.bytesBuffered = this.buffer.length;
  }

  /**
   * Stop consuming. `pause()` stops the kernel handing us data, so the receive window closes and the
   * server's writes back up in ITS send buffer — which is what a real slow consumer does to a
   * broadcaster.
   */
  stopReading(): void {
    this.reading = false;
    this.socket?.pause();
  }

  resumeReading(): void {
    this.reading = true;
    this.socket?.resume();
    this.drain();
  }

  /** Hard teardown with no close frame — the server sees a broken pipe, not a polite goodbye. */
  destroy(): void {
    try {
      this.socket?.destroy();
    } catch {
      /* already gone */
    }
  }
}
