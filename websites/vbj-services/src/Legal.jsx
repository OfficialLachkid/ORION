import { ArrowLeft } from "lucide-react";

export default function Legal() {
  return (
    <main className="min-h-screen bg-paper text-ink font-body">
      <div className="max-w-3xl mx-auto px-6 py-24">
        <a
          href="#/"
          className="font-mono text-[11px] tracking-[0.22em] uppercase text-muted inline-flex items-center gap-2 hover:text-ink transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </a>
        <h1 className="font-serif italic text-6xl md:text-7xl mt-10 mb-2 tracking-tightest">
          Colophon
        </h1>
        <p className="font-mono text-xs tracking-[0.22em] uppercase text-muted mb-10">
          ╱ Legal · Privacy · Terms · 2026
        </p>

        <section className="mb-14">
          <h2 className="font-serif italic text-3xl mb-4">Privacy</h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p>
              VBJ Services collects only the information you share with us
              directly — a name, email, phone number, or business context you
              type into a form or send via email. We use it to reply to your
              request, prepare a proposal, and (if we work together) deliver
              the engagement.
            </p>
            <p>
              We do not sell or share your data with third parties, except
              where technically required to deliver a service you've asked for
              (e.g., hosting your chatbot, deploying your n8n instance).
            </p>
          </div>
        </section>

        <section className="mb-14">
          <h2 className="font-serif italic text-3xl mb-4">Terms</h2>
          <div className="space-y-4 text-muted leading-relaxed">
            <p>
              Engagements start with a free discovery call. A written proposal
              follows — scope, timeline, price. Nothing binding until both
              parties sign.
            </p>
            <p>
              For hosted infrastructure (n8n, chatbots), monthly costs cover
              server, tunnel, and maintenance. You own the workflows and can
              take them with you.
            </p>
          </div>
        </section>

        <section>
          <h2 className="font-serif italic text-3xl mb-4">Colophon</h2>
          <p className="text-muted leading-relaxed">
            Set in{" "}
            <span className="font-serif italic text-ink">
              Instrument Serif
            </span>
            ,{" "}
            <span className="font-display text-ink">Space Grotesk</span>, and{" "}
            <span className="font-mono text-ink">JetBrains Mono</span>. Built
            with React, Vite, Tailwind and GSAP. Published from the
            orchestrator on the Mac mini.
          </p>
        </section>
      </div>
    </main>
  );
}
