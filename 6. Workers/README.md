# Benchmarková sada pro analýzu běhových prostředí (Node.js, Deno, Bun)

Praktická část bakalářské práce: _„Sestavení benchmarkové sady pro analýzu běhových prostředí JavaScriptových aplikací (Node.js, Deno, Bun)“_.

Tento modul implementuje kompletní **Kategorii 6: Paralelní zpracování (Worker Threads – `06-workers`)** pro všechna tři srovnávaná běhová prostředí: **Node.js**, **Deno** a **Bun**.

---

## Přehled modulů Kategorie 6 (06-workers)

Všechna tři prostředí využívají svá nativní vláknová rozhraní a sdílejí 100% identickou výpočetní logiku z [`core/worker-tasks.js`](file:///f:/unicorn/zdrojaky/BP/6.%20Workers/core/worker-tasks.js):

- **Node.js ([`scenarios/06-workers/node.mjs`](file:///f:/unicorn/zdrojaky/BP/6.%20Workers/scenarios/06-workers/node.mjs) + [`node-worker.mjs`](file:///f:/unicorn/zdrojaky/BP/6.%20Workers/scenarios/06-workers/node-worker.mjs)):** Vestavěný modul `node:worker_threads` (`Worker`, `parentPort`).
- **Deno ([`scenarios/06-workers/deno.ts`](file:///f:/unicorn/zdrojaky/BP/6.%20Workers/scenarios/06-workers/deno.ts) + [`deno-worker.ts`](file:///f:/unicorn/zdrojaky/BP/6.%20Workers/scenarios/06-workers/deno-worker.ts)):** Standardní Web Workers API (`new Worker(..., { type: "module" })`).
- **Bun ([`scenarios/06-workers/bun.ts`](file:///f:/unicorn/zdrojaky/BP/6.%20Workers/scenarios/06-workers/bun.ts) + [`bun-worker.ts`](file:///f:/unicorn/zdrojaky/BP/6.%20Workers/scenarios/06-workers/bun-worker.ts)):** Standardní Web Workers API (`new Worker(...)`).

### Testované paralelní scénáře ($W = 4$ vlákna):
1. **Varianta A: Režie vytváření a ukončení vláken (`workers-spawn-overhead`)**
   - Spuštění $W = 4$ nových pracovních vláken, výměna zprávy `"ping"` -> `"pong"` a okamžité korektní ukončení všech vláken (`worker.terminate()`).
2. **Varianta B: Paralelní CPU úloha přes předávání zpráv (`workers-message-passing` – Structured Clone)**
   - Pool 4 nastartovaných vláken zpracovává paralelně `16 MB` datový blok (4× `4 MB` `Int32Array`), který je vláknům předáván přes `postMessage` (**Structured Clone** – obousměrné kopírování dat).
3. **Varianta C: Paralelní CPU úloha se sdílenou pamětí (`workers-shared-memory` – `SharedArrayBuffer` + `Atomics`)**
   - Naprosto identický paralelní výpočet nad `16 MB` datovým blokem uloženým přímo ve sdíleném `SharedArrayBuffer` se synchronizací dokončení přes `Atomics` (**zero-copy**). Varianty B a C produkují bitově shodný kontrolní součet (`checksum`), což umožňuje exaktně vyčíslit režii kopírování dat oproti sdílené paměti.

---

## Rychlé spuštění

```bash
# Plný běh všech 3 prostředí (10 warmup + 30 měřených iterací) + verifikace checksumů
npm start

# Rychlý ověřovací běh všech 3 prostředí (2 warmup + 5 iterací)
npm run bench:all:quick

# Samostatné spuštění pro Node.js / Deno / Bun
npm run bench:node
npm run bench:deno
npm run bench:bun

# Vykreslení srovnávací tabulky a kontrola shody checksumů
npm run compare
```

Detailní přehled všech příkazů naleznete v souboru [COMMANDS.md](file:///f:/unicorn/zdrojaky/BP/6.%20Workers/COMMANDS.md).
