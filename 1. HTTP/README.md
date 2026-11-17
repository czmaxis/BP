# Benchmarková sada pro analýzu běhových prostředí (Node.js, Deno, Bun)

Praktická část bakalářské práce: _„Sestavení benchmarkové sady pro analýzu běhových prostředí JavaScriptových aplikací (Node.js, Deno, Bun)“_.

Tento modul implementuje kompletní **Kategorii 1: Výkon HTTP serveru** pro všechna tři srovnávaná běhová prostředí: **Node.js**, **Deno** a **Bun**, s plným oddělením procesu serveru a klientského zátěžového generátoru.

---

## Přehled modulů Kategorie 1 (01-http)

Všechny tři servery využívají **výhradně nativní HTTP rozhraní** bez jakýchkoliv externích knihoven nebo frameworků:

- **Node.js ([`scenarios/01-http/node.mjs`](file:///f:/unicorn/zdrojaky/BP/1.%20HTTP/scenarios/01-http/node.mjs)):** `node:http` (`http.createServer`)
- **Deno ([`scenarios/01-http/deno.ts`](file:///f:/unicorn/zdrojaky/BP/1.%20HTTP/scenarios/01-http/deno.ts)):** `Deno.serve`
- **Bun ([`scenarios/01-http/bun.ts`](file:///f:/unicorn/zdrojaky/BP/1.%20HTTP/scenarios/01-http/bun.ts)):** `Bun.serve`

### Testované endpointy:

1. **Varianta A: `GET /plaintext`**
   - Vrací prostý text `"Hello, World!"` se stavovým kódem `200` a hlavičkou `Content-Type: text/plain; charset=utf-8`.
   - Testuje hrubou propustnost síťového zásobníku, HTTP parseru a event loopu.
2. **Varianta B: `GET /json`**
   - Při každém požadavku dynamicky serializuje polymorfní pole 50 uživatelských záznamů (ze sdíleného [`core/http-data.js`](file:///f:/unicorn/zdrojaky/BP/1.%20HTTP/core/http-data.js)) pomocí `JSON.stringify()` a vrací jej s hlavičkou `Content-Type: application/json`.
3. **Varianta C: `POST /echo`**
   - Načte celé tělo příchozího HTTP požadavku ze socketu/streamu, provede jeho validaci a parsování přes `JSON.parse()`, doplní vlastnost `"processed": true` a odešle jej zpět přes `JSON.stringify()` s hlavičkou `Content-Type: application/json`.

---

## Metodika měření (Prevence Observer Effectu)

- **Oddělení procesů:** Testovaný HTTP server běží v samostatném OS podprocesu a zátěžový klient (`autocannon` / `wrk` / vícevláknový `core/http-load-client.js`) běží v odděleném procesu.
- **Zahřívací fáze (Warmup):** 10 sekund souvislé zátěže (50 souběžných spojení) před započetím měření každého endpointu – výsledky se zahazují.
- **Měřené iterace:** $N = 10$ samostatných měřených běhů o délce **30 sekund** při **50 souběžných spojeních** (konfigurovatelné v `config.json`).
- **Sběr RSS paměti bez zkreslení latence:** Spotřeba fyzické paměti RSS se snímá přes interní koncový bod `/metrics` těsně **před** a **po** každém zátěžovém běhu – během samotného měření latencí se neprovádějí žádná telemetrická systémová volání.

---

## Rychlé spuštění

```bash
# Plný běh všech 3 prostředí (10s warmup + 10 × 30s měření pro každý endpoint)
npm start

# Rychlý ověřovací běh všech 3 prostředí (1s warmup + 3 × 2s měření)
npm run bench:all:quick

# Samostatné spuštění pro Node.js / Deno / Bun
npm run bench:node
npm run bench:deno
npm run bench:bun

# Vykreslení srovnávací tabulky z uložených výsledků
npm run compare
```

Detailní přehled všech příkazů naleznete v souboru [COMMANDS.md](file:///f:/unicorn/zdrojaky/BP/1.%20HTTP/COMMANDS.md).
