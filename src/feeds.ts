import type { Level, OrderBook, VenueId, VenueState } from "./types.js";
import { VENUE_BY_ID, venueSymbol } from "./venues.js";

export type VenueCallback = (venue: VenueId, patch: Partial<VenueState>) => void;

function levels(raw: unknown, keepZero = false): Level[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: unknown) => {
    if (!Array.isArray(item)) return [NaN, NaN] as const;
    return [Number(item[0]), Number(item[1])] as const;
  }).filter(([p, q]) => Number.isFinite(p) && Number.isFinite(q) && p > 0 && (keepZero ? q >= 0 : q > 0));
}
function makeBook(venue: VenueId, symbol: string, bids: unknown, asks: unknown, time?: unknown, seq?: unknown, keepZero = false): OrderBook {
  return { venue, symbol, bids: levels(bids, keepZero), asks: levels(asks, keepZero), receivedAt: Date.now(),
    exchangeTime: Number.isFinite(Number(time)) ? Number(time) : undefined,
    sequence: Number.isFinite(Number(seq)) ? Number(seq) : undefined };
}

interface Feed { id: VenueId; url: string; open(ws: WebSocket, symbol: string): void; parse(data: any, symbol: string): OrderBook | undefined }

const feeds: Feed[] = [
  {
    id: "binance", url: "wss://stream.binance.com:9443/ws",
    open: (ws, symbol) => ws.send(JSON.stringify({ method: "SUBSCRIBE", params: [`${symbol.toLowerCase()}@depth20@100ms`], id: 1 })),
    parse: (m, symbol) => { const d = m?.data ?? m; return d?.bids && d?.asks ? makeBook("binance", symbol, d.bids, d.asks, d.E, d.lastUpdateId) : undefined; }
  },
  {
    id: "bybit", url: "wss://stream.bybit.com/v5/public/spot",
    open: (ws, symbol) => ws.send(JSON.stringify({ op: "subscribe", args: [`orderbook.50.${symbol}`] })),
    parse: (m, symbol) => { if (!String(m?.topic ?? "").startsWith("orderbook.")) return; const d = m.data; if (!d?.b || !d?.a) return; const book = makeBook("bybit", symbol, d.b, d.a, m.ts, d.u ?? d.seq, m.type === "delta"); book.updateType = m.type === "delta" ? "delta" : "snapshot"; return book; }
  },
  {
    id: "okx", url: "wss://ws.okx.com:8443/ws/v5/public",
    open: (ws, symbol) => { ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "books5", instId: venueSymbol("okx", symbol) }] })); },
    parse: (m, symbol) => { const d = m?.data?.[0]; if (!d?.bids || !d?.asks) return; return makeBook("okx", symbol, d.bids, d.asks, d.ts, d.seqId); }
  },
  {
    id: "bitget", url: "wss://ws.bitget.com/v2/ws/public",
    open: (ws, symbol) => ws.send(JSON.stringify({ op: "subscribe", args: [{ instType: "SPOT", channel: "books5", instId: venueSymbol("bitget", symbol) }] })),
    parse: (m, symbol) => { const d = m?.data?.[0]; if (!d?.bids || !d?.asks) return; return makeBook("bitget", symbol, d.bids, d.asks, d.ts, d.seq); }
  },
  {
    id: "gate", url: "wss://api.gateio.ws/ws/v4/",
    open: (ws, symbol) => ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "spot.order_book", event: "subscribe", payload: [venueSymbol("gate", symbol), "20", "100ms"] })),
    parse: (m, symbol) => { if (m?.channel !== "spot.order_book" || !m.result) return; const d = m.result; return makeBook("gate", symbol, d.bids, d.asks, d.update ?? m.time_ms, d.id); }
  }
];

export function mergeBybitDelta(previous: OrderBook, delta: OrderBook): OrderBook {
  const merge = (before: Level[], changes: Level[], descending: boolean): Level[] => {
    const byPrice = new Map(before.map(([price, qty]) => [price, qty]));
    for (const [price, qty] of changes) { if (qty === 0) byPrice.delete(price); else byPrice.set(price, qty); }
    return [...byPrice].map(([price, qty]) => [price, qty] as const).sort((a, b) => descending ? b[0] - a[0] : a[0] - b[0]).slice(0, 50);
  };
  return { ...delta, bids: merge(previous.bids, delta.bids, true), asks: merge(previous.asks, delta.asks, false), updateType: "snapshot" };
}

