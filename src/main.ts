import "./style.css";
import { buildCurves, executeBook, findBreakEvens, makeNotionalPoints, median, midpoint, validBook } from "./math.js";
import { FeedManager, startFreshnessMonitor } from "./feeds.js";
import { isValidBaseSymbol, normalizeBaseSymbol, VENUES, VENUE_BY_ID } from "./venues.js";
import { messages, t } from "./i18n.js";
import type { Locale, OrderBook, Side, VenueId, VenueState } from "./types.js";

const params = new URLSearchParams(location.search);
let locale: Locale = params.get("lang") === "ru" ? "ru" : "en";
let symbol = normalizeBaseSymbol(params.get("symbol") || "BTC");
if (!isValidBaseSymbol(symbol)) symbol = "BTC";
let side: Side = params.get("side") === "sell" ? "sell" : "buy";
let notional = clampNumber(Number(params.get("size")) || 10_000, 10, 100_000);
const fees = Object.fromEntries(VENUES.map(v => { const raw = params.get(`fee_${v.id}`); const parsed = raw === null ? v.fee : Number(raw); return [v.id, clampNumber(Number.isFinite(parsed) ? parsed : v.fee, 0, 10)]; })) as Record<VenueId, number>;
const states = Object.fromEntries(VENUES.map(v => [v.id, { venue: v.id, state: "connecting", reconnects: 0 }])) as Record<VenueId, VenueState>;
const tNow = (key: keyof typeof messages.en) => t(locale, key);
function clampNumber(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function esc(value: string): string { return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!); }
function money(value: number, compact = false): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 4 : 2, notation: compact && Math.abs(value) >= 100_000 ? "compact" : "standard" }).format(value);
}
function number(value: number, digits = 2): string { return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: digits }).format(value); }
function timeAgo(ms: number): string { return `${Math.max(0, Math.floor((Date.now() - ms) / 1000))} ${tNow("staleFor")}`; }

