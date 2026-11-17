# Příkazy pro spuštění Worker benchmarku z terminálu (Kategorie 6: 06-workers)

Tento přehled obsahuje všechny dostupné příkazy pro spuštění benchmarkové sady **Kategorie 6: Paralelní zpracování (Worker Threads)** ve všech třech běhových prostředích (**Node.js**, **Deno**, **Bun**).

---

## 1. Hlavní spuštění pro všechna prostředí najednou (Lokálně)

| Příkaz                    | Popis                                                                                                                                      |
| :------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm start`               | **Plný běh všech 3 prostředí:** Postupně spustí Node.js, Deno a Bun (10× warmup + 30 iterací) a ověří bitovou shodu kontrolních součtů.    |
| `npm run bench:all:quick` | **Rychlý běh všech 3 prostředí:** Spustí Node.js, Deno a Bun v rychlém režimu (2× warmup + 5 iterací) a porovná výsledky.                  |
| `npm run compare`         | Samostatné vyhodnocení – načte existující data z `results/`, ověří shodu `checksum` a vykreslí srovnávací tabulku.                         |

### Vlastní parametry (přes `--`):

```bash
# Vlastní počet pracovních vláken a iterací:
npm start -- --workers=4 --warmup=5 --iterations=20

# Spuštění pouze jedné vybrané varianty (spawn | message | shared):
npm run bench:workers:spawn
npm run bench:workers:message
npm run bench:workers:shared
```

---

## 2. Spuštění jednotlivých prostředí samostatně (Lokálně)

| Příkaz                     |  Prostředí  | Popis                                                                          |
| :------------------------- | :---------: | :----------------------------------------------------------------------------- |
| `npm run bench:node`       | **Node.js** | Plné měření pouze pro Node.js (`node:worker_threads`, 10× warmup + 30 iterací).|
| `npm run bench:node:quick` | **Node.js** | Rychlý test pouze pro Node.js (2× warmup + 5 iterací).                         |
| `npm run bench:deno`       |  **Deno**   | Plné měření pouze pro Deno (Web Workers, 10× warmup + 30 iterací).             |
| `npm run bench:deno:quick` |  **Deno**   | Rychlý test pouze pro Deno (2× warmup + 5 iterací).                            |
| `npm run bench:bun`        |   **Bun**   | Plné měření pouze pro Bun (Web Workers, 10× warmup + 30 iterací).              |
| `npm run bench:bun:quick`  |   **Bun**   | Rychlý test pouze pro Bun (2× warmup + 5 iterací).                             |
| `npm run clean:results`    |   _Úklid_   | Smaže složku `results/` s naměřenými daty.                                     |

---

## 3. Spuštění v Dockeru (Izolované kontejnery s limity CPU/RAM)

| Příkaz                           | Popis                                                                                                                  |
| :------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `npm run benchmark:docker`       | **Plný Docker benchmark:** Sestaví a sekvenčně spustí všechna 3 prostředí (10× warmup + 30 iterací) a porovná výsledky.|
| `npm run benchmark:docker:quick` | **Rychlý Docker test:** Sestaví a spustí všechna 3 prostředí v rychlém režimu (2× warmup + 5 iterací).                 |
| `npm run benchmark:docker:node`  | Sestaví a spustí v Dockeru **pouze Node.js** kontejner.                                                                |
| `npm run benchmark:docker:deno`  | Sestaví a spustí v Dockeru **pouze Deno** kontejner.                                                                   |
| `npm run benchmark:docker:bun`   | Sestaví a spustí v Dockeru **pouze Bun** kontejner.                                                                    |

---

## Místo pro uložení výsledků

Po dokončení benchmarku se výsledky automaticky exportují do složky `6. Workers/results/`:

- **Node.js:** `results/workers_raw_node.json`, `results/workers_summary_node.json`
- **Deno:** `results/workers_raw_deno.json`, `results/workers_summary_deno.json`
- **Bun:** `results/workers_raw_bun.json`, `results/workers_summary_bun.json`
- **Sjednocené porovnání:** `results/workers_comparison.json`
