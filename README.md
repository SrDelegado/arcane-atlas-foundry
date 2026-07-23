# Arcane Atlas Sync — Foundry VTT module

Bring [Arcane Atlas](https://arcaneatlas.org) maps into Foundry VTT.

## Install

In Foundry: **Add-on Modules → Install Module → Manifest URL:**

```
https://github.com/SrMaurons/arcane-atlas-foundry/releases/latest/download/module.json
```

## Free vs Premium

- **Free** — opens any map a DM has marked as public. No API key needed.
  `game.arcaneAtlas.openPublic("<map-id>")`
- **Premium** ([Patreon 5 €/mo](https://www.patreon.com/SrMaurons/membership)) —
  paste the API key from `arcaneatlas.org → Profile → Foundry` into the module
  settings. Then `game.arcaneAtlas.openMap("<map-id>")` opens private maps with
  GM-only markers, hidden zones and signed 24h URLs.

## Release process

1. Bump `version` in `arcane-atlas-sync/module.json`.
2. Zip the folder: `cd arcane-atlas-sync-repo && zip -r arcane-atlas-sync.zip arcane-atlas-sync`.
3. Create a GitHub release tagged `vX.Y.Z` and upload both `module.json` and
   `arcane-atlas-sync.zip` as release assets.
4. Foundry pulls the manifest from
   `releases/latest/download/module.json` — no code change needed on the web.
