import { spawn } from 'node:child_process';
import { projectRoot } from '../../lib/runtime-config.mjs';

// Qualification is a judgment task, deliberately NOT run on the local
// Ollama model — every judgment-shaped task this pipeline tried on the
// 8B model (directory detection, KvK sanity, niche matching) needed a
// deterministic backstop. Drafting outreach under the operator's name is
// the highest-judgment step in the pipeline, so it runs on Claude via the
// existing Claude Code subscription (claude -p), volume is a handful of
// leads per run, and every draft stays approval-gated in Discord.
// 300s (was 240s) — the playwright-cli screenshot step (2026-07-22) adds a
// real browser launch+navigate+render round-trip on top of WebFetch; 2/10
// leads already hit the old 240s ceiling before this step existed.
const CLAUDE_TIMEOUT_MS = 300000;

const PRODUCT_CONTEXT = `VBJ Services sells to Dutch small/local businesses. Offer priority (operator's explicit ordering — websites require the least delivery work on VBJ's side, so they are the PREFERRED lead offer):
1. Website builder (PREFERRED lead offer) — modern template-based websites for businesses with weak, dated, slow, or defective sites.
2. Website chatbot (ready to sell) — embedded site chatbot, FAQ/support automation, product guidance.
3. n8n workflow automation (sellable with setup work) — self-hosted automation for repetitive processes.
4. Voice receptionist (later-stage/upsell only) — Dutch voice AI answering calls; never the lead offer.
Even when website_builder is the chosen angle, still note in secondary_flags if a chatbot or automation need is visible — those become upsells later.`;

