import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function Terms() {
  return (
    <div className="min-h-screen bg-background text-ink">
      <div className="max-w-3xl mx-auto px-6 sm:px-10 py-16 sm:py-24">
        <Link to="/" className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-primary hover:text-accent-dark transition">
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>

        <h1 className="font-display font-extrabold text-4xl sm:text-6xl tracking-tight mt-8 mb-2">
          Terms of engagement
        </h1>
        <p className="font-serif italic text-accent-dark text-xl mb-10">Newman &amp; Partners</p>

        <div className="prose prose-neutral max-w-none space-y-6 text-muted leading-relaxed">
          <p>
            These terms govern the use of this website and any services provided by Newman &amp; Partners (KvK-registered in Amsterdam). By using our services you agree to be bound by these terms.
          </p>

          <h2 className="font-display font-bold text-2xl text-ink mt-10">Our services</h2>
          <p>
            Newman &amp; Partners provides executive search, recruitment and career advisory services within finance, audit, tax, legal and notarial disciplines. Full commercial terms for engagement are agreed in writing on a per-brief basis before any search commences.
          </p>

          <h2 className="font-display font-bold text-2xl text-ink mt-10">Fees</h2>
          <p>
            Candidate services are provided free of charge. Client engagement fees are typically success-based and confirmed in advance in a written engagement letter tailored to each search.
          </p>

          <h2 className="font-display font-bold text-2xl text-ink mt-10">Confidentiality</h2>
          <p>
            Both parties agree to treat any non-public information exchanged during a search as strictly confidential. No CV, brief or client information is shared with any third party without explicit written consent.
          </p>

          <h2 className="font-display font-bold text-2xl text-ink mt-10">Website content</h2>
          <p>
            The content of this website is for general information only. All content is © Newman &amp; Partners unless otherwise noted. Testimonials reflect the personal opinion of the individual quoted.
          </p>

          <h2 className="font-display font-bold text-2xl text-ink mt-10">Governing law</h2>
          <p>
            These terms are governed by the laws of the Netherlands. Any disputes shall be subject to the exclusive jurisdiction of the courts of Amsterdam.
          </p>

          <p className="text-sm mt-12">
            Last updated: 2026 · This is a template. Consult a Dutch commercial lawyer before publishing.
          </p>
        </div>
      </div>
    </div>
  )
}
