# Dice Table — Complete User Manual

> Applies to: 1.5.0+ ｜ Plugin ID: `dice-table` ｜ Marketplace: https://community.obsidian.md/plugins/dice-table
> Updated: 2026-10-30

---

## 1. How to write a dice table

A dice table is an ordinary Markdown note (`.md`) stored in your **dice folder** (default `dice tables/`, configurable in Settings). Every file has three levels:

| Level | Syntax | Meaning |
|-------|--------|---------|
| **H1** (`# one hash`) | `# Expedition` | The **name of the dice**. A file may contain several H1s — the view then shows a second dropdown to pick one |
| **H2** (`## two hashes`) | `## Weather` | A **pool** — one result row per pool. The more pools, the more rows you roll at once |
| **Dash item** (`- `) | `- Sunny` | A **face** to roll from |

The simplest complete example:

```markdown
# Expedition

## Weather
- Sunny
- Rain
- Storm

## Guardian
- Ancient puppet
- Sleeping serpent god
```

Rolling once produces two rows: one drawn from **Weather**, one from **Guardian**.

**About the "dice folder"** (the first setting, clarified in 1.3.0):
- The plugin only reads `.md` files inside this folder **and all of its sub-folders** — it is **not the whole vault**; `.md` files elsewhere are not treated as tables;
- The "Table" dropdown in the view **only lists `.md` files directly in this folder**; tables in sub-folders do not appear in the dropdown, but they can still be reached through references from other tables (see section 4);
- A referenced library file can live **anywhere inside the dice folder** — it does **not** have to sit next to the referring table; with `[[ ]]` links you can even reference tables **outside** the dice folder;
- Changing the dice folder takes effect **immediately** — no plugin restart needed (since 1.3.0).

**Good to know:**
- Dash items belong to the H2 above them (blank lines and paragraphs in between are fine — the plugin only reacts to `#`, `##` and `-` lines);
- YAML front matter (the `---` block at the top of a note) and code blocks are skipped automatically;
- Content before the first H1, or without any H2, is ignored;
- New, renamed or deleted table files are picked up automatically within about half a second — no plugin restart needed.

---

## 2. Multi-select: rolling several results from one pool

Add `×N` to the end of an **H2 heading** to draw N results from that pool:

| You write | Effect |
|-----------|--------|
| `## Loot ×3` | Draw **3** results, **without repeats** (default) |
| `## Loot *3` | Same — `*` works too |
| `## Loot x3` / `X3` | Same — lower/upper `x` also work (you never have to hunt for the `×` key) |
| `## Weather` (no marker) | Draw 1 result (default) |

**Allowing repeats**: put the marker **directly after the number, with no space**:

| You write | Effect |
|-----------|--------|
| `## Encounters ×3重复` | Draw 3, repeats allowed (Chinese marker) |
| `## Encounters ×3repeat` | Same (English marker, case-insensitive) |
| `## Encounters ×3r` | Same (short form) |

⚠️ A space breaks it: `×3 重复` and `X2 repeat` are **not** recognised and are treated as part of the pool name.

**Not enough faces:** if you write `×5` but the pool only has 2 faces, you get all 2 — no error, no empty result.

**Re-rolling a multi-select pool:** the ↻ button next to a result re-rolls the **whole group** (all 3 entries change together), while other pools stay untouched.

> Want "roll a random few pools each time" instead of "roll several faces from one pool"? That is a different marker (`×N`, written on the H1 line) — see section 5.

---

## 3. Weights: making one face more likely

Add `^N` to the end of a **dash item** to multiply the chance of that face being drawn:

```markdown
## Loot
- Common sword
- Rare sword ^5
- Legendary sword ^10
```

With the table above the real odds are **Common 6.25% / Rare 31.25% / Legendary 62.5%** (weights 1 : 5 : 10).

Rules:
- no `^N` means weight 1 (ordinary);
- `^1` is the same as no marker; `^0` or a malformed marker (no digits, or `^` in the middle of the text) safely falls back to weight 1 — no error;
- weights work with multi-select pools too: `×3` samples without repeats by weight, `×3repeat` draws each result independently by weight.

---

## 4. Nesting and references: tables calling tables

(New in 1.3.0)

### Pool references: define a set once, reuse everywhere

`## Pool -> Target`: this pool does not roll itself — it rolls whatever the target points at.

```markdown
# Attributes

## Race
- Human
- Elf
- Dwarf

## Class
- Fighter
- Mage

# Character generator

## Character ×3 -> Attributes
```

