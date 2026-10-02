# Minion — GM companion for Pathfinder 2e & D&D 5e

Author campaigns with AI help, then run them offline on a tablet: tappable story text, battle maps with fog of war, initiative, and 3D dice.

## Run & deploy

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static output in dist/
```

`dist/` is a fully static PWA with a relative base path. Copy it to any web server, at any path; no rewrites are needed because routing uses `#/…` URLs. Serve it over HTTPS (localhost is fine) so the service worker and "Add to Home Screen" work. After the first visit, everything except AI calls works offline.

## Concepts

- **Entities.** Everything is an entity: chapter, scene, location, NPC, creature, faction, item, spell, encounter, handout, rule, note. Each has Markdown text, GM secrets, images and an optional stat block.
- **Links.** `[[Name]]`, `[[Name|shown text]]` and `[[spell:Fireball]]` become tappable chips. Names of campaign entries are also linked automatically. Links resolve to campaign entries first (so homebrew overrides official content), then to the bundled rules. Unresolved links show a dashed chip, and tapping it lets you create the entry or have the AI homebrew it.
- **Rules reference.** Offline rules data lives in `public/compendium/`:
  - PF2e: ORC content from Player Core 1/2, GM Core and Monster Core, sourced from the Foundry pf2e repo.
  - D&D 5e: SRD 5.2 under CC-BY-4.0, sourced from 5e-bits.
  - Rebuild it with `node scripts/compendium/build.mjs`.
- **Campaign chat.** An agent with tools that read and write everything: entries, party, settings, battle maps, images and rules lookups. Every change is recorded in History and can be undone per change or per AI turn. You can ask advisors (personas, each with its own model) for opinions.
- **Builder.** A pipeline with these steps: premise → outline → locations → NPCs → encounters → write chapters → fill missing links → battle maps → illustrations. Each step can be Manual, Assisted (you review it, give feedback or undo) or Auto. With every step on Auto it is a one-click module. The "Extend" scope continues an existing campaign.
- **Language.** AI-written content uses the campaign's language. Rules terms stay in English so they still link.
- **Battle maps.** Images are AI-painted from free-form descriptions, or uploaded. A grid overlay is calibrated to the image. Maps hold tokens, HP, conditions, initiative and fog (brush to paint or erase), and all of this persists until you press Reset or save it as the new starting setup. Area links lead to sub-maps; a new sub-map is painted using the cropped area of the parent map as reference. Player view is a full-screen map with opaque fog and no GM information.
- **Data.** Everything is stored in IndexedDB on the device. Use "Export campaign" or "Save all" / "Load…" (file pickers where the browser supports them, otherwise download/upload) to move data between devices and to keep backups.

## Settings

Add an OpenRouter API key in Settings. Defaults: Claude Sonnet 5.5 for authoring, Gemini 3.8 Flash for fast tasks and advisors, and Gemini 3.1 Flash Image for art. All of them can be changed from the live model list.

## Licenses

The rules content is used under the ORC License (Paizo) and CC-BY-4.0 (Wizards of the Coast SRD). The full notices are in the compendium manifests and are shown under Settings → Rules content & licenses. 3D dice use @3d-dice/dice-box (MIT).
