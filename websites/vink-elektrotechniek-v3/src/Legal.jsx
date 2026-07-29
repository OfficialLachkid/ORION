import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function Legal({ kind }) {
  const isPrivacy = kind === "privacy";
  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="max-w-3xl mx-auto px-6 py-24">
        <Link
          to="/"
          className="mono text-xs tracking-[0.22em] uppercase text-muted inline-flex items-center gap-2 hover:text-ink transition-colors"
        >
          <ArrowLeft size={14} /> Terug
        </Link>
        <h1 className="display text-5xl md:text-6xl mt-10 mb-8 tracking-tightest">
          {isPrivacy ? "Privacyverklaring" : "Algemene voorwaarden"}
        </h1>
        <p className="mono text-xs tracking-[0.22em] uppercase text-muted mb-6">
          ╱ Laatst bijgewerkt · 2026
        </p>
        <div className="space-y-6 text-muted leading-relaxed">
          {isPrivacy ? (
            <>
              <p>
                Vink Elektrotechniek respecteert uw privacy. Persoonlijke
                gegevens die u met ons deelt via het contactformulier of
                telefonisch worden uitsluitend gebruikt om uw opdracht te
                begeleiden, offertes op te stellen en service te verlenen.
              </p>
              <p>
                Wij delen uw gegevens niet met derden, behalve wanneer dit
                wettelijk verplicht is of noodzakelijk voor de uitvoering van
                een dienst (bijvoorbeeld voor levering van materiaal).
              </p>
              <p>
                U heeft altijd het recht uw gegevens in te zien, te corrigeren
                of te laten verwijderen. Neem hiervoor contact op via{" "}
                <a
                  className="text-ink underline decoration-primary/60 underline-offset-4"
                  href="mailto:info@vink-elektrotechniek.nl"
                >
                  info@vink-elektrotechniek.nl
                </a>
                .
              </p>
            </>
          ) : (
            <>
              <p>
                Deze voorwaarden zijn van toepassing op alle diensten van Vink
                Elektrotechniek, gevestigd te Zaandam. Prijzen en offertes zijn
                op maat gemaakt na een persoonlijk gesprek.
              </p>
              <p>
                Werkzaamheden worden uitgevoerd volgens de geldende NEN 1010
                richtlijnen. Op verzoek verstrekken wij een oplevercertificaat
                en documentatie van de installatie.
              </p>
              <p>
                Facturatie geschiedt na oplevering. Bij grotere projecten
                hanteren wij een gefaseerde betaling. Voor volledige voorwaarden
                kunt u contact met ons opnemen.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
