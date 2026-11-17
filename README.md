# Benchmarková sada pro analýzu běhových prostředí JavaScriptových aplikací (Node.js, Deno, Bun)

Praktická část bakalářské práce – kompletní modulární sada pokrývající **všech 6 výzkumných kategorií (`01` až `06`)** pro srovnání běhových prostředí **Node.js**, **Deno** a **Bun** (lokálně i v izolovaných Docker kontejnerech).

---

## Přehled kategorií benchmarkové sady

| Kategorie | Složka | Testované scénáře a nativní API |
| :--- | :--- | :--- |
| **1. Výkon HTTP serveru (`01-http`)** | [`1. HTTP/`](file:///f:/unicorn/zdrojaky/BP/1.%20HTTP/) | `GET /plaintext`, `GET /json` (50 záznamů), `POST /echo` (`node:http`, `Deno.serve`, `Bun.serve` + oddělený klientský proces). |
| **2. Souborové I/O operace (`02-file-io`)** | [`2. File IO/`](file:///f:/unicorn/zdrojaky/BP/2.%20File%20IO/) | Varianta A: Sekvenční streamování `1× 100 MB` (64KB bloky); Varianta B: Systémová režie `1 000× 4 KB` souborů. |
| **3. CPU-náročné úlohy (`03-cpu`)** | [`3. CPU/`](file:///f:/unicorn/zdrojaky/BP/3.%20CPU/) | Varianta A: WebCrypto (`PBKDF2-SHA512` + `SHA-512`); Varianta B: Polymorfní JSON + `sort` (`10 000` zázn.); Varianta C: Matice $250 \times 250$ (`Float64Array`). |
| **4. Databázové operace (`04-database`)** | [`4. Database/`](file:///f:/unicorn/zdrojaky/BP/4.%20Database/) | Nativní SQLite (`node:sqlite`, `bun:sqlite`) v režimu WAL – Varianta A: `BATCH INSERT` (`1 000` řádků); Varianta B: Komplexní `SELECT` (`10 000` řádků). |
| **5. Doba spuštění (`05-startup`)** | [`5. Startup/`](file:///f:/unicorn/zdrojaky/BP/5.%20Startup/) | Externí měření ($N = 100$) – Varianta A: Minimální studený start (`minimal`); Varianta B: Reálný více-modulový TypeScript start (`realistic`). |
| **6. Paralelní zpracování (`06-workers`)** | [`6. Workers/`](file:///f:/unicorn/zdrojaky/BP/6.%20Workers/) | $W = 4$ vlákna (`node:worker_threads` vs. Web Workers) – Varianta A: Spawn/Terminate režie; Varianta B: `postMessage` (Structured Clone `16 MB`); Varianta C: `SharedArrayBuffer` + `Atomics` (`16 MB` zero-copy). |

---

## Spuštění celé benchmarkové sady (Kategorie 01 až 06)

```bash
# Plný běh všech 6 kategorií za sebou (Node.js, Deno, Bun) + souhrnné porovnání
npm start

# Rychlý ověřovací běh všech 6 kategorií za sebou
npm run bench:all:quick

# Spuštění jedné konkrétní kategorie z kořene projektu
npm run bench:01-http
npm run bench:02-file-io
npm run bench:03-cpu
npm run bench:04-database
npm run bench:05-startup
npm run bench:06-workers

# Vykreslení porovnávacích tabulek všech kategorií a uložení results/master_comparison.json
npm run compare
```
