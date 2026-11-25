import type { BreakEven, CurvePoint, Execution, OrderBook, Side, VenueCurve, VenueId } from "./types.js";

const EPSILON = 1e-12;

export function validBook(book: OrderBook | undefined, now = Date.now(), maxAgeMs = 5000): book is OrderBook {
  return !!book && now - book.receivedAt <= maxAgeMs && book.bids.length > 0 && book.asks.length > 0 && bestBid(book) < bestAsk(book);
}
export function bestBid(book: OrderBook): number { return Math.max(...book.bids.map(([price]) => price)); }
export function bestAsk(book: OrderBook): number { return Math.min(...book.asks.map(([price]) => price)); }
export function midpoint(book: OrderBook): number { return (bestBid(book) + bestAsk(book)) / 2; }

/**
 * Simulate a marketable spot order against the visible price levels.
 * feePercent is a quote-denominated taker-fee assumption (e.g. 0.1 = 0.1%).
 */
export function executeBook(book: OrderBook, targetQuantity: number, side: Side, feePercent: number, referenceMid: number): Execution {
  if (!(targetQuantity > 0) || !Number.isFinite(targetQuantity)) throw new Error("targetQuantity must be a finite positive number.");
  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 10) throw new Error("feePercent must be between 0 and 10.");
  if (!(referenceMid > 0) || !Number.isFinite(referenceMid)) throw new Error("referenceMid must be a finite positive number.");
  const levels = side === "buy" ? [...book.asks].sort((a, b) => a[0] - b[0]) : [...book.bids].sort((a, b) => b[0] - a[0]);
  let remaining = targetQuantity; let filledQuantity = 0; let grossQuote = 0; let levelsUsed = 0;
  for (const [price, quantity] of levels) {
    if (!(price > 0) || !(quantity > 0) || !Number.isFinite(price) || !Number.isFinite(quantity)) continue;
    const take = Math.min(remaining, quantity);
    if (take <= 0) break;
    grossQuote += take * price; filledQuantity += take; remaining -= take; levelsUsed++;
    if (remaining <= Math.max(EPSILON, targetQuantity * EPSILON)) break;
  }
  const fillRatio = filledQuantity / targetQuantity;
  const feeQuote = grossQuote * feePercent / 100;
  const effectiveQuote = side === "buy" ? grossQuote + feeQuote : grossQuote - feeQuote;
  const effectiveAveragePrice = filledQuantity > 0 ? effectiveQuote / filledQuantity : 0;
  const referenceQuote = filledQuantity * referenceMid;
  const slippageQuote = side === "buy" ? effectiveQuote - referenceQuote : referenceQuote - effectiveQuote;
  return {
    targetQuantity, filledQuantity, fillRatio: Math.min(1, fillRatio), grossQuote, feeQuote, effectiveQuote,
    effectiveAveragePrice, referenceQuote, slippageQuote,
    slippageBps: referenceQuote > 0 ? slippageQuote / referenceQuote * 10_000 : 0,
    fullyFilled: fillRatio >= 1 - 1e-9, levelsUsed
  };
}

export function makeNotionalPoints(min: number, max: number, count = 32): number[] {
  if (!(min > 0) || !(max >= min) || !Number.isInteger(count) || count < 2) throw new Error("Invalid notional range.");
  return Array.from({ length: count }, (_, i) => Math.exp(Math.log(min) + (Math.log(max) - Math.log(min)) * i / (count - 1)));
}

export function buildCurves(books: Partial<Record<VenueId, OrderBook>>, fees: Record<VenueId, number>, side: Side, referenceMid: number, notionals: number[]): VenueCurve[] {
  return Object.entries(books).map(([venueKey, book]) => {
    const venue = venueKey as VenueId;
    return { venue, points: notionals.map(notional => {
      try {
        const execution = executeBook(book!, notional / referenceMid, side, fees[venue], referenceMid);
        return { notional, slippageQuote: execution.fullyFilled ? execution.slippageQuote : null, execution };
      } catch { return { notional, slippageQuote: null, execution: null }; }
    }) };
  });
}

function winnerAt(curves: VenueCurve[], index: number): VenueId | undefined {
  let best: { venue: VenueId; value: number } | undefined;
  for (const curve of curves) {
    const point = curve.points[index]; if (point?.slippageQuote === null || point?.slippageQuote === undefined) continue;
    if (!best || point.slippageQuote < best.value) best = { venue: curve.venue, value: point.slippageQuote };
  }
  return best?.venue;
}

/** Approximate a winner-change crossing by linear interpolation between sampled notionals. */
export function findBreakEvens(curves: VenueCurve[]): BreakEven[] {
  if (!curves.length) return [];
  const length = Math.min(...curves.map(curve => curve.points.length)); const out: BreakEven[] = [];
  for (let i = 1; i < length; i++) {
    const before = winnerAt(curves, i - 1); const after = winnerAt(curves, i);
    if (!before || !after || before === after) continue;
    const a = curves.find(c => c.venue === before)?.points[i - 1];
    const b = curves.find(c => c.venue === after)?.points[i - 1];
    const c = curves.find(c => c.venue === before)?.points[i];
    const d = curves.find(c => c.venue === after)?.points[i];
    if (a?.slippageQuote === null || b?.slippageQuote === null || c?.slippageQuote === null || d?.slippageQuote === null ||
        a?.slippageQuote === undefined || b?.slippageQuote === undefined || c?.slippageQuote === undefined || d?.slippageQuote === undefined) continue;
    const diff0 = a.slippageQuote - b.slippageQuote; const diff1 = c.slippageQuote - d.slippageQuote;
    const fraction = diff0 === diff1 ? 0.5 : Math.max(0, Math.min(1, diff0 / (diff0 - diff1)));
    const x0 = curves[0]!.points[i - 1]!.notional; const x1 = curves[0]!.points[i]!.notional;
    out.push({ from: before, to: after, notional: x0 + (x1 - x0) * fraction });
  }
  return out;
}

export function median(values: number[]): number | undefined {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function selectedCurvePoint(curve: VenueCurve | undefined, target: number): CurvePoint | undefined {
  if (!curve?.points.length) return undefined;
  return curve.points.reduce((best, current) => Math.abs(current.notional - target) < Math.abs(best.notional - target) ? current : best);
}
