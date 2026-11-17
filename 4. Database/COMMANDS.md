# Příkazy pro spuštění databázového benchmarku z terminálu (Kategorie 4: 04-database)

Tento přehled obsahuje všechny dostupné příkazy pro spuštění benchmarkové sady **Kategorie 4: Databázové operace (SQLite)** ve všech třech běhových prostředích (**Node.js**, **Deno**, **Bun**).

---

## 1. Hlavní spuštění pro všechna prostředí najednou (Lokálně)

| Příkaz                    | Popis                                                                                                                                      |
| :------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm start`               | **Plný běh všech 3 prostředí:** Postupně spustí Node.js, Deno a Bun (10× warmup + 30 iterací) a ověří bitovou shodu kontrolních součtů.    |
| `npm run bench:all:quick` | **Rychlý běh všech 3 prostředí:** Spustí Node.js, Deno a Bun v rychlém režimu (2× warmup + 5 iterací) a porovná výsledky.                  |
| `npm run compare`         | Samostatné vyhodnocení – načte existující data z `results/`, ověří shodu `checksum` a vykreslí srovnávací tabulku.                         |

### Vlastní parametry (přes `--`):

```bash
# Všechna 3 prostředí s vlastním počtem iterací:
npm start -- --warmup=5 --iterations=20

# Spuštění pouze jedné vybrané varianty (insert | select):
npm run bench:db:insert
npm run bench:db:select
```

---

## 2. Spuštění jednotlivých prostředí samostatně (Lokálně)

| Příkaz                     |  Prostředí  | Popis                                                                    |
| :------------------------- | :---------: | :----------------------------------------------------------------------- |
| `npm run bench:node`       | **Node.js** | Plné měření pouze pro Node.js (`node:sqlite`, 10× warmup + 30 iterací).  |
| `npm run bench:node:quick` | **Node.js** | Rychlý test pouze pro Node.js (2× warmup + 5 iterací).                   |
| `npm run bench:deno`       |  **Deno**   | Plné měření pouze pro Deno (`node:sqlite`, 10× warmup + 30 iterací).     |
| `npm run bench:deno:quick` |  **Deno**   | Rychlý test pouze pro Deno (2× warmup + 5 iterací).                      |
| `npm run bench:bun`        |   **Bun**   | Plné měření pouze pro Bun (`bun:sqlite`, 10× warmup + 30 iterací).       |
| `npm run bench:bun:quick`  |   **Bun**   | Rychlý test pouze pro Bun (2× warmup + 5 iterací).                       |
| `npm run clean:results`    |   _Úklid_   | Smaže složku `results/` s naměřenými daty.                               |
| `npm run clean:temp`       |   _Úklid_   | Bezpečně promaže dočasnou složku `temp/`.                                |

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

Po dokončení benchmarku se výsledky automaticky exportují do složky `4. Database/results/`:

- **Node.js:** `results/database_raw_node.json`, `results/database_summary_node.json`
- **Deno:** `results/database_raw_deno.json`, `results/database_summary_deno.json`
- **Bun:** `results/database_raw_bun.json`, `results/database_summary_bun.json`
- **Sjednocené porovnání:** `results/database_comparison.json`
