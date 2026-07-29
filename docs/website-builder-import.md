# Website Builder Import

## Purpose

This module brings the local-first Website Builder path into `ruflo` without depending on Domits PMS data or the existing property-bound backend contract.

## Current shape

The imported `ruflo` app is intentionally:

- local-first
- browser-storage backed
- template-driven
- preview-oriented
- not published
- not domain-aware

It does **not** claim that a real website record, custom domain, or live booking funnel exists yet.

## Source material

The current implementation was shaped from the Domits Website Builder contract and source references:

- `docs/internal/context/domits_vault/03_Capabilities/Direct_Booking_Website.md`
- `docs/internal/context/domits_vault/02_Codex_Context/Direct_Booking_Website_Current_Task.md`
- `docs/internal/apis/directbookingwebsite/direct_booking_website_handoff.md`
- `docs/internal/apis/directbookingwebsite/direct_booking_website_frontend_status.md`
- `frontend/web/src/features/hostdashboard/website/websiteTemplates.js`
- `frontend/web/src/features/hostdashboard/website/websiteEditorConfig.js`
- `frontend/web/src/features/hostdashboard/website/rendering/WebsiteTemplatePreview.jsx`
- `frontend/web/src/features/hostdashboard/website/rendering/templateRegistry.js`
- `frontend/web/src/features/hostdashboard/website/rendering/websiteDraftContentOverrides.js`

## What is in `ruflo` now

- dedicated Website Builder app under `apps/website-builder`
- isolated static dev server via `npm run website-builder:dev`
- local-first design library and website workspace persistence in browser `localStorage`
- draft JSON export/import
- shared template socket through a registry that selects:
  - template metadata
  - template seed
  - template editor sections
  - template renderer
- Panorama Landing refactored into `src/templates/panorama`
- Trust Signals imported as the second real template with its own preview/editor flow
- shared builder config split away from template-local editor config
- overview workspace with:
  - reusable design library
  - saved websites
  - builder tab
- automatic starter-design seeding from imported templates so the Build flow always has real reusable candidates
- full-page preview route via `preview.html`
- editor-first local draft flow without the earlier setup overlay
- hero text alignment control for Panorama
- section-level visibility controls inside their corresponding editor sections
- preview-to-editor and editor-to-preview navigation targeting
- preview scroll-reveal motion closer to the Domits experience

## Template architecture

The builder now treats each template as a module that plugs into a shared base structure:

- `src/template-registry.js` is the socket layer
- `src/templates/<template-id>/seed.js` owns mock data for that template
- `src/templates/<template-id>/editor-config.js` owns template-specific editor sections
- `src/templates/<template-id>/render.js` owns preview markup/behavior
- `src/templates/shared/*` holds shared field factories and shared builder helpers

This is the shape future templates should follow. A new template should not be added as a placeholder card or a generic render variant. It should only enter the registry once it brings over:

- its real preview structure
- its real editor coverage
- its own seed/config module
- working preview/editor targeting

## Product direction

The builder should not only store finished websites. It should store two different layers of output:

- reusable website designs
  - mock-data presets
  - built to be reused later by Claude Design before generating a completely new concept
  - useful when multiple strong candidate designs should be shown to a business first
- company-specific websites
  - actual working drafts for a specific business
  - should swap mock content for real company information
  - can start from a reusable design instead of from zero

This split reduces token waste because Claude can iterate through already-approved design candidates before spending tokens on a brand-new website direction.

## Current local model

The current local-first workspace now behaves like this:

- `Design library`
  - reusable design presets with mock content
  - saved by template
  - previewable and editable
  - can be turned into a website draft
- `My websites`
  - company-specific website drafts
  - can reference a source design
  - previewable and editable
- `Builder`
  - current working session
  - currently saves websites through the editor flow
  - reusable starter designs are auto-seeded from imported templates

## Persistence shape now

The builder now uses a split model:

- current working session
  - still stored in browser local storage for fast local editing
- design library and saved websites
  - loaded through the local Website Builder API
  - persisted to Supabase when `config/supabase/.env` is configured on the runtime host
  - kept in browser local storage as a cache/fallback only

This keeps Supabase keys server-side while making reusable designs and saved websites portable across browser sessions and devices on the configured host.

## Persistence next step

The next persistence step should be Supabase, but not as a raw browser mirror. The right shape is:

- `website_designs`
  - reusable design presets
  - template id
  - title
  - summary
  - mock-data draft payload
- `websites`
  - company-specific drafts
  - optional source design id
  - company metadata
  - website draft payload
- later optionally `website_revisions`
  - if revision history or rollback becomes important

The current implementation now targets those tables through the local Website Builder API. If Supabase is not configured on the runtime host, the browser cache stays as the temporary fallback adapter.

## What is intentionally excluded for now

- property import from Domits PMS
- property-bound backend draft persistence
- published live-site lifecycle
- fallback-domain behavior
- analytics ingestion
- guest checkout, quote, booking, and confirmation

## Next product step

When Supabase persistence is ready, this app should swap its storage adapter first instead of growing more logic on top of browser-local storage. Additional website templates can come back later, but only after each one is imported with its real editor and preview behavior instead of placeholder variants.