const app = document.querySelector<HTMLDivElement>("#app")!;
function renderShell(): void {
  document.documentElement.lang = locale;
  app.innerHTML = `
  <div class="page-shell">
    <header class="topbar">
      <a class="brand" href="?" aria-label="Depthline"><span class="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 22.5 10.5 14l5 5 10-12"/><path d="M19.5 7H26v6.5"/></svg></span><span>depthline<span class="brand-dot">.</span></span></a>
      <div class="top-actions"><span class="product-tag">${tNow("eyebrow")}</span><button class="lang-button" id="language" aria-label="Switch language">${locale === "en" ? "RU" : "EN"}</button><a class="icon-link" href="https://github.com/hilsetapp/cross-exchange-slippage" target="_blank" rel="noreferrer" aria-label="GitHub repository"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 19c-4.3 1.4-4.3-2.4-6-3m12 6v-3.9a3.4 3.4 0 0 0-.9-2.7c3-.3 6.1-1.5 6.1-6.7a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.2-.4-3.8 1.4a13.2 13.2 0 0 0-6.9 0C5.4 1.1 4.2 1.5 4.2 1.5a4.8 4.8 0 0 0-.1 3.6 5.2 5.2 0 0 0-1.4 3.6c0 5.2 3.1 6.4 6.1 6.7a3.4 3.4 0 0 0-.9 2.7V22"/></svg></a></div>
    </header>
    <main>
      <section class="hero"><div><p class="kicker">${tNow("eyebrow")}</p><h1>${tNow("title")}<span class="hero-period">.</span></h1><p class="hero-subtitle">${tNow("subtitle")}</p><p class="hero-copy">${tNow("intro")}</p></div><div class="hero-stamp"><span class="stamp-icon">↗</span><span>${tNow("install")}</span></div></section>
      <section class="workbench">
        <div class="control-panel">
          <div class="control-topline"><span class="section-label">01 / ${tNow("details")}</span><button class="text-button" id="reconnect">↻ &nbsp;${tNow("refresh")}</button></div>
          <div class="controls-grid">
            <label class="field symbol-field"><span class="field-label">${tNow("pair")}</span><div class="symbol-input"><input id="symbol" value="${esc(symbol)}" autocomplete="off" spellcheck="false" aria-label="Base symbol"><span class="quote-suffix">/ USDT</span></div></label>
            <div class="field"><span class="field-label">${tNow("side")}</span><div class="segmented" role="group" aria-label="Trade direction"><button id="buy" class="${side === "buy" ? "active" : ""}">${tNow("buy")}</button><button id="sell" class="${side === "sell" ? "active" : ""}">${tNow("sell")}</button></div></div>
            <label class="field size-field"><span class="field-label">${tNow("size")}</span><div class="size-input"><span class="dollar-sign">$</span><input id="size" type="number" min="10" max="100000" step="100" value="${notional}" aria-label="Order size in USDT"><span class="quote-suffix">USDT</span></div><input id="size-range" type="range" min="10" max="100000" step="10" value="${notional}" aria-label="Order size slider"><div class="range-labels"><span>10</span><span>100k</span></div></label>
          </div>
          <div class="fee-head"><span class="field-label">${tNow("fee")}</span><span class="fee-note">${tNow("feeNote")}</span></div>
          <div class="fee-list">${VENUES.map(v => `<label class="fee-item"><span class="venue-dot" style="--venue:${v.color}"></span><span>${v.name}</span><input aria-label="${v.name} fee percent" data-fee="${v.id}" type="number" min="0" max="10" step="0.01" value="${number(fees[v.id], 2)}"><span class="percent">%</span></label>`).join("")}</div>
        </div>
        <div class="feed-panel"><div class="feed-heading"><div><span class="section-label">02 / ${tNow("connected")}</span><h2>${tNow("source")}</h2></div><span class="feed-live-count"><i class="pulse"></i><b id="live-count">0</b> / 5</span></div><div class="venue-status-grid" id="venue-status"></div><p class="feed-footnote">${tNow("feedsHint")}</p></div>
      </section>
      <section class="analysis-head"><div><span class="section-label">03 / ${tNow("chartTitle")}</span><h2>${tNow("chartTitle")}</h2><p>${tNow("chartDesc")}</p></div><div class="chart-meta"><span class="meta-chip"><i class="meta-dot"></i>${tNow("net")}</span><span id="coverage" class="coverage">0 ${tNow("eligible")}</span></div></section>
      <section class="chart-card"><div class="chart-wrap"><canvas id="curve" aria-label="Slippage curve"></canvas><div class="chart-empty" id="chart-empty"><span class="empty-orbit">◌</span><span>${tNow("noData")}</span></div><div class="chart-tooltip" id="tooltip"></div></div><div class="chart-legend" id="legend"></div></section>
      <div class="analysis-bottom"><section class="break-card"><div class="card-heading"><div><span class="section-label">04 / ${tNow("breakEven")}</span><h3>${tNow("breakEven")}</h3></div><span class="break-symbol">⌁</span></div><div id="break-even" class="break-list"><div class="subtle-empty">${tNow("noCross")}</div></div></section>
      <section class="summary-card"><div class="card-heading"><div><span class="section-label">05 / ${tNow("summary")}</span><h3>${tNow("summary")} <span id="summary-size">${money(notional)}</span></h3></div><span class="summary-arrow">↗</span></div><div id="summary-content" class="summary-content"><div class="subtle-empty">${tNow("none")}</div></div></section></div>
      <section class="venue-table-section"><div class="table-heading"><div><span class="section-label">06 / ${tNow("estimate")}</span><h2>${tNow("estimate")}</h2></div><p>${tNow("explanatory")}</p></div><div class="table-scroll"><table><thead><tr><th>${tNow("connected")}</th><th>${tNow("book")}</th><th>${tNow("vwap")}</th><th>${tNow("feeCost")}</th><th>${tNow("slippage")}</th><th>${tNow("fill")}</th></tr></thead><tbody id="venue-rows"></tbody></table></div></section>
      <aside class="notice"><span class="notice-icon">i</span><div><strong>${tNow("caveat")}</strong><p>${tNow("fineprint")}</p></div></aside>
    </main>
    <footer><a class="footer-brand" href="#top">depthline<span class="brand-dot">.</span></a><span>${tNow("footer")} · ${tNow("quote")}</span><a href="https://github.com/hilsetapp/cross-exchange-slippage" target="_blank" rel="noreferrer">GitHub ↗</a></footer>
  </div>`;
  bindControls();
}

