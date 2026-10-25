# Příkazy pro spuštění benchmarku z terminálu

Tento přehled obsahuje všechny dostupné `npm`, `node` a `deno` příkazy pro spuštění benchmarkové sady pro **Kategorii 2: Souborové I/O operace** (Node.js & Deno).

---

## Rychlý přehled npm skriptů

| Příkaz | Prostředí | Popis |
| :--- | :---: | :--- |
| `npm start` / `npm run bench:file-io` | **Node.js** | Spustí plný benchmark obou scénářů (10× warmup + 30 měřených iterací). |
| `npm run bench:file-io:quick` | **Node.js** | Rychlý ověřovací běh (2× warmup + 5 iterací) pro oba scénáře. |
| `npm run bench:file-io:large` | **Node.js** | Plný běh **pouze Varianty A** (1× 100 MB sekvenční streamování). |
| `npm run bench:file-io:small` | **Node.js** | Plný běh **pouze Varianty B** (1 000× 4 KB souborů, systémová režie). |
| `npm run bench:file-io:large:quick` | **Node.js** | Rychlý běh pouze Varianty A (2× warmup + 5 iterací). |
| `npm run bench:file-io:small:quick` | **Node.js** | Rychlý běh pouze Varianty B (2× warmup + 5 iterací). |
| `npm run bench:file-io:deno` | **Deno** | Spustí plný benchmark v Deno (10× warmup + 30 měřených iterací). |
| `npm run bench:file-io:deno:quick` | **Deno** | Rychlý ověřovací běh v Deno (2× warmup + 5 iterací). |
| `npm run bench:file-io:deno:large` | **Deno** | Plný běh v Deno **pouze Varianty A** (1× 100 MB). |
| `npm run bench:file-io:deno:small` | **Deno** | Plný běh v Deno **pouze Varianty B** (1 000× 4 KB). |
| `npm run clean:results` | *Obecné* | Smaže složku `results/` s naměřenými daty. |
| `npm run clean:temp` | *Obecné* | Bezpečně promaže dočasnou složku `temp/`. |

---

## Spuštění s vlastními parametry (přes `npm` s `--`)

Pokud chcete z terminálu předat vlastní počet iterací nebo zahřívacích cyklů, použijte oddělovač `--`:

```bash
# Node.js: Vlastní počet zahřívacích cyklů a iterací
npm run bench:file-io -- --warmup=5 --iterations=20

# Deno: Vlastní počet zahřívacích cyklů a iterací
npm run bench:file-io:deno -- --warmup=5 --iterations=20
```

---

## Přímé spuštění přes `node` a `deno` (bez npm)

### 1. Node.js
```bash
# Základní spuštění dle výchozího config.json (10 warmup + 30 iterací)
node runner.js

# Rychlý test
node runner.js --warmup=2 --iterations=5

# Pouze Varianta A (100 MB) nebo Varianta B (1 000 x 4 KB)
node runner.js --scenario=large
node runner.js --scenario=small
```

### 2. Deno
> **Poznámka k oprávněním:** Deno běží v bezpečném sandboxu a vyžaduje explicitní příznaky `--allow-read` (čtení konfigurace a testovacích souborů), `--allow-write` (zápis do `temp/` a `results/`) a `--allow-sys` (čtení metadat o OS a RAM).
> Pokud v otevřeném okně terminálu ještě není aktualizovaná proměnná `PATH`, lze volat plnou cestu `~\.deno\bin\deno.exe`.

```bash
# Plné spuštění dle config.json (10 warmup + 30 iterací)
deno run --allow-read --allow-write --allow-sys scenarios/02-file-io/deno.ts

# Rychlý test (2 warmup + 5 iterací)
deno run --allow-read --allow-write --allow-sys scenarios/02-file-io/deno.ts --warmup=2 --iterations=5

# Pouze Varianta A (100 MB) nebo Varianta B (1 000 x 4 KB)
deno run --allow-read --allow-write --allow-sys scenarios/02-file-io/deno.ts --scenario=large
deno run --allow-read --allow-write --allow-sys scenarios/02-file-io/deno.ts --scenario=small
```

---

## Kam se ukládají výsledky měření?

Po dokončení benchmarku se výsledky automaticky exportují do složky `results/`:

- **Node.js:**
  - `results/file_io_raw_node.json` – surová data všech 30 iterací.
  - `results/file_io_summary_node.json` – agregované statistiky ($p50$, $p95$, $p99$, průměr, $\sigma$, MB/s).
- **Deno:**
  - `results/file_io_raw_deno.json` – surová data všech 30 iterací.
  - `results/file_io_summary_deno.json` – agregované statistiky ($p50$, $p95$, $p99$, průměr, $\sigma$, MB/s).
