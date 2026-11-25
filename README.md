# Depthline — Cross-Exchange Spot Slippage

**See what a spot order costs at visible size.** Depthline compares marketable buy/sell execution across five exchanges using public order-book WebSockets. It runs entirely in your browser: no API key, account, proxy, or application backend.

> **[Open the live workbench](https://hilsetapp.github.io/cross-exchange-slippage/)** · [Report an issue](https://github.com/hilsetapp/cross-exchange-slippage/issues)

Depthline is an indicative market-data analysis tool, not an execution venue, arbitrage bot, or promise of fill quality.

## What it does

- Streams public spot books from **Binance, Bybit, OKX, Bitget, and Gate**.
- Searches the union of active **USDT spot pairs** discovered from the five exchange market catalogs. Each result shows which venues list the pair; catalog failures are reported, and a manual symbol can still be tried.
- Saves favorite markets locally and supports a persistent dark theme.
- Compares the visible book for a base symbol against its **USDT** spot market.
- Lets you model **buy base** or **sell base**, choose a quote-notional size from 10 to 100,000 USDT, and set a taker-fee assumption per venue.
- Sweeps the visible levels to estimate filled quantity, gross quote, quote-denominated fee, fee-adjusted average price, and net cost relative to the median midpoint of fresh books.
- Draws a live, logarithmic size curve and marks approximate changes in the lowest-cost venue when the curves cross.
- Shows live/stale/retrying/unavailable status, last-update age, best bid/ask, and partial-fill coverage for each exchange. A feed that returns no book is marked unavailable after 12 seconds rather than spinning forever.
- Supports English and Russian; settings can be shared in the URL.

## Start locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`). The market catalog and book feeds connect directly from the browser to public exchange endpoints. Market symbols are cached in local storage for four hours; use **Refresh market list** to query again. Catalog and WebSocket access may vary by network or region, so the picker reports partial catalog availability and the feed panel reports per-venue state.

## How to read the numbers

- The searchable picker merges USDT spot listings from the five public market catalogs, labels every pair with its listing venues, and lets you save favorites. It is the **union** of available lists, not only symbols shared by all venues. If an exchange catalog is blocked, that source is marked and its listing coverage is unknown. You can still try a base symbol such as **BTC** or **SOLUSDT** manually. The quote is USDT; non-USDT pairs and exchange-specific aliases are not translated automatically.
- The dollar sign is a compact display for the **USDT quote amount**; it does not convert USDT into USD.
- For a selected notional `N`, the target base quantity is `N / reference midpoint`. Each book is swept from the best ask (buy) or best bid (sell) until that quantity is filled or the received visible levels run out.
- Fees are applied as a percentage of quote notional: `gross quote × fee %`. This is an editable **assumption**, not a live account-specific fee lookup. Fee-token discounts, VIP tier, rebates, and fee-asset rounding are not modeled.
- The reference midpoint is the median of the best bid/ask midpoints from currently fresh, non-crossed books. Net cost includes the fee and the visible-book difference from that reference: positive means a modeled cost over the midpoint; negative means the visible execution appears better than it.
- The curve only plots sizes with enough displayed levels to fill the modeled quantity. A missing segment means the visible depth was insufficient at that size; it does not mean the venue has no liquidity beyond the subscribed snapshot.
- A “venue crossover” is an approximate crossing in these sampled curves, not an arbitrage break-even after moving funds. It can move or disappear when books, available venues, fee assumptions, or market conditions change.

## Important limitations

This is **not an execution guarantee or an arbitrage signal**. Published books are shallow snapshots and can change before an order arrives. Exchanges publish different numbers of levels and update at different cadences; data may be delayed, geographically restricted, or unavailable. The order-book prices are not synchronized and may reflect different moments. Market impact beyond returned levels is unknown.

The model excludes withdrawals, network fees, transfer delays, inventory and capital costs, taxes, funding, account restrictions, order-size rules, execution latency, and other costs. It does not submit orders or access private account data. No API keys are requested or stored. Do not use the chart alone to make a trading decision.

## Market-data adapters

The app uses public snapshot/depth channels and does not build a full, sequence-synchronized local book. That keeps the client small, but means depth coverage and precision differ by venue.

| Venue | Browser endpoint and channel | Requested book |
| --- | --- | --- |
| Binance Spot | `stream.binance.com:9443/ws`, `@depth20@100ms` | Partial depth, up to 20 levels |
| Bybit Spot | V5 public Spot, `orderbook.50.SYMBOL` | 50-level snapshot merged with level deltas |
| OKX Spot | V5 public, `books5` | Five levels |
| Bitget Spot | V2 public, `books5` | Five-level snapshots |
| Gate Spot | V4, `spot.order_book` | 20-level updates at 100 ms |

See the [official exchange documentation](#exchange-documentation) for current channel and connectivity requirements. Bybit's initial 50-level snapshot is merged with its documented price-level deltas, including zero-quantity deletions; the displayed book is capped to those subscribed 50 levels and is not a complete exchange book. OKX/Bitget/Gate snapshots are consumed as provided. The app reports **browser receipt age**, not guaranteed exchange-side latency.

A connectivity smoke test from the development sandbox received order-book payloads from Bybit, OKX, Bitget, and Gate. Binance returned an HTTP 451 handshake response from that test network. This is not a browser-wide verdict: exchange access can depend on network, region, and policy. The app intentionally exposes live connection state rather than claiming that every venue works everywhere.

## Market-list sources

The picker reads public listing endpoints directly in the browser and keeps only active USDT spot pairs where the API exposes a status field. Binance uses its lightweight public ticker/price list. The catalog is cached in local storage for four hours; a manual refresh re-queries the sources. A failed source does not erase other venues' results.

- Binance: [`GET /api/v3/ticker/price`](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#symbol-price-ticker)
- Bybit: [`GET /v5/market/instruments-info?category=spot`](https://bybit-exchange.github.io/docs/v5/market/instrument)
- OKX: [`GET /api/v5/public/instruments?instType=SPOT`](https://my.okx.com/docs-v5/en/#rest-api-public-data-get-instruments)
- Bitget: [Classic Spot public symbols](https://bitgetlimited.github.io/apidoc/en/spot/#get-symbols)
- Gate: [Spot currency pairs](https://www.gate.com/docs/developers/apiv4/en/#list-all-currency-pairs)

## Development

```bash
npm run check  # TypeScript, unit tests, and production build
npm run build
```

The tests cover VWAP/fee arithmetic, partial depth, freshness validation, notional sampling, symbol mapping, Bybit delta merging, and approximate crossover detection. They do not simulate exchange execution or certify browser connectivity in every region.

The live demo is published from the `gh-pages` branch. See [deployment notes](docs/deployment.md) to publish a build update.

## Exchange documentation

- [Binance Spot WebSocket streams](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams)
- [Bybit V5 public order book](https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook)
- [Bybit V5 public WebSocket connection](https://bybit-exchange.github.io/docs/v5/ws/connect)
- [OKX API documentation — WebSocket public order books](https://my.okx.com/docs-v5/en/)
- [Bitget Classic Spot WebSocket order-book channel](https://www.bitget.com/api-doc/classic/spot/websocket/public/Order-Book-Channel)
- [Gate API v4 WebSocket documentation](https://www.gate.com/docs/developers/apiv4/ws/en/)

## License

MIT. See [LICENSE](LICENSE).