function bindControls(): void {
  document.querySelector<HTMLButtonElement>("#language")!.onclick = () => { locale = locale === "en" ? "ru" : "en"; writeUrl(); renderShell(); attachChart(); render(); };
  document.querySelector<HTMLInputElement>("#symbol")!.addEventListener("change", e => {
    const input = e.currentTarget as HTMLInputElement; const base = normalizeBaseSymbol(input.value);
    if (!isValidBaseSymbol(base)) { input.setCustomValidity(tNow("symbolError")); input.reportValidity(); input.value = symbol; return; }
    input.setCustomValidity(""); symbol = base; input.value = symbol; writeUrl(); connectFeeds();
  });
  document.querySelector<HTMLInputElement>("#size")!.addEventListener("change", e => setSize(Number((e.currentTarget as HTMLInputElement).value)));
  document.querySelector<HTMLInputElement>("#size-range")!.addEventListener("input", e => setSize(Number((e.currentTarget as HTMLInputElement).value), false));
  for (const dir of ["buy", "sell"] as const) document.querySelector<HTMLButtonElement>(`#${dir}`)!.onclick = () => { side = dir; writeUrl(); renderShell(); attachChart(); render(); };
  document.querySelector<HTMLButtonElement>("#reconnect")!.onclick = () => connectFeeds();
  document.querySelectorAll<HTMLInputElement>("[data-fee]").forEach(input => input.addEventListener("change", () => {
    const id = input.dataset.fee as VenueId; const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0 || value > 10) { input.value = String(fees[id]); return; }
    fees[id] = value; writeUrl(); render();
  }));
}
function setSize(raw: number, write = true): void {
  if (!Number.isFinite(raw)) return;
  notional = Math.round(clampNumber(raw, 10, 100_000) * 100) / 100;
  const size = document.querySelector<HTMLInputElement>("#size"); const range = document.querySelector<HTMLInputElement>("#size-range");
  if (size) size.value = String(notional); if (range) range.value = String(notional);
  if (write) writeUrl(); render();
}
function writeUrl(): void {
  const query = new URLSearchParams({ symbol, side, size: String(notional), lang: locale });
  for (const venue of VENUES) query.set(`fee_${venue.id}`, String(fees[venue.id]));
  history.replaceState(null, "", `${location.pathname}?${query.toString()}`);
}

