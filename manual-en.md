# Dice Table — Complete User Manual

> Applies to: 1.3.0+ ｜ Plugin ID: `dice-table` ｜ Marketplace: https://community.obsidian.md/plugins/dice-table
> Updated: 2026-10-22

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

> Want "roll a random few pools each time" instead of "roll several faces from one pool"? That is a different marker (`×N池`, written on the H1 line) — see section 5.

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

### [[ ]] links: point at an exact file

After `->` you can write a native Obsidian link, so references hit exactly what you mean:

| You write | Effect |
|-----------|--------|
| `## Race -> [[Race library]]` | References "Race library" anywhere in the vault (resolved by Obsidian's link engine — **not limited to the dice folder**) |
| `## Race -> [[World/Race library]]` | Points at an exact folder |
| `## Character -> [[Character card#Template]]` | Points at an exact dice inside an exact file |
| `## Race -> Race library` | Plain text name: matched only inside the dice folder (legacy syntax, still works) |

**Which form to use**: `[[ ]]` links resolve exactly like links in your notes (Obsidian's own resolution rules), so they hit precisely what you mean — use them for cross-folder references. A plain name (`-> Race library`) is matched inside the dice folder only.

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
# Scene card ×3池

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

## 6. File naming (template)

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

## 7. Saving: format and mode

| Setting | Options | Notes |
|---------|---------|-------|
| Save format | Markdown / PNG image / JPG image | "Save" writes in whichever format is selected. An image is a clean **result card** (dice name, every pool and result, the time) rendered in your current theme colours at 2× resolution |
| Save mode | New file each time / Append to one file | They **lock each other**: choosing *Append* forces the format back to Markdown; choosing an image format disables *Append* (images always create a new file) |

**Append mode** (useful for session logs): each result is written as a `## YYYYMMDD-HHmm` section inside one file. The file name also follows the naming template (by default one log file per dice). If the target file does not exist yet, it is created with an H1 heading.

---

## 8. Using the view

- **Ribbon icon (🎲)**: opens the roller — in the main tab or the right sidebar, as configured; after changing that setting, clicking the icon moves the view for you.
- **Two dropdowns at the top**: pick the table file, then the dice inside it (the second dropdown only appears for files with several dice).
- **📄 Open file** (new in 1.3.0): the button next to the table dropdown opens the current table's `.md` directly — tweak pools without hunting through your vault (an already-open tab is focused instead of duplicated, and the note you are editing is never overwritten).
- **🎲 Roll**: rolls every pool once.
- **↻ next to a row**: re-rolls only that pool (a multi-select pool re-rolls as a whole group); other rows stay as they are.
- **Copy result**: puts the result on your clipboard as text (`- Pool: result`).
- **Save**: writes the result according to your format, mode and naming template.
- **History (N)**: a collapsible area below the results keeping the last 20 rolls of this session; "Load" puts a roll back into the result area (loading a roll from another dice switches file and dice automatically). History lives in memory — restarting Obsidian clears it.

---

## 9. Settings at a glance (6 items)

1. **Dice folder** — where your tables live (the field suggests existing folders as you type; a new path is created on first save; changes take effect immediately, no restart);
2. **Default save folder** — where results are written (created automatically if missing, including nested paths);
3. **File name template** — see section 6;
4. **Save format** — Markdown / PNG / JPG;
5. **Save mode** — new file / append (locked against the format, see section 5);
6. **Open location** — main tab / right sidebar.

The interface language **follows Obsidian automatically**: pick Simplified Chinese in Obsidian and the plugin speaks Chinese; any other language shows English. There is no manual language switch.

---

## 10. A table that uses every syntax at once

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

And one with a **random subset of pools** (`×3池` on the H1 line, compact syntax inside):

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
