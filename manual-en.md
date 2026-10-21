# Dice Table — Complete User Manual

> Applies to: 1.2.0+ ｜ Plugin ID: `dice-table` ｜ Marketplace: https://community.obsidian.md/plugins/dice-table
> Updated: 2026-10-21

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

## 4. File naming (template)

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

## 5. Saving: format and mode

| Setting | Options | Notes |
|---------|---------|-------|
| Save format | Markdown / PNG image / JPG image | "Save" writes in whichever format is selected. An image is a clean **result card** (dice name, every pool and result, the time) rendered in your current theme colours at 2× resolution |
| Save mode | New file each time / Append to one file | They **lock each other**: choosing *Append* forces the format back to Markdown; choosing an image format disables *Append* (images always create a new file) |

**Append mode** (useful for session logs): each result is written as a `## YYYYMMDD-HHmm` section inside one file. The file name also follows the naming template (by default one log file per dice). If the target file does not exist yet, it is created with an H1 heading.

---

## 6. Using the view

- **Ribbon icon (🎲)**: opens the roller — in the main tab or the right sidebar, as configured; after changing that setting, clicking the icon moves the view for you.
- **Two dropdowns at the top**: pick the table file, then the dice inside it (the second dropdown only appears for files with several dice).
- **🎲 Roll**: rolls every pool once.
- **↻ next to a row**: re-rolls only that pool (a multi-select pool re-rolls as a whole group); other rows stay as they are.
- **Copy result**: puts the result on your clipboard as text (`- Pool: result`).
- **Save**: writes the result according to your format, mode and naming template.
- **History (N)**: a collapsible area below the results keeping the last 20 rolls of this session; "Load" puts a roll back into the result area (loading a roll from another dice switches file and dice automatically). History lives in memory — restarting Obsidian clears it.

---

## 7. Settings at a glance (6 items)

1. **Dice folder** — where your tables live (the field suggests existing folders as you type; a new path is created on first save);
2. **Default save folder** — where results are written (created automatically if missing, including nested paths);
3. **File name template** — see section 4;
4. **Save format** — Markdown / PNG / JPG;
5. **Save mode** — new file / append (locked against the format, see section 5);
6. **Open location** — main tab / right sidebar.

The interface language **follows Obsidian automatically**: pick Simplified Chinese in Obsidian and the plugin speaks Chinese; any other language shows English. There is no manual language switch.

---

## 8. A table that uses every syntax at once

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