export class FeedManager {
  private sockets = new Map<VenueId, WebSocket>();
  private currentBooks = new Map<VenueId, OrderBook>();
  private timers = new Map<VenueId, ReturnType<typeof setTimeout>>();
  private reconnects = new Map<VenueId, number>();
  private stopped = false;
  private symbol = "BTC";
  constructor(private readonly callback: VenueCallback) {}

  connect(symbol: string): void {
    this.disconnect(); this.stopped = false; this.symbol = symbol; this.currentBooks.clear();
    for (const feed of feeds) this.open(feed);
  }
  disconnect(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const socket of this.sockets.values()) { socket.onclose = null; try { socket.close(); } catch { /* no-op */ } }
    this.sockets.clear();
  }
  private open(feed: Feed): void {
    if (this.stopped) return;
    const symbol = this.symbol;
    if (feed.id === "bybit") this.currentBooks.delete(feed.id);
    this.callback(feed.id, { state: (this.reconnects.get(feed.id) ?? 0) ? "reconnecting" : "connecting", message: undefined });
    try {
      const ws = new WebSocket(feed.url); this.sockets.set(feed.id, ws);
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let errorSeen = false;
      ws.onopen = () => {
        if (this.stopped || this.sockets.get(feed.id) !== ws) return;
        this.reconnects.set(feed.id, 0); feed.open(ws, symbol);
        if (feed.id === "bitget") heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send("ping"); }, 25_000);
        if (feed.id === "bybit") heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: "ping" })); }, 20_000);
        if (feed.id === "gate") heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "spot.ping" })); }, 20_000);
      };
      ws.onmessage = event => {
        if (typeof event.data === "string" && event.data === "ping") { if (ws.readyState === WebSocket.OPEN) ws.send("pong"); return; }
        if (typeof event.data === "string" && event.data === "pong") return;
        let message: any;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message?.event === "error" || (message?.code && message?.msg)) {
          this.callback(feed.id, { state: "unsupported", message: String(message.msg ?? message.code).slice(0, 120) }); return;
        }
        const incoming = feed.parse(message, symbol);
        if (!incoming) return;
        let book = incoming;
        if (feed.id === "bybit" && incoming.updateType === "delta") {
          const previous = this.currentBooks.get(feed.id);
          if (!previous) return;
          if (previous.sequence !== undefined && incoming.sequence !== undefined && incoming.sequence < previous.sequence) return;
          book = mergeBybitDelta(previous, incoming);
        }
        if (book.bids.length && book.asks.length) {
          this.currentBooks.set(feed.id, book);
          this.callback(feed.id, { state: "live", book, message: undefined });
        }
      };
      ws.onerror = () => { errorSeen = true; this.callback(feed.id, { state: "reconnecting", message: "Connection blocked or unavailable" }); };
      ws.onclose = event => {
        if (heartbeat) clearInterval(heartbeat);
        if (this.sockets.get(feed.id) !== ws) return;
        this.sockets.delete(feed.id);
        if (this.stopped) return;
        const count = (this.reconnects.get(feed.id) ?? 0) + 1; this.reconnects.set(feed.id, count);
        this.callback(feed.id, { state: "reconnecting", message: event.reason ? event.reason.slice(0, 100) : errorSeen ? "Connection blocked or unavailable" : undefined, reconnects: count });
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(count - 1, 5)) * (0.85 + Math.random() * 0.3);
        const timer = setTimeout(() => { this.timers.delete(feed.id); this.open(feed); }, delay); this.timers.set(feed.id, timer);
      };
    } catch (error) {
      this.callback(feed.id, { state: "unsupported", message: error instanceof Error ? error.message : "WebSocket unavailable" });
    }
  }
}

export function startFreshnessMonitor(states: Record<VenueId, VenueState>, update: (id: VenueId, state: "live" | "stale") => void): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const now = Date.now();
    for (const [id, state] of Object.entries(states) as [VenueId, VenueState][]) {
      if (state.book && state.state === "live" && now - state.book.receivedAt > 5000) update(id, "stale");
    }
  }, 1000);
}

export function venueName(id: VenueId): string { return VENUE_BY_ID[id].name; }
