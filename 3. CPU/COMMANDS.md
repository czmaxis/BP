# Příkazy pro spuštění CPU benchmarku z terminálu (Kategorie 3: 03-cpu)

Tento přehled obsahuje všechny dostupné příkazy pro spuštění benchmarkové sady **Kategorie 3: CPU-náročné úlohy** ve všech třech běhových prostředích (**Node.js**, **Deno**, **Bun**).

---

## 1. Hlavní spuštění pro všechna prostředí najednou (Lokálně)

| Příkaz                    | Popis                                                                                                                                      |
| :------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm start`               | **Plný běh všech 3 prostředí:** Postupně spustí Node.js, Deno a Bun (50× warmup + 30 iterací) a ověří bitovou shodu kontrolních součtů.    |
| `npm run bench:all:quick` | **Rychlý běh všech 3 prostředí:** Spustí Node.js, Deno a Bun v rychlém režimu (5× warmup + 5 iterací) a porovná výsledky.                  |
| `npm run compare`         | Samostatné vyhodnocení – načte existující data z `results/`, ověří shodu `checksum` a vykreslí srovnávací tabulku.                         |

### Vlastní parametry (přes `--`):

```bash
# Všechna 3 prostředí s vlastním počtem iterací:
npm start -- --warmup=20 --iterations=30

# Spuštění pouze jedné vybrané varianty (crypto | json | matrix):
npm run bench:cpu:crypto
npm run bench:cpu:json
npm run bench:cpu:matrix
```

---

## 2. Spuštění jednotlivých prostředí samostatně (Lokálně)

| Příkaz                     |  Prostředí  | Popis                                                        |
| :------------------------- | :---------: | :----------------------------------------------------------- |
| `npm run bench:node`       | **Node.js** | Plné měření pouze pro Node.js (50× warmup + 30 iterací).     |
| `npm run bench:node:quick` | **Node.js** | Rychlý test pouze pro Node.js (5× warmup + 5 iterací).       |
| `npm run bench:deno`       |  **Deno**   | Plné měření pouze pro Deno (50× warmup + 30 iterací).        |
| `npm run bench:deno:quick` |  **Deno**   | Rychlý test pouze pro Deno (5× warmup + 5 iterací).          |
| `npm run bench:bun`        |   **Bun**   | Plné měření pouze pro Bun (50× warmup + 30 iterací).         |
| `npm run bench:bun:quick`  |   **Bun**   | Rychlý test pouze pro Bun (5× warmup + 5 iterací).           |
| `npm run clean:results`    |   _Úklid_   | Smaže složku `results/` s naměřenými daty.                   |

---

## 3. Spuštění v Dockeru (Izolované kontejnery s limity CPU/RAM)

| Příkaz                           | Popis                                                                                                                  |
| :------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `npm run benchmark:docker`       | **Plný Docker benchmark:** Sestaví a sekvenčně spustí všechna 3 prostředí (50× warmup + 30 iterací) a porovná výsledky.|
| `npm run benchmark:docker:quick` | **Rychlý Docker test:** Sestaví a spustí všechna 3 prostředí v rychlém režimu (5× warmup + 5 iterací).                 |
| `npm run benchmark:docker:node`  | Sestaví a spustí v Dockeru **pouze Node.js** kontejner.                                                                |
| `npm run benchmark:docker:deno`  | Sestaví a spustí v Dockeru **pouze Deno** kontejner.                                                                   |
| `npm run benchmark:docker:bun`   | Sestaví a spustí v Dockeru **pouze Bun** kontejner.                                                                    |

---

## Místo pro uložení výsledků

Po dokončení benchmarku se výsledky automaticky exportují do složky `3. CPU/results/`:

- **Node.js:** `results/cpu_raw_node.json`, `results/cpu_summary_node.json`
- **Deno:** `results/cpu_raw_deno.json`, `results/cpu_summary_deno.json`
- **Bun:** `results/cpu_raw_bun.json`, `results/cpu_summary_bun.json`
- **Sjednocené porovnání:** `results/cpu_comparison.json`