const QUALIFICATION_RULES = `Qualification rules (from the operator's playbook):
- Lead generation is a qualification function: reject weak fits early rather than pass noise to outreach.
- Strong fit signals: weak/dated/slow website, visible site defects, repetitive customer question flows, booking/support/product-guidance needs, limited after-hours response, visible friction that can be named concretely in outreach.
- When judging website_builder fit, name CONCRETE observable defects where you can: dated design, stale content (e.g. an old copyright year or long-untouched news section), missing/thin mobile experience, broken layout, missing HTTPS, thin/generic copy. Only claim what you actually observed — never invent a defect. (Note: WebFetch gives you the site as text/markdown, not a rendering — text alone cannot support a claim about visual polish, animations, layout modernity, or parallax/scroll effects. If you completed the screenshot step below and actually viewed the image, you MAY make real visual-design claims grounded in what you saw in that image. If the screenshot step failed, timed out, or you skipped it, you still cannot invent a visual judgment from text alone — stick to structural/content signals instead.)
- Page speed (LCP) is a SECONDARY signal, not the primary reason to qualify or reject a website_builder fit — a slow load matters, but a 5-10s LCP alone does not make a strong case on its own, and a fast LCP does not rule out a real fit if the site is otherwise dated or thin. Weigh it alongside the other observable defects above; never lead the reasoning or draft with the LCP number as if it were the main argument.
- AI-GENERATED / low-effort "template slop" sites are a STRONG website_builder fit signal — a business that put up a quick AI-generated or generic-template site cheaply is precisely the kind that would benefit from a real, professional, custom site. Tells (assess from both the screenshot AND the fetched text; needs 2+ corroborating signals, not just one, since any single one occurs on legitimate sites too): generic/uncanny AI hero imagery (too-perfect stock-like "worker holding a tool" shots, slightly-off hands/tools/faces, characterless polish); arrow-heavy structural copy (literal "→" in headings/bullets, e.g. "Probleem → Oplossing", a ChatGPT-structure tell); fluent-but-characterless filler with no specific local/personal detail; inconsistent invented details (a founder name appearing once then never again, mismatched claims). Record what you saw in "ai_site_signals". This is an INTERNAL prioritization signal only — it does NOT change the mandatory respectful tone below: the outreach email must reference the observable SYMPTOM respectfully ("een moderne site met eigen fotografie oogt persoonlijker/betrouwbaarder"), and must NEVER say or imply the current site is "AI-generated", "slop", "fake", or "cheap". Never insult their existing site; frame purely as opportunity.
- Weak fit signals: no clear relevance to the offers, huge corporates/chains with in-house teams (e.g. international agencies, national franchises with professional web presences), speculative fit with no visible evidence, no way to personalize outreach with something real.
- The draft must be specific and commercially grounded — name something real observed on their site. Generic "we help businesses grow" messaging is explicitly against the playbook.
- Write in the BUSINESS OWNER's language, not a web developer's. The recipient is a plumber/electrician/shop owner, not a designer — they care about customers, being found, and looking trustworthy, NOT about web jargon. Do NOT use technical terms like "static banner image", "hero section", "LCP", "parallax", "responsive breakpoints", "CTA". Translate the observation into a plain business benefit: instead of "your homepage uses a static banner image with underlined menu links", say something like "uw site oogt wat verouderd" or "een frisse, moderne uitstraling wekt meer vertrouwen bij nieuwe klanten". Name the real thing you saw, but phrase it as what it means for THEIR business, in words they'd use themselves.
- Tone is MANDATORY: courteous and professional at all times. Never disparage or mock their current site — frame observations as opportunity, respectfully. This is non-negotiable in every draft and every future contact.
- Make the observation SPECIFIC enough that it's clear you actually looked closely — reference a concrete detail unique to their site, not a generic remark that could apply to anyone. And frame the gap as a REAL, concrete disadvantage for their business, not a vague soft "would be nicer": e.g. a potential customer who can't quickly see who they are and picks a competitor who looks more established/trustworthy, or a site that undersells genuine craftsmanship/experience they clearly have. It should read as "we noticed something real that's costing you", not "your site could be a bit nicer" — while STILL staying respectful and never insulting. When the site is generic/template/AI-generated (see ai_site_signals), lean into showing you noticed the impersonal, interchangeable feel — the goal is to make them think "they clearly actually looked at MY site and see what's missing", without ever using the words "AI", "template", "slop", or "generic" about their site.
- THE OFFER / CALL-TO-ACTION is a FREE, no-obligation website design: VBJ makes them a free design/mockup of a new website, they look at it, and ONLY if they like it do we build it out further, fully to their wishes. This is the standard close — do NOT ask "shall we call?" or "are you open to a chat?" as the main ask. Instead offer the free design and invite a low-friction yes: e.g. "We maken graag — geheel vrijblijvend en kosteloos — een voorbeeldontwerp voor uw nieuwe website. Als het u bevalt, werken we het volledig naar uw wensen verder uit. Zullen we dat voor u maken?" Phrase it naturally per lead, but the essence is always: free design first, no obligation, only proceed if they like it. This lowers the barrier — they risk nothing to see what's possible.
- Email drafts are in Dutch, SHORT (under 100 words, 4-7 short sentences) — the recipient should be able to read the whole thing in well under 30 seconds. Lead with the one concrete observation, then the free-design offer, then the low-friction ask. No false claims, no fake urgency, sign off as "VBJ Services". Sending stays approval-gated; you only draft.`;

// Google PageSpeed Insights (keyless anonymous quota is plenty at a few
// leads per batch). A slow site is itself a sales signal for the
// website-builder offer — the operator's insight: "a website that needs to
// load quite long is also worth it to sell a website to."
const PSI_TIMEOUT_MS = 60000;
const FETCH_TIMING_TIMEOUT_MS = 30000;

async function measureWithLighthouse(url, apiKey, strategy) {
  const psiUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  psiUrl.searchParams.set('url', url);
  psiUrl.searchParams.set('strategy', strategy);
  psiUrl.searchParams.set('category', 'performance');
  // Keyless PSI shares an anonymous quota pool that's often exhausted —
  // a free key (25k/day) makes this reliable: PAGESPEED_API_KEY in
  // config/discord/.env (the runtime env file loadRuntimeConfig reads).
  if (apiKey) {
    psiUrl.searchParams.set('key', apiKey);
  }

  const response = await fetch(psiUrl, { signal: AbortSignal.timeout(PSI_TIMEOUT_MS) });
  if (!response.ok) {
    return null;
  }

  const body = await response.json();
  const lcpMs = body?.lighthouseResult?.audits?.['largest-contentful-paint']?.numericValue;
  const score = body?.lighthouseResult?.categories?.performance?.score;
  if (!Number.isFinite(lcpMs)) {
    return null;
  }

  return {
    lcp_seconds: Math.round(lcpMs / 100) / 10,
    performance_score: Number.isFinite(score) ? Math.round(score * 100) : null,
  };
}