let manager: FeedManager;
let renderQueued = false;
function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  window.setTimeout(() => { renderQueued = false; render(); }, 180);
}
function connectFeeds(): void {
  manager?.disconnect();
  for (const venue of VENUES) states[venue.id] = { venue: venue.id, state: "connecting", reconnects: states[venue.id].reconnects };
  render(); manager = new FeedManager((id, patch) => { states[id] = { ...states[id], ...patch, venue: id }; scheduleRender(); });
  manager.connect(symbol);
}
function eligibleBooks(): Partial<Record<VenueId, OrderBook>> {
  return Object.fromEntries(VENUES.flatMap(v => validBook(states[v.id].book) ? [[v.id, states[v.id].book!]] : [])) as Partial<Record<VenueId, OrderBook>>;
}
function stateLabel(state: VenueState["state"]): string {
  const key = state === "live" ? "live" : state === "stale" ? "stale" : state === "unsupported" ? "unsupported" : state === "reconnecting" ? "reconnecting" : "connecting";
  return tNow(key);
}
function renderStatus(): void {
  const node = document.querySelector<HTMLDivElement>("#venue-status"); if (!node) return;
  const live = Object.values(states).filter(s => s.state === "live" && validBook(s.book)).length;
  document.querySelector("#live-count")!.textContent = String(live);
  document.querySelector("#coverage")!.textContent = `${live} ${tNow("eligible")}`;
  node.innerHTML = VENUES.map(v => {
    const s = states[v.id]; const received = s.book?.receivedAt;
    return `<div class="venue-status ${s.state}" title="${esc(s.message ?? "")}"><span class="status-light"></span><span class="status-name">${v.name}</span><span class="status-text">${stateLabel(s.state)}</span>${received ? `<span class="status-age">${timeAgo(received)}</span>` : ""}</div>`;
  }).join("");
}
function render(): void {
  renderStatus();
  const books = eligibleBooks(); const entries = Object.values(books);
  const mids = entries.map(midpoint); const refMid = median(mids);
  const valid = entries.length > 0 && refMid !== undefined;
  document.querySelector<HTMLDivElement>("#chart-empty")!.classList.toggle("hidden", valid);
  if (!valid || !refMid) {
    document.querySelector<HTMLDivElement>("#legend")!.innerHTML = "";
    document.querySelector<HTMLDivElement>("#break-even")!.innerHTML = `<div class="subtle-empty">${tNow("noCross")}</div>`;
    document.querySelector<HTMLDivElement>("#summary-content")!.innerHTML = `<div class="subtle-empty">${tNow("none")}</div>`;
    document.querySelector<HTMLTableSectionElement>("#venue-rows")!.innerHTML = VENUES.map(v => `<tr><td><span class="table-venue"><i class="venue-dot" style="--venue:${v.color}"></i>${v.name}</span></td><td colspan="5"><span class="table-muted">${stateLabel(states[v.id].state)}</span></td></tr>`).join("");
    drawChart([], undefined); return;
  }
  const points = makeNotionalPoints(10, 100_000, 40);
  const curves = buildCurves(books, fees, side, refMid, points);
  drawChart(curves, notional); renderLegend(curves); renderBreakEvens(findBreakEvens(curves)); renderSummary(curves, books, refMid); renderRows(books, refMid);
}
function renderLegend(curves: ReturnType<typeof buildCurves>): void {
  const legend = document.querySelector<HTMLDivElement>("#legend")!;
  legend.innerHTML = curves.map(c => `<span class="legend-item"><i style="--venue:${VENUE_BY_ID[c.venue].color}"></i>${VENUE_BY_ID[c.venue].name}</span>`).join("");
}
function renderBreakEvens(crossings: ReturnType<typeof findBreakEvens>): void {
  const node = document.querySelector<HTMLDivElement>("#break-even")!;
  node.innerHTML = crossings.length ? crossings.slice(0, 4).map(c => `<div class="crossing"><div><span class="crossing-from">${VENUE_BY_ID[c.from].name}</span><span class="crossing-arrow">→</span><span class="crossing-to">${VENUE_BY_ID[c.to].name}</span></div><strong>${money(c.notional)}</strong></div>`).join("") : `<div class="subtle-empty">${tNow("noCross")}</div>`;
}
function bestExecution(books: Partial<Record<VenueId, OrderBook>>, refMid: number) {
  const candidates = VENUES.flatMap(v => {
    const book = books[v.id]; if (!book) return [];
    const execution = executeBook(book, notional / refMid, side, fees[v.id], refMid);
    return execution.fullyFilled ? [{ id: v.id, execution }] : [];
  });
  return candidates.sort((a, b) => a.execution.slippageQuote - b.execution.slippageQuote)[0];
}
function renderSummary(curves: ReturnType<typeof buildCurves>, books: Partial<Record<VenueId, OrderBook>>, refMid: number): void {
  document.querySelector("#summary-size")!.textContent = money(notional);
  const node = document.querySelector<HTMLDivElement>("#summary-content")!; const best = bestExecution(books, refMid);
  const qty = notional / refMid;
  const entries = VENUES.flatMap(v => {
    const book = books[v.id]; if (!book) return [];
    const execution = executeBook(book, qty, side, fees[v.id], refMid);
    return [{ id: v.id, execution }];
  });
  if (!entries.length) { node.innerHTML = `<div class="subtle-empty">${tNow("none")}</div>`; return; }
  node.innerHTML = `<div class="best-callout"><span class="best-check">✓</span><div><span>${tNow("best")}</span><strong>${best ? VENUE_BY_ID[best.id].name : tNow("insufficient")}</strong></div><b>${best ? money(best.execution.slippageQuote) : "—"}</b></div><div class="summary-mini-grid">${entries.slice().sort((a,b)=>a.execution.slippageQuote-b.execution.slippageQuote).slice(0,3).map(item => `<div class="mini-row"><span><i class="venue-dot" style="--venue:${VENUE_BY_ID[item.id].color}"></i>${VENUE_BY_ID[item.id].name}</span><strong>${item.execution.fullyFilled ? money(item.execution.slippageQuote) : tNow("insufficient")}</strong></div>`).join("")}</div>`;
  void curves;
}
function renderRows(books: Partial<Record<VenueId, OrderBook>>, refMid: number): void {
  const node = document.querySelector<HTMLTableSectionElement>("#venue-rows")!; const qty = notional / refMid;
  const rows = VENUES.flatMap(v => {
    const book = books[v.id]; if (!book) return [];
    const e = executeBook(book, qty, side, fees[v.id], refMid);
    const bid = Math.max(...book.bids.map(l => l[0])); const ask = Math.min(...book.asks.map(l => l[0]));
    const winner = bestExecution(books, refMid)?.id === v.id;
    return [{ v, book, e, bid, ask, winner }];
  }).sort((a,b) => a.e.slippageQuote - b.e.slippageQuote);
  node.innerHTML = VENUES.map(v => {
    const row = rows.find(r => r.v.id === v.id); if (!row) return `<tr><td><span class="table-venue"><i class="venue-dot" style="--venue:${v.color}"></i>${v.name}</span></td><td colspan="5"><span class="table-muted">${stateLabel(states[v.id].state)}${states[v.id].message ? ` · ${esc(states[v.id].message!)}` : ""}</span></td></tr>`;
    const e = row.e;
    return `<tr class="${row.winner ? "winner-row" : ""}"><td><span class="table-venue"><i class="venue-dot" style="--venue:${v.color}"></i>${v.name}${row.winner ? `<span class="winner-tag">${tNow("best")}</span>` : ""}</span><span class="table-time">${timeAgo(row.book.receivedAt)}</span></td><td><span class="book-prices">${number(row.bid, 4)} <small>/</small> ${number(row.ask, 4)}</span><span class="table-time">${e.levelsUsed} ${tNow("level")}</span></td><td>${e.fullyFilled ? money(e.effectiveAveragePrice) : "—"}</td><td>${money(e.feeQuote)}</td><td class="${e.slippageQuote < 0 ? "positive" : ""}">${e.fullyFilled ? money(e.slippageQuote) : "—"}</td><td><span class="fill-pill ${e.fullyFilled ? "full" : "partial"}">${number(e.fillRatio * 100, 0)}%</span></td></tr>`;
  }).join("");
}

