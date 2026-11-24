# Fabula Ultima Projects & Downtime

A shared downtime dashboard and project manager for the Project FU system (Foundry v13, Project FU 4.14+). Projects are Project FU's own project items, so their cost, progress clock, potency, area, uses and flaw stay on the normal project sheet; this module handles everything around them.

## Install
In Foundry: Add-on Modules → Install Module → paste this Manifest URL:
`https://github.com/EclipseGS27/fu-projects/releases/latest/download/module.json`

Open it with the wrench button in the token controls, or **Projects & Downtime** in a character or party sheet header.

## New project (wizard)
1. **The invention**: name, what it does, the inventor, and whether it lives on the inventor's sheet or the party sheet.
2. **Cost**: pick potency, area and uses, with a live total, the progress needed and an estimate of the days. A **terrible flaw** takes 25% off. Medium potency and above asks for a **special material**. **Helpers** cost half the project's cost each.
3. **When it's done**: drop an item to receive a copy of it, or a new item with the project's name and description is made (a consumable for consumable inventions). Choose the inventor or the party stash, and an optional **deadline**.

## The dashboard
- **Day counter** and what everyone is doing today: working on a project, resting, training, shopping, researching, carousing, odd jobs, travelling, or something else, with a note. Players set their own.
- One card per project, with its **clock**, status, progress per day and days left.
- **Cost**: pay what's owed from a character's purse or the party fund, or drop a valuable item onto the card to put its value towards the cost. With "Pay before work starts" on, nothing advances while money is owed.
- **Special material**: drop it on the card (it is used up), or the GM marks it found.
- **Helpers**: hire them (half the cost each), the GM can add free ones, or dismiss them.
- **Today**: each player clicks their characters onto the project they work on today; a character works on one project a day.
- **End the day** (GM): every project advances by the rules: +1 per character who worked on it, +1 more per Tinkerer, +1 per helper, plus the inventor's Visionary level. Deadlines count down, a summary goes to chat, and finished projects create their item.
- **Complications** (GM button, or on a fumbled work check): setback, price hike, lost day, missing part (work stops until resolved), unwanted attention, happy accident. Mark them resolved when the party deals with them.
- **Clock on the scene**: with Fabula Ultima Battle UI, the GM can show a project as a scene clock that fills as it progresses.
- Each card has a log of payments, work and events.

## Tinkerer and Merchant
- Tinkerers working on a project add the extra progress automatically, and the inventor's **Visionary** level lowers the cost and adds progress (Project FU computes the discount).
- **Merchant in the party** (homebrew world setting, 10% by default): materials cost less.

## Settings
Pay before work starts, work checks (homebrew: INS + DEX against a difficulty; failure −1, critical +1, fumble = complication), work check difficulty, Merchant discount, create the finished item.

All changes run on the GM's client, so a GM must be online.

Fonts: Antonio and PT Sans, SIL Open Font License (see fonts/).