// Fallback when Lighthouse is unavailable: time the raw HTML fetch. Not
// LCP (no rendering, no assets), but "the HTML alone took 4s" is still an
// honest, nameable slowness signal — labeled as such so the prompt and the
// stored data never pass it off as a real LCP.
async function measureWithFetchTiming(url) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMING_TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  });
  const ttfbMs = Date.now() - startedAt;
  await response.text();
  const totalMs = Date.now() - startedAt;

  return {
    method: 'fetch_timing',
    ttfb_seconds: Math.round(ttfbMs / 100) / 10,
    html_seconds: Math.round(totalMs / 100) / 10,
  };
}

// Lighthouse's mobile strategy runs under Google's standardized throttled
// mobile profile (simulated mid-tier device + slow 4G) — deliberately
// pessimistic to model a real worst-case mobile visitor, not "how fast does
// this feel on a real phone with WiFi." Desktop runs unthrottled. A large
// gap between the two (operator found one 10.1s mobile vs. 2.2s desktop) is
// expected methodology, not a sign either number is wrong — both get passed
// to the qualifier so it isn't drawing a conclusion from mobile alone.
export async function measurePageSpeed(url, apiKey = process.env.PAGESPEED_API_KEY) {
  let mobile = null;
  let desktop = null;

  try {
    mobile = await measureWithLighthouse(url, apiKey, 'mobile');
  } catch {
    // fall through to timing fallback below
  }

  if (mobile) {
    try {
      desktop = await measureWithLighthouse(url, apiKey, 'desktop');
    } catch {
      // desktop is a bonus data point — mobile alone is still usable
    }

    return {
      method: 'lighthouse',
      lcp_seconds: mobile.lcp_seconds,
      performance_score: mobile.performance_score,
      desktop_lcp_seconds: desktop?.lcp_seconds ?? null,
      desktop_performance_score: desktop?.performance_score ?? null,
    };
  }

  try {
    return await measureWithFetchTiming(url);
  } catch {
    return null; // measurement is a bonus signal, never a blocker
  }
}

// screenshotSessionName scopes the playwright-cli browser session to this
// one qualification call (`-s=<name>`) — qualifyLead() force-closes that
// exact session after the call regardless of outcome, so a slow/failed
// screenshot attempt can never leak an orphaned Chromium process across a
// batch run the way an un-cleaned session could on a shared 16GB machine.
export function buildQualificationPrompt(lead, pageSpeed = null, renderedSiteText = null, screenshotSessionName = null, operatorFeedback = null) {
  let pageSpeedNote = '';
  if (pageSpeed?.method === 'lighthouse') {
    const desktopPart = Number.isFinite(pageSpeed.desktop_lcp_seconds)
      ? ` Desktop (unthrottled): LCP ${pageSpeed.desktop_lcp_seconds}s, score ${pageSpeed.desktop_performance_score ?? 'n/a'}/100.`
      : '';
    pageSpeedNote = `\nMEASURED PAGE PERFORMANCE (Google Lighthouse). Mobile (throttled to a simulated slow connection/device — deliberately pessimistic, not real-world mobile speed): LCP ${pageSpeed.lcp_seconds}s, performance score ${pageSpeed.performance_score ?? 'n/a'}/100.${desktopPart} A large mobile-vs-desktop gap is expected methodology, not a data error — do not treat the mobile number alone as decisive. Speed is ONE input among several, not the primary driver of website_builder fit — weigh it alongside the other observable defects below, and note explicitly if mobile and desktop tell different stories rather than picking whichever number is more dramatic.\n`;
  } else if (pageSpeed?.method === 'fetch_timing') {
    pageSpeedNote = `\nMEASURED PAGE TIMING (raw HTML fetch, not a full Lighthouse LCP): time-to-first-byte ${pageSpeed.ttfb_seconds}s, full HTML in ${pageSpeed.html_seconds}s. Only treat this as a slowness signal if clearly bad (several seconds); do not present it as an LCP measurement.\n`;
  }

  if (renderedSiteText) {
    pageSpeedNote += `\nRENDERED SITE TEXT (the site blocks plain fetches, so our headless browser rendered it — treat this as the site content; WebFetch will likely 403):\n---\n${renderedSiteText}\n---\n`;
  }

  return buildQualificationPromptBody(lead, pageSpeedNote, screenshotSessionName, operatorFeedback);
}