"Character ×3 -> Attributes" rolls 3 characters at once, each one rolling every pool of Attributes (race + class). The attribute set is defined **once** under `# Attributes` — change it there and all 3 characters update. Do not copy-paste.

⚠️ An attribute set must be an **independent H1 dice** (like `# Attributes`) or an H3 sub-pool — **never a plain H2 next to the character pool**; a same-level H2 would be rolled as an ordinary pool and produce a redundant extra result.

### Chain references: keep rolling after a hit

`- Face -> Target`: when this face is drawn, the target pool is rolled once more and the results are joined using the format from Settings (default: `Magic item: legendary (legendary)`; wrap/separator symbols are configurable).

```markdown
## Treasure
- Magic item -> Rarity
- Common coin
```

### H3 sub-pools: a whole set of traits in one roll

```markdown
## Character
### Hair color
- Black
- Blond
### Height
- Tall
- Short
```

One roll draws one hair colour and one height; sub-pools are shown indented in the results, and ↻ on the parent re-rolls the whole group.

### Compact syntax: a whole pool on one line

`## Pool｜face1｜face2` (full-width ｜ as separator) — mixable with standard syntax, and `×N` / `^N` keep working:

```markdown
### Hair color｜Black｜Blond｜Silver white
```

### Nesting as deep as you like: dice calling dice, layer after layer

References are **recursive**: a referenced dice can itself contain pools that reference other dice — layer upon layer, up to 5 levels deep. The typical scenario (a CP generator):

```markdown
# CP generator

## CP ×2 -> Character card     ← layer 1: roll 2 characters at once
```

```markdown
# Character card

## Hair -> Hair library#Color  ← layer 2: each trait rolls its own library
## Personality -> Personality library#Trait
## Skill -> Skill library#Ability
```

```markdown
# Hair library

## Color
- Jet black
- Platinum
- Silver white
```

One roll of "CP generator" = 2 characters, each with hair, personality and skill drawn from their own libraries. **The character card is defined once** — the CP generator, a party generator, any table can `-> Character card` and reuse it; change it in one place and everything updates.

Three reference shapes (what goes after `->`):

| You write | Effect |
|-----------|--------|
| `## Pool -> Character card` | References a **whole dice**: every pool of the target rolls once |
| `## Hair -> Hair library#Color` | References a **single pool** inside the target |
| `## CP ×2 -> Character card` | Rolls **N instances** at once, each expanding every pool of the target |

**How to write a library (important)**: a library is just an ordinary table — `# Library name` + `## Pool name` + dash faces. **Faces cannot sit directly under an H1** (faces are only recognised under H2/H3 pool headings; faces directly under an H1 are ignored). Several dice referencing each other inside one file is perfectly fine (the sample `CP generator.md` crams 5 dice into one file, all cross-referencing); for cross-file references see the links section below.

### [[ ]] wiki links and []() Markdown links: point at an exact file

After `->` you can write a link, so references hit exactly what you mean. **All three Obsidian wiki-link forms are supported, and Markdown links `[]()` work too** (that is the form Obsidian uses when the wiki-link setting is off):

| Form | You write | Notes |
|------|-----------|-------|
| Shortest | `## Race -> [[Race library]]` | File name only; Obsidian resolves it vault-wide |
| Vault path | `## Race -> [[World/Race library]]` | Tried as a vault-root path first, then as a path relative to the current table's folder (Obsidian's relative form drops the `./`) |
| Absolute | `## Race -> [[/World/Race library]]` | Leading slash; same as the vault-root path |
| Relative | `## Race -> [[../Lib/Race library]]` | Relative to the current table file's folder (`..` up, `.` here) |
| Markdown link | `## Race -> [Race library](World/Race library.md)` | `[text](path)` form; the same path rules apply (`../`, `#anchor`; spaces may be written as `%20`) |

Add `#` to point at an exact dice or pool: `## Character -> [[Character card#Template]]`, `## Hair -> [[Hair library#Color]]`, `## Character -> [Character card](Character card.md#Template)`.

**Division of labour with plain names**: link forms follow Obsidian's own resolution rules and can reach files in **other documents (including outside the dice folder)**; a plain name (`-> Race library`) is looked up **inside the current document only** — cross-document references always use link forms, never bare names (finalized by 阿麦 on 2026-10-23: if a bare name is not found the plugin says so, it never silently searches elsewhere).

---

## 5. Random subset of pools: rolling a random few pools each time

(New in 1.3.0)

