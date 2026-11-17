# Příkazy pro spuštění Startup benchmarku z terminálu (Kategorie 5: 05-startup)

Tento přehled obsahuje všechny dostupné příkazy pro spuštění benchmarkové sady **Kategorie 5: Doba spuštění (Startup time)** ve všech třech běhových prostředích (**Node.js**, **Deno**, **Bun**).

---

## 1. Hlavní spuštění pro všechna prostředí najednou (Lokálně)

| Příkaz                    | Popis                                                                                                                          |
| :------------------------ | :----------------------------------------------------------------------------------------------------------------------------- |
| `npm start`               | **Plný běh všech 3 prostředí:** Postupně změří Node.js, Deno a Bun (3× warmup + 100 startů pro obě varianty) a porovná výsledky.|
| `npm run bench:all:quick` | **Rychlý běh všech 3 prostředí:** Spustí Node.js, Deno a Bun v rychlém režimu (2× warmup + 15 startů) a porovná je.            |
| `npm run compare`         | Samostatné vyhodnocení – načte existující data z `results/` a vykreslí srovnávací tabulku.                                     |

### Vlastní parametry (přes `--`):

```bash
# Vlastní počet měřených spuštění:
npm start -- --warmup=3 --iterations=50

# Měření pouze jedné vybrané varianty (minimal | realistic):
npm run bench:startup:minimal
npm run bench:startup:realistic
```

---

## 2. Spuštění jednotlivých prostředí samostatně (Lokálně)

| Příkaz                     |  Prostředí  | Popis                                                        |
| :------------------------- | :---------: | :----------------------------------------------------------- |
| `npm run bench:node`       | **Node.js** | Plné měření pouze pro Node.js (3× warmup + 100 startů).      |
| `npm run bench:node:quick` | **Node.js** | Rychlý test pouze pro Node.js (2× warmup + 15 startů).       |
| `npm run bench:deno`       |  **Deno**   | Plné měření pouze pro Deno (3× warmup + 100 startů).         |
| `npm run bench:deno:quick` |  **Deno**   | Rychlý test pouze pro Deno (2× warmup + 15 startů).          |
| `npm run bench:bun`        |   **Bun**   | Plné měření pouze pro Bun (3× warmup + 100 startů).          |
| `npm run bench:bun:quick`  |   **Bun**   | Rychlý test pouze pro Bun (2× warmup + 15 startů).           |
| `npm run clean:results`    |   _Úklid_   | Smaže složku `results/` s naměřenými daty.                   |

---

## 3. Spuštění v Dockeru (Izolované kontejnery s předehřátou cache)

| Příkaz                           | Popis                                                                                                                  |
| :------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `npm run benchmark:docker`       | **Plný Docker benchmark:** Sestaví a sekvenčně spustí všechna 3 prostředí (3× warmup + 100 startů) a porovná výsledky. |
| `npm run benchmark:docker:quick` | **Rychlý Docker test:** Sestaví a spustí všechna 3 prostředí v rychlém režimu (2× warmup + 15 startů).                 |
| `npm run benchmark:docker:node`  | Sestaví a spustí v Dockeru **pouze Node.js** kontejner.                                                                |
| `npm run benchmark:docker:deno`  | Sestaví a spustí v Dockeru **pouze Deno** kontejner.                                                                   |
| `npm run benchmark:docker:bun`   | Sestaví a spustí v Dockeru **pouze Bun** kontejner.                                                                    |

---

## Místo pro uložení výsledků

Po dokončení benchmarku se výsledky automaticky exportují do složky `5. Startup/results/`:

- **Node.js:** `results/startup_raw_node.json`, `results/startup_summary_node.json`
- **Deno:** `results/startup_raw_deno.json`, `results/startup_summary_deno.json`
- **Bun:** `results/startup_raw_bun.json`, `results/startup_summary_bun.json`
- **Sjednocené porovnání:** `results/startup_comparison.json`