function buildQualificationPromptBody(lead, pageSpeedNote, screenshotSessionName, operatorFeedback) {
  const feedbackNote = operatorFeedback
    ? `\nOPERATOR FEEDBACK ON A PRIOR DRAFT FOR THIS LEAD (the human reviewer rejected the previous draft and left this note — treat it as authoritative, incorporate it into the new draft, and verify it yourself where you can):\n"${operatorFeedback}"\n`
    : '';
  const screenshotStep = screenshotSessionName ? `2. Take ONE screenshot for a real visual read, bounded effort — this step is a bonus signal, not a blocker: run \`playwright-cli -s=${screenshotSessionName} open ${lead.source_url}\`, then \`playwright-cli -s=${screenshotSessionName} screenshot --filename=/tmp/${screenshotSessionName}.png\`, then read that file with the Read tool to actually view the rendered page. If any of these fail, time out, or the page won't load, stop trying after one attempt and proceed with text-only judgment — do not retry, do not treat this as a reason to reject the lead. If you do view the screenshot, you may now make real visual-design claims (modern vs. dated look, animations/effects if visible in the static image, layout quality) grounded in what you actually saw — set "screenshot_reviewed": true in your response. If you skipped or it failed, set "screenshot_reviewed": false and do not claim any visual judgment beyond what the text/structure supports.\n` : '';

  return `You are the lead-qualification step of VBJ Services' sales pipeline.

${PRODUCT_CONTEXT}

${QUALIFICATION_RULES}

THE LEAD (extracted from public web data by a local pipeline; fields may be imperfect):
${JSON.stringify({
    business_name: lead.business_name,
    business_type: lead.business_type,
    services: lead.services,
    website: lead.source_url,
    niche: lead.niche,
    contact_email: lead.contact_email,
    contact_phone: lead.contact_phone,
    kvk_number: lead.kvk_number,
    social_links: lead.social_links,
  }, null, 2)}
${pageSpeedNote}${feedbackNote}
TASK:
1. Fetch ${lead.source_url} with WebFetch and judge the actual website: does the business look like a fit for one of the offers, and is there something concrete and real to personalize outreach with? Also sanity-check the extraction: if the page is actually a directory/platform/association rather than this business's own site, reject with decision "extraction_error".
${screenshotStep}3. FIND A PUBLIC CONTACT EMAIL${lead.contact_email ? ` (we already have "${lead.contact_email}" — only correct it if the site clearly shows a better/more official one, otherwise return it unchanged)` : ' — IMPORTANT: our extraction found NONE, but it is often simply missed'}. Look at the page you fetched AND the screenshot; if no email is visible on the homepage, try the contact/over-ons page (e.g. WebFetch ${String(lead.source_url || '').replace(/[/]+$/u, '')}/contact). Return it in "contact_email". Rules: it must be an address actually shown on THEIR site (never invent one, never guess "info@<domain>" without seeing it); prefer a general business address (info@/contact@) over a personal one; if a contact FORM is the only option and no address is shown anywhere, return null. Getting this right matters: a qualified lead with no email is dropped from outreach entirely.
4. Decide: "qualified", "rejected", "extraction_error", or "unverifiable".
   Use "unverifiable" when you could not fetch the site at all (403/blocked/timeout) — do NOT reject a possibly-good lead just because our fetch was blocked; that's a retry case, not a verdict on the business.
5. If qualified, pick ONE primary offer angle and write the Dutch outreach email.

Respond with ONLY a JSON object, no markdown fences, no commentary:
{
  "decision": "qualified" | "rejected" | "extraction_error" | "unverifiable",
  "confidence": 0.0-1.0,
  "offer_angle": "website_builder" | "website_chatbot" | "n8n_automation" | null,
  "secondary_flags": ["website_chatbot" | "n8n_automation" | "website_builder", ...] or [],
  "reasoning": "2-4 sentences: why this decision, referencing what you saw on the site",
  "personalization_hook": "the concrete observed detail the draft is built around, or null",
  "contact_email": "a public email actually shown on their site, or null if genuinely none is displayed",
  "ai_site_signals": "short note on AI-generated/template-slop tells you observed (2+ corroborating), or null if none/not applicable",
  "draft_subject": "Dutch subject line, or null",
  "draft_body": "Dutch email body, or null"${screenshotSessionName ? ',\n  "screenshot_reviewed": true | false' : ''}
}`;
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`No JSON object in Claude output: ${trimmed.slice(0, 200)}`);
  }

  return JSON.parse(trimmed.slice(start, end + 1));
}

