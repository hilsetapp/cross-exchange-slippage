import test from "node:test";
import assert from "node:assert/strict";
import { executeBook, findBreakEvens, makeNotionalPoints, midpoint, validBook } from "../src/math.js";
import { normalizeBaseSymbol, venueSymbol } from "../src/venues.js";
import { mergeBybitDelta } from "../src/feeds.js";
import { parseMarketBases } from "../src/marketCatalog.js";
import type { OrderBook, VenueCurve } from "../src/types.js";

const book: OrderBook = {
  venue: "binance", symbol: "BTC", receivedAt: Date.now(),
  bids: [[99, 1], [98, 2]], asks: [[101, 1], [102, 2]]
};

test("market buy sweeps asks, includes quote fee and measures against reference mid", () => {
  const result = executeBook(book, 1.5, "buy", 0.1, 100);
  assert.equal(result.filledQuantity, 1.5);
  assert.equal(result.grossQuote, 152);
  assert.ok(Math.abs(result.feeQuote - 0.152) < 1e-12);
  assert.ok(Math.abs(result.effectiveAveragePrice - 101.4346666667) < 1e-8);
  assert.ok(result.slippageQuote > 0);
  assert.equal(result.fullyFilled, true);
});

test("market sell sweeps bids and deducts quote fee", () => {
  const result = executeBook(book, 1.5, "sell", 0.1, 100);
  assert.equal(result.grossQuote, 148);
  assert.ok(Math.abs(result.feeQuote - 0.148) < 1e-12);
  assert.ok(result.slippageQuote > 0);
});

test("partial visible depth is not mislabeled as fully filled", () => {
  const result = executeBook(book, 4, "buy", 0, 100);
  assert.equal(result.filledQuantity, 3);
  assert.equal(result.fillRatio, 0.75);
  assert.equal(result.fullyFilled, false);
});

test("invalid order sizes and fee assumptions are rejected", () => {
  assert.throws(() => executeBook(book, 0, "buy", 0.1, 100));
  assert.throws(() => executeBook(book, 1, "buy", -1, 100));
});

test("notional sweep is logarithmic and includes endpoints", () => {
  const values = makeNotionalPoints(10, 100_000, 6);
  assert.ok(Math.abs(values[0]! - 10) < 1e-10); assert.ok(Math.abs(values.at(-1)! - 100_000) < 1e-6);
  assert.ok(Math.abs(values[2]! / values[1]! - values[1]! / values[0]!) < 1e-8);
});

test("freshness and crossed/empty book checks", () => {
  assert.equal(validBook(book), true);
  assert.equal(validBook({ ...book, receivedAt: Date.now() - 9000 }), false);
  assert.equal(validBook({ ...book, asks: [[98, 1]] }), false);
});

test("symbol adapters generate exchange-specific spot identifiers", () => {
  assert.equal(normalizeBaseSymbol(" sol/usdt "), "SOL");
  assert.equal(venueSymbol("okx", "SOL"), "SOL-USDT");
  assert.equal(venueSymbol("gate", "SOLUSDT"), "SOL_USDT");
  assert.equal(venueSymbol("bybit", "SOL"), "SOLUSDT");
});

test("midpoint is computed from best displayed bid and ask", () => {
  assert.equal(midpoint(book), 100);
});

test("Bybit deltas update prices, delete zero-size levels, sort, and cap depth", () => {
  const previous: OrderBook = { ...book, venue: "bybit", bids: [[99, 1], [98, 2]], asks: [[101, 1], [102, 2]], sequence: 10 };
  const delta: OrderBook = { ...book, venue: "bybit", bids: [[99, 0], [97, 3], [100, 1]], asks: [[101, 4]], sequence: 11, updateType: "delta" };
  const merged = mergeBybitDelta(previous, delta);
  assert.deepEqual(merged.bids, [[100, 1], [98, 2], [97, 3]]);
  assert.deepEqual(merged.asks, [[101, 4], [102, 2]]);
  assert.equal(merged.sequence, 11);
});

test("catalog parsers keep active USDT spot pairs and exclude other quotes or states", () => {
  assert.deepEqual(parseMarketBases("binance", [{ symbol: "BTCUSDT" }, { symbol: "ETHBTC" }]), ["BTC"]);
  assert.deepEqual(parseMarketBases("bybit", { result: { list: [
    { baseCoin: "BTC", quoteCoin: "USDT", status: "Trading" },
    { baseCoin: "BAD", quoteCoin: "USDC", status: "Trading" },
    { baseCoin: "HALT", quoteCoin: "USDT", status: "Settling" }
  ] } }), ["BTC"]);
  assert.deepEqual(parseMarketBases("okx", { data: [
    { baseCcy: "SOL", quoteCcy: "USDT", state: "live" },
    { baseCcy: "BTC", quoteCcy: "USDC", state: "live" }
  ] }), ["SOL"]);
  assert.deepEqual(parseMarketBases("bitget", { data: [
    { baseCoin: "XRP", quoteCoin: "USDT", status: "online" },
    { baseCoin: "OLD", quoteCoin: "USDT", status: "offline" }
  ] }), ["XRP"]);
  assert.deepEqual(parseMarketBases("gate", [
    { base: "DOGE", quote: "USDT", trade_status: "tradable" },
    { base: "ETC", quote: "BTC", trade_status: "tradable" }
  ]), ["DOGE"]);
});

test("break-even detects a change in the lowest-cost venue", () => {
  const curves: VenueCurve[] = [
    { venue: "binance", points: [{ notional: 10, slippageQuote: 1, execution: null }, { notional: 100, slippageQuote: 4, execution: null }] },
    { venue: "bybit", points: [{ notional: 10, slippageQuote: 3, execution: null }, { notional: 100, slippageQuote: 1, execution: null }] }
  ];
  const crossings = findBreakEvens(curves);
  assert.equal(crossings.length, 1);
  assert.equal(crossings[0]!.from, "binance");
  assert.equal(crossings[0]!.to, "bybit");
  assert.ok(crossings[0]!.notional > 10 && crossings[0]!.notional < 100);
});
