import type { VenueId } from "./types.js";

export interface VenueConfig {
  id: VenueId;
  name: string;
  color: string;
  fee: number;
  feeLabel: string;
  bookLevels: number;
  docs: string;
}

export const VENUES: VenueConfig[] = [
  { id: "binance", name: "Binance", color: "#c28a18", fee: 0.1, feeLabel: "Binance Spot", bookLevels: 20, docs: "https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams" },
  { id: "bybit", name: "Bybit", color: "#8f5be8", fee: 0.1, feeLabel: "Bybit Spot", bookLevels: 50, docs: "https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook" },
  { id: "okx", name: "OKX", color: "#263744", fee: 0.1, feeLabel: "OKX Spot", bookLevels: 5, docs: "https://my.okx.com/docs-v5/en/#websocket-api-public-channel-order-book-channel" },
  { id: "bitget", name: "Bitget", color: "#168f83", fee: 0.1, feeLabel: "Bitget Spot", bookLevels: 5, docs: "https://www.bitget.com/api-doc/classic/spot/websocket/public/Order-Book-Channel" },
  { id: "gate", name: "Gate", color: "#3973d2", fee: 0.1, feeLabel: "Gate Spot", bookLevels: 20, docs: "https://www.gate.com/docs/developers/apiv4/ws/en/" }
];
export const VENUE_BY_ID = Object.fromEntries(VENUES.map(v => [v.id, v])) as Record<VenueId, VenueConfig>;

/** Convert a base asset (e.g. SOL, SOLUSDT, SOL/USDT) into venue-native spot symbols. */
export function normalizeBaseSymbol(input: string): string {
  return input.trim().toUpperCase().replace(/[\s/_-]/g, "").replace(/USDT$/, "");
}
export function isValidBaseSymbol(base: string): boolean { return /^[A-Z0-9]{2,24}$/.test(base); }
export function venueSymbol(venue: VenueId, base: string): string {
  const symbol = normalizeBaseSymbol(base);
  if (venue === "okx") return `${symbol}-USDT`;
  if (venue === "gate") return `${symbol}_USDT`;
  return `${symbol}USDT`;
}