// Force-closes a playwright-cli session regardless of how the qualifyLead
// call ended (clean success, JSON parse failure, non-zero exit, or a
// SIGKILL on timeout) — a session Claude opened but never closed itself
// (most likely exactly on the timeout/SIGKILL path, since Claude never gets
// a chance to run its own `close` step) would otherwise leave an orphaned
// Chromium process running indefinitely on a shared 16GB machine. Fire-
// and-forget: closing a session that was never opened is a harmless no-op,
// not worth blocking or failing the qualification result over.
function closePlaywrightSession(sessionName) {
  if (!sessionName) {
    return;
  }

  try {
    spawn('playwright-cli', ['-s', sessionName, 'close'], {
      stdio: 'ignore',
      detached: true,
    }).unref();
  } catch {
    // best-effort cleanup only
  }
}

export function qualifyLead(lead, config, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const command = config?.env?.CLAUDE_COMMAND || 'claude';
    const model = options.model || config?.env?.CLAUDE_MODEL || 'sonnet';
    const enableScreenshot = options.enableScreenshot !== false;
    // Short, filesystem/CLI-safe token — lead.id is a UUID (safe as-is) but
    // don't depend on that always being true for every caller.
    const screenshotSessionName = enableScreenshot
      ? `qualifier-${String(lead.id || '').replace(/[^a-zA-Z0-9-]/gu, '').slice(0, 24) || Date.now().toString(36)}`
      : null;

    const args = [
      '-p',
      buildQualificationPrompt(lead, options.pageSpeed || null, options.renderedSiteText || null, screenshotSessionName, options.operatorFeedback || null),
      '--model', model,
      '--allowedTools', screenshotSessionName ? `WebFetch,Bash(playwright-cli *),Read` : 'WebFetch',
    ];

    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      closePlaywrightSession(screenshotSessionName);
      rejectPromise(new Error(`Qualification timed out after ${CLAUDE_TIMEOUT_MS / 1000}s.`));
    }, CLAUDE_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      closePlaywrightSession(screenshotSessionName);
      rejectPromise(new Error(`Could not start claude: ${error.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      closePlaywrightSession(screenshotSessionName);
      if (code !== 0) {
        rejectPromise(new Error(stderr.trim() || `claude exited with code ${code}.`));
        return;
      }

      try {
        const parsed = extractJson(stdout);
        if (!['qualified', 'rejected', 'extraction_error', 'unverifiable'].includes(parsed.decision)) {
          throw new Error(`Unexpected decision '${parsed.decision}'.`);
        }
        resolvePromise(parsed);
      } catch (error) {
        rejectPromise(new Error(`Could not parse qualification output: ${error.message}`));
      }
    });
  });
}
