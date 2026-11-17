# Benchmarková sada pro analýzu běhových prostředí (Node.js, Deno, Bun)

Praktická část bakalářské práce: _„Sestavení benchmarkové sady pro analýzu běhových prostředí JavaScriptových aplikací (Node.js, Deno, Bun)“_.

Tento modul implementuje kompletní **Kategorii 5: Doba spuštění (Startup time – `05-startup`)** pro všechna tři srovnávaná běhová prostředí: **Node.js**, **Deno** a **Bun**.

---

## Přehled modulů Kategorie 5 (05-startup)

1. **Varianta A: Minimální studený start (`minimal`)**
   - Skripty [`node-minimal.mjs`](file:///f:/unicorn/zdrojaky/BP/5.%20Startup/scenarios/05-startup/node-minimal.mjs), [`deno-minimal.ts`](file:///f:/unicorn/zdrojaky/BP/5.%20Startup/scenarios/05-startup/deno-minimal.ts) a [`bun-minimal.ts`](file:///f:/unicorn/zdrojaky/BP/5.%20Startup/scenarios/05-startup/bun-minimal.ts) pouze vypíší `"ready"` na standardní výstup a okamžitě se ukončí s kódem `0`.
   - Měří čistou inicializační režii virtuálního stroje (V8 vs. JavaScriptCore) a runtime bez aplikační logiky.
2. **Varianta B: Reálný modulární start s TypeScriptem (`realistic`)**
   - Skripty [`node-realistic.ts`](file:///f:/unicorn/zdrojaky/BP/5.%20Startup/scenarios/05-startup/node-realistic.ts) (`--experimental-strip-types`), [`deno-realistic.ts`](file:///f:/unicorn/zdrojaky/BP/5.%20Startup/scenarios/05-startup/deno-realistic.ts) a [`bun-realistic.ts`](file:///f:/unicorn/zdrojaky/BP/5.%20Startup/scenarios/05-startup/bun-realistic.ts) importují řetězec sdílených TypeScript modulů ([`core/startup-validator.ts`](file:///f:/unicorn/zdrojaky/BP/5.%20Startup/core/startup-validator.ts) -> [`core/startup-schema.ts`](file:///f:/unicorn/zdrojaky/BP/5.%20Startup/core/startup-schema.ts)), zparsují a zvalidují konfigurační manifest Serverless/Edge brány pomocí regulárních výrazů a vypíší kontrolní součet na `stdout`.

---

## Metodika měření (Warm disk cache, Cold runtime, N = 100)

- **Externí měření:** Doba spuštění se měří z nadřazeného orchestrátoru pomocí `process.hrtime.bigint()` od vyvolání podprocesu (`spawnSync` se `shell: false`) až po jeho úplné ukončení (`exitCode === 0`) a kontrolu `stdout`.
- **Zahřívací fáze:** 3 spuštění nanečisto pro načtení binárek do diskové cache OS (výsledky se zahazují).
- **Měřené iterace:** $N = 100$ samostatných studených startů pro každou variantu a runtime s 12ms pauzou (cooldown) mezi starty.

---

## Rychlé spuštění

```bash
# Plný běh všech 3 prostředí (3 warmup + 100 měřených startů pro každou variantu)
npm start

# Rychlý ověřovací běh všech 3 prostředí (2 warmup + 15 startů)
npm run bench:all:quick

# Samostatné spuštění pro Node.js / Deno / Bun
npm run bench:node
npm run bench:deno
npm run bench:bun

# Vykreslení srovnávací tabulky
npm run compare
```

Detailní přehled všech příkazů naleznete v souboru [COMMANDS.md](file:///f:/unicorn/zdrojaky/BP/5.%20Startup/COMMANDS.md).
