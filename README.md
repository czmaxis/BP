# Benchmarková sada pro analýzu běhových prostředí (Node.js, Deno, Bun)

Praktická část bakalářské práce: _„Sestavení benchmarkové sady pro analýzu běhových prostředí JavaScriptových aplikací (Node.js, Deno, Bun)“_.

Tento modul implementuje **Kategorii 2: Souborové I/O operace** pro **Node.js** s architekturou připravenou na budoucí rozšíření o Deno a Bun.

---

## Přehled modulů Kategorie 2 (File I/O)

1. **Varianta A: Sekvenční streamování – Velký soubor (1× 100 MB)**
   - Testuje hrubou propustnost I/O a chování paměti při streamování.
   - Používá nativní proudy (`node:fs` - `createWriteStream`, `createReadStream`) s bloky o velikosti 64 KB a řízením zpětného tlaku (`drain`).
2. **Varianta B: Systémová režie – Malé soubory (1 000× 4 KB)**
   - Testuje režii systémových volání OS, metadata souborového systému a zatížení thread poolu knihovny `libuv`.
   - Používá asynchronní `Promise.all` s `writeFile` a `readFile` z `node:fs/promises`.

---

## Příkazy pro spuštění z terminálu

Detailní přehled příkazů naleznete také v souboru [COMMANDS.md](file:///f:/unicorn/zdrojaky/BP/COMMANDS.md).

### Standardní běhy (dle metodiky práce: 10 warmup + 30 měření)

```bash
# Spuštění plného benchmarku (obě varianty)
npm start
# nebo
npm run bench:file-io

# Spuštění pouze Varianty A (1x 100 MB soubor)
npm run bench:file-io:large

# Spuštění pouze Varianty B (1 000x 4 KB soubory)
npm run bench:file-io:small
```

### Rychlé ověřovací běhy (2 warmup + 5 měření)

```bash
# Rychlý běh pro obě varianty
npm run bench:file-io:quick

# Rychlý běh pouze pro velký soubor
npm run bench:file-io:large:quick

# Rychlý běh pouze pro malé soubory
npm run bench:file-io:small:quick
```

### Běh s vlastními parametry

```bash
# Předání parametrů do npm skriptu (oddělovač --)
npm run bench:file-io -- --warmup=5 --iterations=15

# Přímé volání přes Node.js
node runner.js --warmup=3 --iterations=10 --scenario=large
```

### Pomocné úklidové příkazy

```bash
npm run clean:results   # Vymaže složku s výsledky results/
npm run clean:temp      # Vyčistí dočasnou složku temp/
```

---

## Výstupní data

Výsledky se ukládají ve formátu JSON do adresáře `results/`:

- `results/file_io_raw_node.json`: Detailní hodnoty každé iterace (doba zápisu, doba čtení, RSS paměť před/po, propustnost v MB/s a ops/s).
- `results/file_io_summary_node.json`: Statistické agregace (medián $p50$, $p95$, $p99$, průměr $\mu$, směrodatná odchylka $\sigma$, min, max).