Same marker family as multi-select `×N`, just written on a **different line**: multi-select goes on the H2 line (several faces from one pool), the random subset goes on the H1 line (a random few pools per roll).

Add `×N` to the end of the **H1 heading** and each roll of this dice **randomly draws N pools** (pools not drawn do not appear in the result):

| You write | Effect |
|-----------|--------|
| `# Scene card ×3` | Rolls 3 of the 5 pools at random, **without repeats** (default) |
| `# Scene card ×3重复` | Rolls 3 at random, **the same pool may be drawn more than once** |
| `# Scene card` (no marker) | Rolls every pool (default) |

```markdown
# Scene card ×3

## Time
- Early morning
- Dusk

## Place
- Market
- Mountain pass

## Era
- Past
- Future

## Smell
- Blood
- Flowers

## Sound
- Crows
- Wind
```

The first roll might produce "Era, Smell, Time", the next "Place, Sound, Smell" — a different combination every time.

**Division of labour with multi-select**:
- `## Pool ×3` (H2 line) = 3 **faces** from one pool;
- `# Dice ×3` (H1 line) = a random 3 **pools** per roll.

---

## 6. Random numbers: roll a number directly

(New in 1.4)

A pool does not have to hold written-out entries — it can roll a **number** straight from a range. Put the range in the H2 heading:

| You write | Effect |
|-----------|--------|
| `## Strength 1~100` | A random integer from 1 to 100 (1 and 100 included) |
| `## Weight 0.1~9.9 小数2位` | A decimal with 2 places kept (e.g. 3.50) |
| `## Luck ×5 1~100` | Rolls 5 at once, **all different** (default) |
| `## Temperature ×3repeat -10~10` | Rolls 3 at once, duplicates allowed; negatives supported |

Three rules:

1. **Ranges use the tilde `~`** — the dash `-` already means "face" in this syntax, so it cannot double as a range separator; the tilde handles negatives naturally (`-10~10`);
2. **Integers by default**; for decimals either write the bounds with decimal points (`1.00~9.00` → 2 places, `0.5~1.5` → 1 place) or state `小数N位` explicitly (the explicit marker wins);
3. **"Roll N at once" reuses `×N`, without repeats by default** — add `r` / `repeat` / `重复` to allow duplicates (same rule as pool multi-select: one syntax to remember).

Number pools save, write to notes, export as images, land in history and re-roll singly exactly like ordinary pools; every number in the range is equally likely, so `^N` weights mean nothing for a number pool (ignored if written).

```markdown
# Character stats

## Strength 1~100
## Weight 0.1~9.9 小数2位
## Luck ×5 1~100
## Temperature ×3repeat -10~10
```

---

## 7. Word banks & sentence templates: `{placeholders}`

Write `{pool name}` inside a face and the plugin fills it with a random word from the same-named pool when you roll. **A word bank is nothing new — any ordinary pool is one.**

```markdown
# Sentence generator

## Sentence
- A {color} {gem} appears in the {place}
- {name} picks up {name}'s sword

## Color
- red ^5
- blue

## Gem
- agate
- crystal
```

| You write | Behavior |
|-----------|----------|
| `{Color}` | Fills one word from the same-named pool **in this document**; weights `^N` apply |
| `{[[File#Pool]]}`, `{[text](file.md#Pool)}` | Cross-document — same rules as `->` references (a `\|alias` is stripped) |
| `{Strength}` (a number pool) | Fills a number from the range |
| Same placeholder appears twice | Rolled **once per roll** — every occurrence gets the same word |
| `{Colour}` (no such pool / empty pool) | Kept literally as `{Colour}`, plus a notice after the roll — typos are visible immediately |

Three notes:

- **Each instance rolls its own**: with `## CP ×2 -> Character`, the two characters roll their own words (they never share one name);
- Placeholders **take the word only**: a `->` chain on a bank face is not triggered here (want rarity? write a separate `{Rarity}` placeholder);
- A `{...}` inside a picked word is kept literally (no recursion).

---

## 8. File naming (template)

In Settings, the **file name template** works like this: text in braces is a variable, everything outside braces is literal text.

| Variable | Meaning |
|----------|---------|
| `{H1}` | Dice name (the H1 heading) |
| `{H2}` / `{H2:2}` | 1st / N-th pool name (the clean name, without the `×N` marker) |
| `{YYYY}` `{YY}` `{MM}` `{DD}` | Year / last two digits of the year / month / day |
| `{HH}` `{mm}` `{ss}` | Hour / minute / second |
| `{WW}` | ISO week number |
| `{YYYYMMDD}` | Year-month-day in one piece |
| `{YYYYMMDD-HHmm}` | Date and time in one piece (combined variable) |
| `{HHmm}` | Hour and minute in one piece |

