# Příkazy pro spuštění benchmarku z terminálu

Tento přehled obsahuje všechny dostupné příkazy pro spuštění benchmarkové sady pro **Kategorii 2: Souborové I/O operace** ve všech třech běhových prostředích (**Node.js**, **Deno**, **Bun**) a pro jejich křížové porovnání.

---

## Rychlý přehled npm skriptů

| Příkaz                                |   Prostředí   | Popis                                                                                                           |
| :------------------------------------ | :-----------: | :-------------------------------------------------------------------------------------------------------------- |
| `npm start` / `npm run bench:file-io` |  **Node.js**  | Spustí plný benchmark obou scénářů (10× warmup + 30 měřených iterací).                                          |
| `npm run bench:file-io:quick`         |  **Node.js**  | Rychlý ověřovací běh (2× warmup + 5 iterací) pro oba scénáře.                                                   |
| `npm run bench:file-io:large`         |  **Node.js**  | Plný běh **pouze Varianty A** (1× 100 MB sekvenční streamování).                                                |
| `npm run bench:file-io:small`         |  **Node.js**  | Plný běh **pouze Varianty B** (1 000× 4 KB souborů, systémová režie).                                           |
| `npm run bench:file-io:deno`          |   **Deno**    | Spustí plný benchmark v Deno (10× warmup + 30 měřených iterací).                                                |
| `npm run bench:file-io:deno:quick`    |   **Deno**    | Rychlý ověřovací běh v Deno (2× warmup + 5 iterací).                                                            |
| `npm run bench:file-io:deno:large`    |   **Deno**    | Plný běh v Deno **pouze Varianty A** (1× 100 MB).                                                               |
| `npm run bench:file-io:deno:small`    |   **Deno**    | Plný běh v Deno **pouze Varianty B** (1 000× 4 KB).                                                             |
| `npm run bench:file-io:bun`           |    **Bun**    | Spustí plný benchmark v Bun (10× warmup + 30 měřených iterací).                                                 |
| `npm run bench:file-io:bun:quick`     |    **Bun**    | Rychlý ověřovací běh v Bun (2× warmup + 5 iterací).                                                             |
| `npm run bench:file-io:bun:large`     |    **Bun**    | Plný běh v Bun **pouze Varianty A** (1× 100 MB).                                                                |
| `npm run bench:file-io:bun:small`     |    **Bun**    | Plný běh v Bun **pouze Varianty B** (1 000× 4 KB).                                                              |
| `npm run compare`                     | **Porovnání** | Načte summary soubory všech 3 prostředí, vykreslí srovnávací tabulku a uloží `results/file_io_comparison.json`. |
| `npm run clean:results`               |   _Obecné_    | Smaže složku `results/` s naměřenými daty.                                                                      |
| `npm run clean:temp`                  |   _Obecné_    | Bezpečně promaže dočasnou složku `temp/`.                                                                       |

---

## Přímé spuštění přes `node`, `deno` a `bun` (bez npm)

### 1. Node.js

```bash
node runner.js
node runner.js --warmup=2 --iterations=5
node runner.js --scenario=large
node runner.js --scenario=small
```

### 2. Deno

> **Poznámka:** Pokud v aktuálně otevřeném terminálu ještě není načtená nová `PATH`, lze volat `~\.deno\bin\deno.exe`.

```bash
deno run --allow-read --allow-write --allow-sys scenarios/02-file-io/deno.ts
deno run --allow-read --allow-write --allow-sys scenarios/02-file-io/deno.ts --warmup=2 --iterations=5
deno run --allow-read --allow-write --allow-sys scenarios/02-file-io/deno.ts --scenario=large
deno run --allow-read --allow-write --allow-sys scenarios/02-file-io/deno.ts --scenario=small
```

### 3. Bun

> **Poznámka:** Pokud v aktuálně otevřeném terminálu ještě není načtená nová `PATH`, lze volat `~\.bun\bin\bun.exe`.

```bash
bun run scenarios/02-file-io/bun.ts
bun run scenarios/02-file-io/bun.ts --warmup=2 --iterations=5
bun run scenarios/02-file-io/bun.ts --scenario=large
bun run scenarios/02-file-io/bun.ts --scenario=small
```

### 4. Křížové porovnání všech 3 platforem

```bash
node compare.js
# nebo
npm run compare
```

---

## Kam se ukládají výsledky měření?

Po dokončení benchmarku se výsledky automaticky exportují do složky `results/`:

- **Node.js:** `results/file_io_raw_node.json`, `results/file_io_summary_node.json`
- **Deno:** `results/file_io_raw_deno.json`, `results/file_io_summary_deno.json`
- **Bun:** `results/file_io_raw_bun.json`, `results/file_io_summary_bun.json`
- **Společné porovnání:** `results/file_io_comparison.json`
