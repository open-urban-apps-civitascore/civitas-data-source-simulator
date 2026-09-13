import { AppHeader } from "@/components/layout/app-header";
import { PageBody } from "@/components/layout/page-body";
import { GENERATOR_KINDS } from "@/lib/types";
import { requireSession } from "@/lib/server/session";

export default async function DocsPage() {
  await requireSession();
  return (
    <>
      <AppHeader breadcrumb="Was ist das?" />
      <PageBody>
        <div className="max-w-2xl space-y-6 text-sm leading-relaxed">
          <div>
            <h1 className="mb-2">Was ist der Datensimulator?</h1>
            <p>
              Ein Add-on für CIVITAS/CORE, das glaubwürdige Sensordaten erzeugt, damit ein frisch installierter Use Case etwas zeigt
              statt einer leeren Karte. Er sendet die Daten <strong>im eigenen Format des Use Case</strong>, genau wie ein echtes Gerät.
              Ein echter Sensor ist damit ein Drop-in-Ersatz: dasselbe Topic, Simulation löschen, fertig.
            </p>
          </div>
          <div>
            <h2 className="mb-2 text-base">Zwei Wege in die Plattform</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>MQTT-Nachrichten</strong> an einen Broker. Eine Pipeline mit MQTT-Quelle liest sie ab.
              </li>
              <li>
                <strong>SQL-Zeilen</strong> in eine Tabelle, die ein Fachverfahren darstellt. Ein zeitgesteuerter SQL-Job der Pipeline
                liest die ganze Tabelle, deshalb gibt es eine Obergrenze.
              </li>
            </ul>
          </div>
          <div>
            <h2 className="mb-2 text-base">Die Generatoren</h2>
            <dl className="grid gap-2">
              {GENERATOR_KINDS.map((k) => (
                <div key={k.kind} className="grid gap-0.5 rounded-md border px-3 py-2">
                  <dt className="font-medium">
                    {k.label} <span className="font-mono text-xs text-muted-foreground">{k.kind}</span>
                  </dt>
                  <dd className="text-muted-foreground">{k.hint}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h2 className="mb-2 text-base">Was dieser Klickdummy nicht ist</h2>
            <p className="text-muted-foreground">
              Alles hier läuft im Browser mit Mockdaten. Es wird nichts gesendet, nichts gespeichert außer in diesem Browser, und die
              Anmeldung prüft nichts. Der Klickdummy dient dazu, den Funktionsumfang der ersten UI-Version abzustimmen.
            </p>
          </div>
        </div>
      </PageBody>
    </>
  );
}
