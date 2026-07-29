import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background text-ink">
      <div className="max-w-3xl mx-auto px-6 sm:px-10 py-16 sm:py-24">
        <Link to="/" className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-primary hover:text-accent-dark transition">
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>

        <h1 className="font-display font-extrabold text-4xl sm:text-6xl tracking-tight mt-8 mb-2">
          Privacy policy
        </h1>
        <p className="font-serif italic text-accent-dark text-xl mb-10">Newman &amp; Partners</p>

        <div className="prose prose-neutral max-w-none space-y-6 text-muted leading-relaxed">
          <p>
            Newman &amp; Partners (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) is committed to protecting the privacy of the candidates, clients and visitors who interact with our services. This policy explains what personal data we collect, how we use it, and the rights you have over it under the EU General Data Protection Regulation (GDPR).
          </p>

          <h2 className="font-display font-bold text-2xl text-ink mt-10">Data we collect</h2>
          <p>
            When you enquire, apply for a role or engage us for a search we collect: name, contact details, current employer and role, CV, correspondence and any additional information you choose to share with us in the course of our work together.
          </p>

          <h2 className="font-display font-bold text-2xl text-ink mt-10">How we use it</h2>
          <p>
            We use your data solely to deliver the recruitment services you have engaged us for — matching candidates to open positions, coordinating interviews, and managing offers. We do not share CVs or candidate information with any third party without your explicit, written consent.
          </p>

          <h2 className="font-display font-bold text-2xl text-ink mt-10">Retention</h2>
          <p>
            Candidate data is retained for as long as it is relevant to your ongoing search or ours. You may request removal from our database at any time by emailing jasper@newmanpartners.nl.
          </p>

          <h2 className="font-display font-bold text-2xl text-ink mt-10">Your rights</h2>
          <p>
            You have the right to access, correct, port or delete your personal data at any time. Please contact us directly to exercise these rights — we will respond within 30 days as required by GDPR.
          </p>

          <h2 className="font-display font-bold text-2xl text-ink mt-10">Contact</h2>
          <p>
            Newman &amp; Partners · IJsbaanpad 2, 1076 CV Amsterdam · jasper@newmanpartners.nl · +31 6 27 51 80 19
          </p>

          <p className="text-sm mt-12">
            Last updated: 2026 · This is a template. Consult a Dutch data-protection lawyer before publishing.
          </p>
        </div>
      </div>
    </div>
  )
}
