import type { VenueId } from "./types.js";
import { isValidBaseSymbol } from "./venues.js";

export interface ListedMarket { base: string; venues: VenueId[] }
export type CatalogPhase = "loading" | "ready" | "error" | "cached";
export interface CatalogVenueState { phase: CatalogPhase; count: number; error?: string }
export type CatalogState = Record<VenueId, CatalogVenueState>;
export type CatalogMap = Map<string, Set<VenueId>>;

const CACHE_KEY = "depthline.market-catalog.v1";
const CACHE_TTL = 4 * 60 * 60 * 1000;
const PAGE_LIMIT = 1000;
const VENUE_IDS: VenueId[] = ["binance", "bybit", "okx", "bitget", "gate"];

export function parseMarketBases(venue: VenueId, payload: any): string[] {
  let rows: any[] = [];
  if (venue === "binance") {
    rows = Array.isArray(payload) ? payload : [];
    return unique(rows.map(row => typeof row?.symbol === "string" && row.symbol.endsWith("USDT") ? row.symbol.slice(0, -4) : ""));
  }
  if (venue === "bybit") rows = Array.isArray(payload?.result?.list) ? payload.result.list : [];
  if (venue === "okx") rows = Array.isArray(payload?.data) ? payload.data : [];
  if (venue === "bitget") rows = Array.isArray(payload?.data) ? payload.data : [];
  if (venue === "gate") rows = Array.isArray(payload) ? payload : [];

  return unique(rows.flatMap(row => {
    if (venue === "bybit") return row?.quoteCoin === "USDT" && row?.status === "Trading" ? [row.baseCoin] : [];
    if (venue === "okx") return row?.quoteCcy === "USDT" && row?.state === "live" ? [row.baseCcy] : [];
    if (venue === "bitget") return row?.quoteCoin === "USDT" && row?.status === "online" ? [row.baseCoin] : [];
    if (venue === "gate") return row?.quote === "USDT" && row?.trade_status === "tradable" ? [row.base] : [];
    return [];
  }));
}

function unique(values: unknown[]): string[] {
  return [...new Set(values.map(value => String(value ?? "").trim().toUpperCase()).filter(isValidBaseSymbol))];
}

function emptyStates(): CatalogState {
  return Object.fromEntries(VENUE_IDS.map(id => [id, { phase: "loading", count: 0 }])) as CatalogState;
}

function marketMapFromPairs(pairs: [string, VenueId[]][]): CatalogMap {
  const map: CatalogMap = new Map();
  for (const [rawBase, venueList] of pairs) {
    const base = rawBase.toUpperCase();
    if (!isValidBaseSymbol(base)) continue;
    map.set(base, new Set(venueList.filter(id => VENUE_IDS.includes(id))));
  }
  return map;
}

function readCache(): { map: CatalogMap; savedAt: number; sourceReady: VenueId[] } | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { savedAt?: number; pairs?: [string, VenueId[]][]; sourceReady?: VenueId[] };
    if (!Number.isFinite(parsed.savedAt) || !Array.isArray(parsed.pairs) || !Array.isArray(parsed.sourceReady)) return;
    return { map: marketMapFromPairs(parsed.pairs), savedAt: parsed.savedAt!, sourceReady: parsed.sourceReady };
  } catch { return; }
}

function writeCache(map: CatalogMap, sourceReady: VenueId[]): void {
  if (sourceReady.length < 3) return;
  try {
    const pairs = [...map.entries()].map(([base, venues]) => [base, [...venues]] as [string, VenueId[]]);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), pairs, sourceReady }));
  } catch { /* Private browsing or storage quota: discovery still works for this session. */ }
}

async function fetchJson(url: string, timeoutMs = 12_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

async function fetchVenueMarkets(venue: VenueId): Promise<string[]> {
  if (venue === "binance") {
    // Lightweight public tickers endpoint instead of the multi-megabyte exchangeInfo payload.
    const data = await fetchJson("https://data-api.binance.vision/api/v3/ticker/price");
    return parseMarketBases(venue, data);
  }
  if (venue === "bybit") {
    const all: any[] = [];
    let cursor = "";
    for (let page = 0; page < 8; page++) {
      const query = new URLSearchParams({ category: "spot", limit: String(PAGE_LIMIT) });
      if (cursor) query.set("cursor", cursor);
      const data = await fetchJson(`https://api.bybit.com/v5/market/instruments-info?${query}`);
      if (data?.retCode !== 0 || !Array.isArray(data?.result?.list)) throw new Error(data?.retMsg || "Unexpected catalog response");
      all.push(...data.result.list);
      cursor = String(data.result.nextPageCursor ?? "");
      if (!cursor) break;
    }
    return parseMarketBases(venue, { result: { list: all } });
  }
  if (venue === "okx") {
    const data = await fetchJson("https://www.okx.com/api/v5/public/instruments?instType=SPOT");
    if (data?.code !== "0") throw new Error(data?.msg || "Unexpected catalog response");
    return parseMarketBases(venue, data);
  }
  if (venue === "bitget") {
    const data = await fetchJson("https://api.bitget.com/api/v2/spot/public/symbols");
    if (data?.code !== "00000") throw new Error(data?.msg || "Unexpected catalog response");
    return parseMarketBases(venue, data);
  }
  const data = await fetchJson("https://api.gateio.ws/api/v4/spot/currency_pairs");
  return parseMarketBases(venue, data);
}

export class MarketCatalog {
  markets: CatalogMap = new Map();
  states: CatalogState = emptyStates();
  private loadPromise?: Promise<void>;

  load(refresh: boolean, onUpdate: () => void): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    const cache = readCache();
    if (!refresh && cache && Date.now() - cache.savedAt < CACHE_TTL && cache.map.size) {
      this.markets = cache.map;
      this.states = emptyStates();
      for (const id of VENUE_IDS) {
        const count = [...this.markets.values()].filter(venues => venues.has(id)).length;
        this.states[id] = cache.sourceReady.includes(id)
          ? { phase: "cached", count }
          : { phase: "error", count: 0, error: "Catalog endpoint unavailable on last refresh" };
      }
      onUpdate();
      return Promise.resolve();
    }

    this.states = emptyStates();
    this.loadPromise = Promise.all(VENUE_IDS.map(async venue => {
      try {
        const bases = await fetchVenueMarkets(venue);
        for (const base of bases) {
          const current = this.markets.get(base) ?? new Set<VenueId>();
          current.add(venue); this.markets.set(base, current);
        }
        this.states[venue] = { phase: "ready", count: bases.length };
      } catch (error) {
        this.states[venue] = { phase: "error", count: 0, error: error instanceof Error ? error.message : "Request failed" };
      }
      onUpdate();
    })).then(() => {
      const sourceReady = VENUE_IDS.filter(id => this.states[id].phase === "ready");
      writeCache(this.markets, sourceReady);
      this.loadPromise = undefined;
    });
    return this.loadPromise;
  }

  list(query = ""): ListedMarket[] {
    const needle = query.trim().toUpperCase();
    return [...this.markets.entries()]
      .filter(([base]) => !needle || base.includes(needle))
      .map(([base, venues]) => ({ base, venues: [...venues].sort((a, b) => VENUE_IDS.indexOf(a) - VENUE_IDS.indexOf(b)) }))
      .sort((a, b) => a.base.localeCompare(b.base));
  }

  supports(base: string): boolean { return this.markets.has(base.toUpperCase()); }
  refresh(onUpdate: () => void): Promise<void> {
    this.loadPromise = undefined;
    this.markets = new Map();
    return this.load(true, onUpdate);
  }
}
