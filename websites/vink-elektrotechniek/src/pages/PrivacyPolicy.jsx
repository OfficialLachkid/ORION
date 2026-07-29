import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function PrivacyPolicy() {
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
          Privacybeleid
        </h1>
        <p className="text-muted mb-8 leading-relaxed">
          Vink Elektrotechniek respecteert uw privacy. Op deze pagina leest u welke
          persoonsgegevens wij verwerken en hoe wij daarmee omgaan.
        </p>

        <div className="space-y-8">
          <section>
            <h2 className="font-display font-bold text-2xl mb-3">Welke gegevens verzamelen wij?</h2>
            <p className="text-muted leading-relaxed">
              Wij verwerken uitsluitend de gegevens die u zelf achterlaat via ons
              contactformulier of tijdens contact per telefoon of email: naam, emailadres,
              telefoonnummer, postcode en de door u meegestuurde inhoud.
            </p>
          </section>

          <section>
            <h2 className="font-display font-bold text-2xl mb-3">Waarvoor gebruiken wij deze gegevens?</h2>
            <p className="text-muted leading-relaxed">
              Uitsluitend om uw aanvraag te behandelen, een offerte uit te brengen,
              de werkzaamheden uit te voeren en voor administratieve afhandeling.
              Wij delen uw gegevens nooit met derden voor marketingdoeleinden.
            </p>
          </section>

          <section>
            <h2 className="font-display font-bold text-2xl mb-3">Bewaartermijn</h2>
            <p className="text-muted leading-relaxed">
              Uw gegevens worden bewaard zolang dit nodig is voor de uitvoering
              van de opdracht en voor wettelijke bewaartermijnen (fiscaal doorgaans
              zeven jaar).
            </p>
          </section>

          <section>
            <h2 className="font-display font-bold text-2xl mb-3">Uw rechten</h2>
            <p className="text-muted leading-relaxed">
              U heeft het recht om uw persoonsgegevens in te zien, te corrigeren of
              te laten verwijderen. Ook kunt u bezwaar maken tegen de verwerking.
              Neem hiervoor contact met ons op via{' '}
              <a href="mailto:info@vink-elektrotechniek.nl" className="text-primary-dark underline">
                info@vink-elektrotechniek.nl
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="font-display font-bold text-2xl mb-3">Contact</h2>
            <p className="text-muted leading-relaxed">
              Vink Elektrotechniek<br />
              Harmoniehof 15, 1507 TX Zaandam<br />
              075 - 77 17 667<br />
              info@vink-elektrotechniek.nl
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
