import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function Colophon() {
  return (
    <div className="min-h-screen bg-paper text-ink font-serif">
      <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24 py-16 sm:py-24">
        <Link
          to="/"
          className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-muted hover:text-ink transition-colors"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.6} /> Back to the masthead
        </Link>

        <h1 className="mt-10 font-serif font-medium text-[clamp(48px,6vw,88px)] leading-[1.02] tracking-[-0.02em]">
          Colophon
        </h1>
        <p className="mt-4 font-serif italic text-2xl text-muted">
          Privacy, terms, and imprint.
        </p>

        <div className="mt-16 space-y-16 max-w-3xl">
          <section>
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">╱ Privacy</p>
            <h2 className="mt-4 font-serif text-3xl">On the data we hold</h2>
            <p className="mt-4 font-serif text-[17px] leading-[1.65] text-ink/85">
              Newman &amp; Partners is committed to protecting the privacy of the candidates,
              clients and visitors who interact with our services. This section explains
              what personal data we collect, how we use it, and the rights you have over it
              under the EU General Data Protection Regulation (GDPR).
            </p>
            <p className="mt-4 font-serif text-[17px] leading-[1.65] text-ink/85">
              When you enquire, apply for a role, or engage us for a search we collect: name,
              contact details, current employer and role, CV, correspondence, and any additional
              information you choose to share with us in the course of our work together. We use
              your data solely to deliver the recruitment services you have engaged us for. No CV
              or candidate information is ever shared with any third party without your explicit,
              written consent.
            </p>
            <p className="mt-4 font-serif text-[17px] leading-[1.65] text-ink/85">
              Candidate data is retained for as long as it is relevant to your ongoing search or
              ours. You may request removal from our database at any time by emailing
              jasper@newmanpartners.nl.
            </p>
          </section>

          <section>
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">╱ Terms</p>
            <h2 className="mt-4 font-serif text-3xl">Terms of engagement</h2>
            <p className="mt-4 font-serif text-[17px] leading-[1.65] text-ink/85">
              These terms govern the use of this website and any services provided by Newman
              &amp; Partners (KvK-registered in Amsterdam). Candidate services are provided
              free of charge. Client engagement fees are typically success-based and confirmed
              in advance in a written engagement letter tailored to each search.
            </p>
            <p className="mt-4 font-serif text-[17px] leading-[1.65] text-ink/85">
              Both parties agree to treat any non-public information exchanged during a search
              as strictly confidential. These terms are governed by the laws of the Netherlands;
              any disputes shall be subject to the exclusive jurisdiction of the courts of Amsterdam.
            </p>
          </section>

          <section>
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">╱ Imprint</p>
            <h2 className="mt-4 font-serif text-3xl">The masthead</h2>
            <p className="mt-4 font-serif italic text-xl text-muted">
              Set in Instrument Serif · Published in Amsterdam · MMXXVI
            </p>
            <p className="mt-6 font-serif text-[17px] leading-[1.65] text-ink/85">
              Newman &amp; Partners · IJsbaanpad 2, 1076 CV Amsterdam · jasper@newmanpartners.nl · +31 6 27 51 80 19
            </p>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
              This is a template. Consult a Dutch data-protection and commercial lawyer before publishing.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