The default is `{H1}_{YYYYMMDD-HHmm}` → `Expedition_20261021-1022.md`.

Handled automatically (nothing for you to do):
- illegal characters in the dice name (`\ / : * ? " < > |`) are replaced with safe ones, so the file can actually be created;
- a file with the same name already exists gets a sequence suffix (`-2`, `-3`) — **your files are never overwritten**;
- a mistyped variable (e.g. `{FOO}`) is kept as-is in the name, so you can spot the typo immediately.

---

## 9. Saving: format and mode

| Setting | Options | Notes |
|---------|---------|-------|
| Save format | Markdown / PNG image / JPG image | "Save" writes in whichever format is selected. An image is a clean **result card** (dice name, every pool and result, the time) rendered in your current theme colours at 2× resolution |
| Save mode | New file each time / Append to one file | They **lock each other**: choosing *Append* forces the format back to Markdown; choosing an image format disables *Append* (images always create a new file) |

**Append mode** (useful for session logs): each result is written as a `## YYYYMMDD-HHmm` section inside one file. The file name also follows the naming template (by default one log file per dice). If the target file does not exist yet, it is created with an H1 heading.

---

## 10. Using the view

- **Ribbon icon (🎲)**: opens the roller — in the main tab or the right sidebar, as configured; after changing that setting, clicking the icon moves the view for you.
- **Sticky toolbar** (new layout in 1.6.0): one row pinned to the top; however far you scroll, it stays put —
  - **Dice icon**: rolls every pool once (no tooltip — it does what it says);
  - **File-name dropdown**: switch to another table file in the same folder; a second "Dice" dropdown appears below when the file has several dice;
  - **Open file** (tooltip on hover): opens the current table's `.md` directly — tweak pools without hunting through your vault (an already-open tab is focused instead of duplicated, and the note you are editing is never overwritten);
  - **⋮ More actions**: a native menu keeps the less-frequent actions out of the way — **Save** (format, mode and naming template as configured), **Copy result** (to the clipboard as `- Pool: result`), **Write to note**, and **Change table folder** (a dialog with official folder suggestions; stays in sync with the settings tab — change it on either side and both update instantly);
- **↻ next to a row**: re-rolls only that pool (a multi-select pool re-rolls as a whole group); other rows stay as they are.
- **History (N)**: a collapsible area below the results keeping the last 20 rolls; "Load" puts a roll back into the result area (loading a roll from another dice switches file and dice automatically). History is persisted — it survives restarting Obsidian.

---

## 11. Settings at a glance (6 items)

1. **Dice folder** — where your tables live (the field suggests existing folders as you type; a new path is created on first save; changes take effect immediately, no restart);
2. **Default save folder** — where results are written (created automatically if missing, including nested paths);
3. **File name template** — see section 8;
4. **Save format** — Markdown / PNG / JPG;
5. **Save mode** — new file / append (locked against the format, see section 9);
6. **Open location** — main tab / right sidebar.

The interface language **follows Obsidian automatically**: pick Simplified Chinese in Obsidian and the plugin speaks Chinese; any other language shows English. There is no manual language switch.

---

## 12. A table that uses every syntax at once

```markdown
# Expedition

## Weather
- Sunny
- Rain ^2
- Storm ^5

## Encounters ×3
- Wandering merchant
- Ruin guardian ^5
- Lost scholar
- Cultists
- Beast pack

## Bonuses ×2repeat
- Strength +1
- Agility +1
- Luck +1

## Environment
- Dim and damp
- Smells of rust
```

- **Weather** draws 1 result; Rain is twice as likely as Sunny, Storm five times;
- **Encounters ×3** draws 3 different results; the ruin guardian shows up more often;
- **Bonuses ×2repeat** draws 2 results and the same bonus may appear twice;
- **Environment** draws 1 ordinary result.

And one with a **random subset of pools** (`×3` on the H1 line, compact syntax inside):

```markdown
# Scene card ×3

## Time｜Early morning｜Dusk｜Midnight
## Place｜Market｜Mountain pass｜Ruins
## Era｜Past｜Present｜Future
## Smell｜Blood｜Flowers｜Mold
## Sound｜Crows｜Wind｜Thunder
```

- Each roll draws 3 random dimensions (without repeats), and one face from each;
- Want repeats allowed? Change the H1 to `# Scene card ×3重复`.
