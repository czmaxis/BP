# Benchmarková sada pro analýzu běhových prostředí (Node.js, Deno, Bun)

Praktická část bakalářské práce: _„Sestavení benchmarkové sady pro analýzu běhových prostředí JavaScriptových aplikací (Node.js, Deno, Bun)“_.

Tento modul implementuje kompletní **Kategorii 3: CPU-náročné úlohy (`03-cpu`)** pro všechna tři srovnávaná běhová prostředí: **Node.js**, **Deno** a **Bun**.

---

## Přehled modulů Kategorie 3 (03-cpu)

Všechna tři prostředí spouštějí **100% identické výpočetní algoritmy** ze sdíleného modulu [`core/cpu-workloads.js`](file:///f:/unicorn/zdrojaky/BP/3.%20CPU/core/cpu-workloads.js) nad bitově shodnými deterministickými vstupy (generovanými přes seedovaný PRNG `Mulberry32`):

1. **Varianta A: Kryptografické hashování (`cpu-crypto-webcrypto`)**
   - Iterativní odvození klíče pomocí `PBKDF2-HMAC-SHA512` (120 000 iterací) a 80 zřetězených kol `SHA-512` / `SHA-256` nad 64KB blokem dat přes standardní nativní rozhraní `crypto.subtle` (WebCrypto API).
2. **Varianta B: Polymorfní JSON transformace a řazení (`cpu-json-polymorphic`)**
   - Hluboká filtrace a transformace 10 000 polymorfních objektů (4 odlišné tvary objektů / *Hidden Classes* pro testování polymorfních *Inline Caches*), víceúrovňové řazení (`Array.prototype.sort` s vlastním komparátorem), serializace přes `JSON.stringify()` a zpětné parsování přes `JSON.parse()`.
3. **Varianta C: Numerické a maticové výpočty (`cpu-matrix-multiply`)**
   - Vícenásobné násobení hustých matic $250 \times 250$ (`Float64Array`, 4 průchody = $125\,000\,000$ FMA operací na iteraci) s dyadickými zlomky ($k/16$) pro 100% bitově exaktní IEEE-754 součty napříč V8 (TurboFan) a JavaScriptCore (DFG/FTL).

---

## Obrana proti „Microbenchmark Fallacy“ a eliminace Observer Effectu

- **Deterministická mutace vstupu (`prepareIteration(i)`):** Před každou iterací $i$ (striktně mimo měřený čas `performance.now()`) se vstupní struktury deterministicky zmutují podle indexu $i$, takže JIT kompilátor nemůže kešovat konstantní výsledek.
- **Vynucený akumulátor (Blackhole & Checksum):** Každá iterace vrací deterministický 32bitový kontrolní součet (`checksum`), který se akumuluje do globálního akumulátoru a na konci měření se v [`compare.js`](file:///f:/unicorn/zdrojaky/BP/3.%20CPU/compare.js) automaticky ověřuje, že `checksum` je mezi Node.js, Deno a Bun **bitově shodný**.
- **Metodika měření:** 50 zahřívacích cyklů (Warmup) následovaných $N = 30$ měřenými iteracemi. Časování `performance.now()` a čtení RSS paměti probíhají výhradně na hranicích ucelených iterací.

---

## Rychlé spuštění

```bash
# Plný běh všech 3 prostředí (50 warmup + 30 měřených iterací) + verifikace checksumů
npm start

# Rychlý ověřovací běh všech 3 prostředí (5 warmup + 5 iterací)
npm run bench:all:quick

# Samostatné spuštění pro Node.js / Deno / Bun
npm run bench:node
npm run bench:deno
npm run bench:bun

# Vykreslení srovnávací tabulky a kontrola shody checksumů
npm run compare
```

Detailní přehled všech příkazů naleznete v souboru [COMMANDS.md](file:///f:/unicorn/zdrojaky/BP/3.%20CPU/COMMANDS.md).