let chartCurves: ReturnType<typeof buildCurves> = [];
let chartTarget: number | undefined;
let resizeObserver: ResizeObserver;
function drawChart(curves: ReturnType<typeof buildCurves>, target: number | undefined): void {
  chartCurves = curves; chartTarget = target;
  const canvas = document.querySelector<HTMLCanvasElement>("#curve"); if (!canvas) return;
  const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(rect.width * dpr)); canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  ctx.scale(dpr, dpr); const w = rect.width; const h = rect.height; ctx.clearRect(0,0,w,h);
  const left = locale === "ru" ? 64 : 61, right = 18, top = 20, bottom = 47;
  const pw = w - left - right, ph = h - top - bottom;
  const all = curves.flatMap(c => c.points.map(p => p.slippageQuote).filter((v): v is number => v !== null));
  const loRaw = all.length ? Math.min(...all, 0) : 0; const hiRaw = all.length ? Math.max(...all) : 1;
  const pad = Math.max((hiRaw - loRaw) * .15, Math.abs(hiRaw) * .1, 0.02); const lo = loRaw - pad; const hi = hiRaw + pad;
  const x = (value: number) => left + (Math.log(value / 10) / Math.log(100_000 / 10)) * pw;
  const y = (value: number) => top + (hi - value) / (hi - lo) * ph;
  ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.textBaseline = "middle";
  for (let i=0; i<5; i++) {
    const val = lo + (hi-lo)*i/4; const yy = y(val);
    ctx.strokeStyle = "#e7e9e4"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(w-right, yy); ctx.stroke();
    ctx.fillStyle = "#828a82"; ctx.textAlign = "right"; ctx.fillText(money(val), left-9, yy);
  }
  const ticks = [10,100,1000,10000,100000];
  for (const tick of ticks) { const xx=x(tick); ctx.strokeStyle="#e7e9e4";ctx.beginPath();ctx.moveTo(xx,top);ctx.lineTo(xx,h-bottom);ctx.stroke();ctx.fillStyle="#828a82";ctx.textAlign="center";ctx.fillText(tick>=1000?`${tick/1000}k`:String(tick),xx,h-bottom+15); }
  ctx.fillStyle="#737b73";ctx.textAlign="center";ctx.fillText(tNow("axisX"),left+pw/2,h-10);
  ctx.save();ctx.translate(11,top+ph/2);ctx.rotate(-Math.PI/2);ctx.fillStyle="#737b73";ctx.fillText(tNow("axisY"),0,0);ctx.restore();
  if (target !== undefined) { const xx=x(clampNumber(target,10,100000));ctx.setLineDash([4,5]);ctx.strokeStyle="#87917f";ctx.beginPath();ctx.moveTo(xx,top);ctx.lineTo(xx,h-bottom);ctx.stroke();ctx.setLineDash([]); }
  for (const curve of curves) {
    ctx.beginPath(); let begun=false;
    for (const point of curve.points) { if (point.slippageQuote === null) { begun=false; continue; } const xx=x(point.notional), yy=y(point.slippageQuote); if (!begun) { ctx.moveTo(xx,yy);begun=true; } else ctx.lineTo(xx,yy); }
    ctx.strokeStyle=VENUE_BY_ID[curve.venue].color;ctx.lineWidth=2.5;ctx.lineJoin="round";ctx.lineCap="round";ctx.stroke();
    if (target) { const p=curve.points.reduce((best,cur)=>Math.abs(cur.notional-target)<Math.abs(best.notional-target)?cur:best);if(p.slippageQuote!==null){ctx.beginPath();ctx.arc(x(p.notional),y(p.slippageQuote),4,0,Math.PI*2);ctx.fillStyle=VENUE_BY_ID[curve.venue].color;ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke();} }
  }
}
function attachChart(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#curve")!;
  canvas.onpointermove = event => {
    if (!chartCurves.length) return;
    const rect=canvas.getBoundingClientRect();const px=event.clientX-rect.left;const left=61,right=18,pw=rect.width-left-right;
    const value=10*Math.exp(clampNumber((px-left)/pw,0,1)*Math.log(10000));
    const tooltip=document.querySelector<HTMLDivElement>("#tooltip")!;
    const rows=chartCurves.map(c=>{const p=c.points.reduce((b,n)=>Math.abs(n.notional-value)<Math.abs(b.notional-value)?n:b);return `<div><i style="--venue:${VENUE_BY_ID[c.venue].color}"></i>${VENUE_BY_ID[c.venue].name}<b>${p.slippageQuote===null?"—":money(p.slippageQuote)}</b></div>`;}).join("");
    tooltip.innerHTML=`<strong>${money(value)}</strong>${rows}`;tooltip.classList.add("visible");tooltip.style.left=`${clampNumber(px,90,rect.width-90)}px`;tooltip.style.top="20px";
  };
  canvas.onpointerleave=()=>document.querySelector("#tooltip")!.classList.remove("visible");
  resizeObserver?.disconnect(); resizeObserver=new ResizeObserver(()=>drawChart(chartCurves,chartTarget));resizeObserver.observe(canvas);
}

renderShell(); attachChart(); writeUrl();
const freshness = startFreshnessMonitor(states, (id,state) => { if(states[id].state !== state){states[id].state=state;render();} });
connectFeeds();
window.addEventListener("beforeunload",()=>{manager?.disconnect();clearInterval(freshness);});
const shareButton = document.querySelector<HTMLButtonElement>("#share"); void shareButton;
