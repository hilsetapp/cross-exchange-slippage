export type VenueId = "binance" | "bybit" | "okx" | "bitget" | "gate";
export type Side = "buy" | "sell";
export type Locale = "en" | "ru";
export type Level = readonly [price: number, quantity: number];

export interface OrderBook {
  venue: VenueId;
  symbol: string;
  bids: Level[];
  asks: Level[];
  receivedAt: number;
  exchangeTime?: number;
  sequence?: number;
  updateType?: "snapshot" | "delta";
}

export type ConnectionState = "connecting" | "live" | "stale" | "reconnecting" | "unsupported";
export interface VenueState {
  venue: VenueId;
  state: ConnectionState;
  message?: string;
  book?: OrderBook;
  reconnects: number;
}

export interface Execution {
  targetQuantity: number;
  filledQuantity: number;
  fillRatio: number;
  grossQuote: number;
  feeQuote: number;
  effectiveQuote: number;
  effectiveAveragePrice: number;
  referenceQuote: number;
  slippageQuote: number;
  slippageBps: number;
  fullyFilled: boolean;
  levelsUsed: number;
}

export interface CurvePoint {
  notional: number;
  slippageQuote: number | null;
  execution: Execution | null;
}

export interface VenueCurve {
  venue: VenueId;
  points: CurvePoint[];
}

export interface BreakEven {
  from: VenueId;
  to: VenueId;
  notional: number;
}
