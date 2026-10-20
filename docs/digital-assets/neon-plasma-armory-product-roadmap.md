# Neon Plasma Armory product roadmap

This note preserves the product-specific decisions that should survive beyond one implementation session. It complements the system-level [implementation roadmap](./implementation-roadmap.md).

## Current release

Version `0.3.0` extends the approved weapons and independent firing effects with eight armory items, props, and interactive plasma VFX. The release is built only from the exact expansion manifest approved in Discord. Storefront updates retain the established weapon inventory, independent-effects breakdown, and firing-cycle preview, then append separate expansion inventory and animation visuals.

The storefront cover is a deterministic animated GIF assembled from approved assets. Its first frame is the readable complete weapon inventory for mobile clients and reduced-motion or non-playing contexts. It cycles the weapon, muzzle-flash, projectile, and impact phases before transitioning to dedicated expansion scenes sampled from declared lifecycles. Weapons and non-weapons are not mixed within one cover frame. The presentation uses slow transitions, protected montage layouts, no rapid flashing, and a medium-light desaturated steel-blue background so the dark sprites remain legible. Clean transparent assets are available only in the buyer download.

## Prompt and recipe learning

ORION should improve generation by reusing structured, reviewed recipes rather than pretending that one approved prompt automatically fine-tunes the local model. Preserve these inputs and outcomes for every asset:

- asset type and intended gameplay purpose;
- model and model version;
- prompt template and final prompt;
- seed, canvas, palette, view, anchor, and alpha strategy;
- generated source and deterministic processing version;
- automated validation metrics;
- human approval, rejection, and feedback reasons;
- the final approved manifest and content hashes.

An approved recipe becomes a starting point for the same asset class. A rejected result remains useful negative evidence. Future automation can rank recipes by validation and human-review outcomes, but it must still create a new immutable candidate and pass review.

## Next product additions

Start these only after `0.3.0` is published and verified:

1. Weapon charge effects, because they complete the existing weapon lifecycle most directly.
2. Lightning and plasma effects reusable across weapons, traps, and environments.
3. A sci-fi teleporter or gate with inactive, activation, active-loop, and shutdown states.
4. A sci-fi rift, vortex, or black-hole effect that retains an industrial/plasma identity rather than drifting into the future magic pack.

Characters are a separate pack. Magic is a separate pack.

## Storefront analytics

Add itch.io profile and per-product analytics after the first release cycle. Store dated snapshots for views, downloads, purchases, gross/net revenue where available, price, active sale, release version, and storefront changes. Compare the seven-day 25% sale with equivalent non-sale windows, but treat early results as directional because one short experiment is not statistically reliable. Do not automate permanent or excessively frequent discounts; sale creation and scheduling remain separately approved marketplace actions.
