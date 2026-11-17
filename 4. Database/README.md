# Benchmarková sada pro analýzu běhových prostředí (Node.js, Deno, Bun)

Praktická část bakalářské práce: _„Sestavení benchmarkové sady pro analýzu běhových prostředí JavaScriptových aplikací (Node.js, Deno, Bun)“_.

Tento modul implementuje kompletní **Kategorii 4: Databázové operace (`04-database`)** nad vestavěnými nativními rozhraními **SQLite** pro všechna tři srovnávaná běhová prostředí: **Node.js**, **Deno** a **Bun**.

---

## Přehled modulů Kategorie 4 (04-database)

Všechna tři prostředí využívají **výhradně vestavěné nativní SQLite ovladače** bez externích knihoven třetích stran:

- **Node.js ([`scenarios/04-database/node.mjs`](file:///f:/unicorn/zdrojaky/BP/4.%20Database/scenarios/04-database/node.mjs)):** Vestavěný modul `node:sqlite` (`DatabaseSync` z Node.js 22+).
- **Deno ([`scenarios/04-database/deno.ts`](file:///f:/unicorn/zdrojaky/BP/4.%20Database/scenarios/04-database/deno.ts)):** Vestavěný modul `node:sqlite` (`DatabaseSync`).
- **Bun ([`scenarios/04-database/bun.ts`](file:///f:/unicorn/zdrojaky/BP/4.%20Database/scenarios/04-database/bun.ts)):** Vestavěný nativní modul `bun:sqlite` (`Database`).

### Konfigurace databáze a schéma:
- Databáze se pro každou iteraci vytváří jako fyzický soubor v adresáři `temp/` a po skončení iterace se kompletně smaže (včetně souborů `-wal` a `-shm`).
- Nastavené PRAGMA parametry: `PRAGMA journal_mode = WAL;` a `PRAGMA synchronous = NORMAL;`.
- Tabulka `users` (`id`, `username`, `email`, `role`, `score`, `created_at`, `payload`) se sekundárními indexy `idx_users_role` a `idx_users_score`.

### Testované scénáře:
1. **Varianta A: Dávkové vkládání (`BATCH INSERT`, 1 000 záznamů)**
   - Vložení 1 000 deterministických záznamů uvnitř jedné explicitní transakce (`BEGIN TRANSACTION` ... `COMMIT`) pomocí prepared statementu (`INSERT INTO users ...`).
2. **Varianta B: Komplexní čtení a materializace (`SELECT`, 10 000 záznamů)**
   - Série 25 parametrizovaných čtecích dotazů s filtrováním, řazením (`WHERE role = ? AND score > ? ORDER BY score DESC LIMIT 500`) a agregací (`GROUP BY role`) nad databází s 10 000 záznamy, včetně materializace do pole JS objektů a výpočtu deterministického kontrolního součtu (`checksum`).

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

Detailní přehled všech příkazů naleznete v souboru [COMMANDS.md](file:///f:/unicorn/zdrojaky/BP/4.%20Database/COMMANDS.md).
