import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function Terms() {
  return (
    <div className="min-h-screen bg-background text-ink font-body">
      <div className="max-w-3xl mx-auto px-6 sm:px-10 py-16 sm:py-24">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-mono uppercase tracking-widest text-primary-dark hover:text-ink transition mb-10"
        >
          <ArrowLeft className="h-4 w-4" /> Terug naar home
        </Link>

        <h1 className="font-display font-extrabold text-4xl sm:text-5xl tracking-tight mb-8">
          Algemene voorwaarden
        </h1>
        <p className="text-muted mb-8 leading-relaxed">
          Onderstaand vindt u een korte weergave van onze werkwijze. De volledige
          algemene voorwaarden ontvangt u desgewenst bij uw offerte.
        </p>

        <div className="space-y-8">
          <section>
            <h2 className="font-display font-bold text-2xl mb-3">Offertes</h2>
            <p className="text-muted leading-relaxed">
              Alle offertes zijn vrijblijvend en 30 dagen geldig, tenzij anders
              aangegeven. Prijzen zijn inclusief BTW voor particuliere klanten en
              exclusief BTW voor zakelijke klanten.
            </p>
          </section>

          <section>
            <h2 className="font-display font-bold text-2xl mb-3">Uitvoering</h2>
            <p className="text-muted leading-relaxed">
              Werkzaamheden worden uitgevoerd volgens NEN 1010 en overige geldende
              normen. Meer- of minderwerk wordt vooraf schriftelijk afgestemd.
            </p>
          </section>

          <section>
            <h2 className="font-display font-bold text-2xl mb-3">Garantie</h2>
            <p className="text-muted leading-relaxed">
              Op geleverd werk geven wij één jaar garantie op de installatie,
              en op geleverde materialen de fabrieksgarantie.
            </p>
          </section>

          <section>
            <h2 className="font-display font-bold text-2xl mb-3">Betaling</h2>
            <p className="text-muted leading-relaxed">
              Facturen dienen binnen 14 dagen na factuurdatum voldaan te zijn,
              tenzij anders overeengekomen.
            </p>
          </section>

          <section>
            <h2 className="font-display font-bold text-2xl mb-3">Storingsdienst</h2>
            <p className="text-muted leading-relaxed">
              Voor spoedgevallen zijn wij dag en nacht bereikbaar via{' '}
              <a href="tel:0622865768" className="text-primary-dark underline">
                06 - 22 86 57 68
              </a>
              . Buiten kantooruren geldt een toeslag.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
