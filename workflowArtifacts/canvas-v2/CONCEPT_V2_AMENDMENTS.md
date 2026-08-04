# CONCEPT_V2 — AMENDMENTS.md
## Verbindliche Konzeptänderungen (Amendment-Set A)

> **Zweck.** Dieses File enthält ausschließlich die **konzeptuellen** Änderungen
> an `CONCEPT_V2.md`, konsolidiert aus dem Development-Report (Amendments 1–9,
> soweit angenommen) und der Review (Funde A1–A6, B1–B9, C5). Keine WPs, keine
> Prozess- oder Implementierungsaufgaben — nur das, was am Konzept selbst
> geändert werden muss. Jedes Amendment nennt Ziel-Teil, Aktion
> (ERSETZEN / ERGÄNZEN / STREICHEN / NEU) und den normativen Text.
>
> **Konvention:** Bei Widerspruch zwischen `CONCEPT_V2.md` und diesem File gilt
> dieses File. Reihenfolge = Konsequenz, nicht Teil-Nummer.

---

## Übersicht

| Ä# | Teil | Aktion | Gegenstand | Quelle | Schwere |
|---|---|---|---|---|---|
| Ä1 | 4, 11 | ERSETZEN | Endpoint-Optionalität + Totalitätsregel | Report-A1/Am.1 | kritisch |
| Ä2 | 3 | NEU | Invariante I11 (Generalform) | Report-Am.2 | kritisch |
| Ä3 | 11 | ERSETZEN | Seed/Import: Pass-through statt Abweisung; Refusal-Klassen; Teardown | Review-A1/C5, Report-Am.2 | kritisch |
| Ä4 | 4 | ERGÄNZEN | Dual-Vocabulary-Periode + Präzedenzregel | Report-Am.6, Review-A3 | hoch |
| Ä5 | 12, 13 | ERGÄNZEN | schemaVersion-Gate vor P1-Exposition | Review-A3 | hoch |
| Ä6 | 7 | ERSETZEN | Tombstone-GC ≡ Epoch-Bump | Report-Am.8, Review-A2 | hoch |
| Ä7 | 7 | ERGÄNZEN | Kopplung Relay-Persistenz × Epoch × Rotation | Review-A5 | hoch |
| Ä8 | 7 | ERGÄNZEN | Adoption-blocked als benannter Zustand | Review-A4 | mittel |
| Ä9 | 7 | ERSETZEN | Sidecar-Exklusion auf vier Flächen | Report-Am.7 | mittel |
| Ä10 | 9, 13 | ERGÄNZEN | Lock-Seam: Phasenzuweisung + Interim-Regel | Review-B1 | hoch |
| Ä11 | 14 | ERSETZEN | Rig-Prämisse korrigieren | Report-Am.3 | kritisch |
| Ä12 | 14 | ERGÄNZEN | Intent-Trace-Orakel + Referenzmodellpflicht | Report-Am.4, Review-B9 | hoch |
| Ä13 | 14 | ERGÄNZEN | Gate-Pfadpflicht + Chaos-Suiten + Pfad-Evidenz | Report-Am.9, Review-B3/C6 | hoch |
| Ä14 | 13, 14 | ERGÄNZEN | Release- vs. Phase-Closure-Bedingung | Report-Am.5 | hoch |
| Ä15 | 11, VI | NEU | Fail-closed-Defaults + Config-Dir-Deny-List | Review-B6 | kritisch |
| Ä16 | 14 | ERGÄNZEN | Mutationstest-Metrik | Review-Z7 | mittel |
| Ä17 | 4, 5 | ERGÄNZEN | Clearing ist Intent — Capture-Vollständigkeit | Review-A6 | mittel |

---

## Ä1 — Endpoint-Optionalität und Totalitätsregel *(Teil 4 + Teil 11, ERSETZEN)*

**Teil 4, Edge-Zeilen der Feldtabelle, ersetzen durch:**

> `from` = `{node, side?, end?}` und `to` = `{node, side?, end?}` — je ein
> atomares LWW-Register. **`side` und `end` sind optional** (JSON Canvas
> definiert sie optional; Obsidian wählt fehlende Seiten selbst).
> **`node` allein entscheidet über die Existenz des Registers.**

**Teil 11, Validitätsregel, ersetzen durch:**

> `Edge gültig ⇔ id ∧ from.node ∧ to.node` — und sonst nichts.
> `Node gültig ⇔ id ∧ type ∧ pos ∧ size ∧ typspezifisch exakt nach
> JSON-Canvas-Spezifikation` — insbesondere: `"text": ""` ist eine **legale
> leere Karte** (Präsenz zählt, nicht Nicht-Leere).

**Neuer normativer Satz in beiden Teilen (die Totalitätsregel):**

> **TOTALITÄT.** Das Datenmodell MUSS jedes legale JSON-Canvas-Dokument
> verlustfrei repräsentieren können. Eine Repräsentationslücke ist ein
> Modellfehler und wird als solcher behoben — niemals durch Abweisung des
> Records, denn eine Abweisung wird an der nächsten destruktiven Grenze zur
> Löschung. Die Validitätsregeln des Konzepts dürfen nie strenger sein als
> die JSON-Canvas-Spezifikation; jede zusätzliche Einschränkung braucht einen
> expliziten, benannten Grund.

---

## Ä2 — Invariante I11 *(Teil 3, NEU — in die Invariantenliste nach I10)*

> ```text
> I11 REFUSAL NEVER DESTROYS   Ein Record, den das System an irgendeiner
>                              Grenze nicht aufnimmt, darf als Folge dieser
>                              Nicht-Aufnahme niemals aus der Datei des
>                              Nutzers entfernt werden.
> ```
>
> Generalform als Designregel: **Eine Validitätsgrenze und ein destruktiver
> Write dürfen nie komponieren, ohne dass explizit entschieden ist, was
> zwischen ihnen passiert.** Jeder Schritt der E2-Kaskade war einzeln korrekt;
> die Komposition war es nicht — I11 ist die Invariante, die diese Komposition
> verbietet.

---

## Ä3 — Seed/Import: Pass-through statt Abweisung *(Teil 11, ERSETZEN)*

**Der Satz „Ungültige Records aus lokalen Quellen werden abgewiesen" wird für
die Grenzen Seed und Import ERSETZT** (nicht ergänzt — die alte Anweisung war
die Ursache des E2-Datenverlusts). Er bleibt gültig für CAPTURE_OP und
CAPTURE_NET (dort kann eine Abweisung nichts zerstören: Datei und Doc bleiben
unverändert; siehe Ä10 für die Shadow-Interaktion).

**Neuer normativer Text (Seed/Import-Grenze):**

> ```text
> TOTALITÄT     (Ä1) deckt den Normalfall: Legale Records sind immer
>               repräsentierbar, es gibt nichts abzuweisen.
> PASS-THROUGH  Ein Record, den Ingest dennoch nicht aufnimmt, wird bei jeder
>               Serialisierung VERBATIM aus der letzten bekannten Dateifassung
>               re-injiziert (per id, positionsstabil). Die Datei bleibt
>               vollständig; der Rest der Datei bleibt live. Es gibt keinen
>               Zustand, in dem der Writer die Datei als Ganzes zurückhält.
> RECOVERY      Records, die auch Obsidians importData still droppen würde
>               (id-los, type-los, file-Node ohne file), werden zusätzlich in
>               ein lokales Recovery-Journal kopiert
>               (.obsidian/liveshare/recovery/<guid>.jsonl), BEVOR irgendein
>               Writer — unserer oder Obsidians — sie verlieren kann. Nur das
>               hält gegen Obsidians eigenen requestSave.
> KLASSEN       Jede Refusal ist klassifiziert:
>               (a) representable-später — hebt sich automatisch, sobald das
>                   Modell den Record aufnehmen kann (Signaturpaar
>                   SEED REFUSED: / SEED RESTORED: bleibt);
>               (b) nie-gültig — Pass-through + Recovery dauerhaft; kein
>                   Zustand wartet auf ein Lifting, das nie kommt.
> TEARDOWN      Session-Ende mit aktiven Pass-throughs ist wohldefiniert: der
>               letzte Flush enthält sie wie jeder andere; das Journal bleibt.
> ```

Die im Build vorhandene Withhold-Mechanik (globales Zurückhalten des
`.canvas`-Write-backs) ist damit konzeptuell **ersetzt**: Sie negiert den
Existenzgrund des Writers, hat keinen Teardown-Pfad und schützt bei offenem
View nicht (Obsidian schreibt selbst).

---

## Ä4 — Dual-Vocabulary-Periode und Präzedenzregel *(Teil 4, ERGÄNZEN)*

**Neuer Abschnitt „Migrationsvokabular":**

> Während P1 hält ein Doc legitim **beide** Vokabulare (Flat-Keys `x/y/…` und
> Register `pos/size/from/to`). Die Kollisionsauflösung MUSS
> ordnungsunabhängig sein — Container-Zufälle (`Y.Map`-Insertion-Order) sind
> als Entscheidungsgrundlage verboten. Zulässig sind genau zwei Formen, und
> das Konzept legt sich auf die erste fest:
>
> 1. **Migration als Edit (normativ):** Der erste V2-Write auf einen Record
>    löscht dessen Flat-Keys *in derselben Transaktion*. Danach ist
>    „Register-wenn-vorhanden" trivial korrekt, weil Koexistenz transient ist.
> 2. *(Fallback, falls 1 nicht umsetzbar):* Vergleich der kausalen Stempel
>    (Yjs-Item-IDs `(client, clock)`) der jeweils gewinnenden Writes beider
>    Vokabulare — „das kausal jüngere gewinnt", nie „das zufällig letzte".
>
> „Irgendein deterministisches Ergebnis" erfüllt diese Regel NICHT; gefordert
> ist Determinismus **aus Kausalität**.

---

## Ä5 — schemaVersion-Gate vor P1-Exposition *(Teil 12 + Teil 13, ERGÄNZEN)*

**Teil 12 (Mixed-Version-Zeile) ergänzen:**

> Die Schutzregel „fremde Major-Version → Receive-and-Persist" ist erst mit P3
> wirksam. **Bis dahin gilt als Minimalschutz verpflichtend:** Ein Client
> verweigert die Teilnahme an einem Canvas-Doc mit fremder
> `meta.schemaVersion` (Notice, kein Sync dieses Docs). Ein V1-Client, der
> Flat-Keys konkurrierend zu Register-Writes schreibt, ist stiller
> Intent-Verlust einer ganzen Teilnehmerklasse und durch keinen Headless-Test
> sichtbar.

**Teil 13 (Phasenplan) ergänzen:**

> P1 gilt erst als exponierbar (real einsetzbar), wenn das
> schemaVersion-Gate — als vorgezogenes Subset von P3 — aktiv ist. Die
> Phasenreihenfolge „nach Symptomdruck" ist der Default; **eine Phase darf
> ihre eigene Schutzbedingung nicht überholen.**

---

## Ä6 — Tombstone-GC ≡ Epoch-Bump *(Teil 7, ERSETZEN)*

**Der Satz „Records mit `on:true` älter als der Kompaktionshorizont werden bei
der Sidecar-Kompaktion physisch entfernt" wird GESTRICHEN.** Ersatz:

> ```text
> INNERHALB einer Epoch   ausschließlich Yjs-eigenes GC (Inhalte gelöschter
>                         Items entfallen, Strukturskelette bleiben — bei
>                         Canvas-Skalen vernachlässigbar). KEINE physische
>                         Entfernung: ein Y.Map-Delete ist in Yjs nur ein
>                         weiterer Tombstone; echte Entfernung hieße
>                         Historien-Neuschrieb, und zwei Historien ohne
>                         gemeinsame Kausalität sind unverwandte Replikate
>                         (W4). Die Undo-Verlustfreiheit aus Teil 4 gilt
>                         innerhalb einer Epoch uneingeschränkt.
> PHYSISCHES GC           ist AUSSCHLIESSLICH ein koordinierter Epoch-Bump:
>                         Host mintet epoch+1 aus der Projektion (ohne
>                         Alt-Tombstones); Peers folgen der Epoch-Regel inkl.
>                         Konfliktkopie für ungesyncte Offline-Arbeit.
>                         Undo-Historie endet dokumentiert an der
>                         Epoch-Grenze.
> GC-HORIZONT             = Epoch-Lebensdauer. Es gibt keinen davon
>                         unabhängigen Kompaktionshorizont.
> ```

---

## Ä7 — Kopplungsregeln Relay-Persistenz × Epoch × Rotation *(Teil 7, ERGÄNZEN)*

**Neuer Abschnitt unter „Relay-Persistenz":**

> Die Relay-Blob-Persistenz ist nur mit zwei Kopplungsregeln korrekt:
>
> 1. **Epoch-Bump ⇒ Checkpoint ⇒ Truncation.** Jeder Epoch-Bump sendet
>    unmittelbar einen Checkpoint-Frame (voller State als ein Update). Der
>    Frame trägt die Epoch im Klartext-Header (der Relay bleibt content-blind,
>    ist aber frame-typ- und epoch-sichtig), und der Relay verwirft alle
>    Frames niedrigerer Epoch aus dem Blob. Ohne diese Regel replayed der
>    Relay einem Late-Joiner Alt-Epoch-Historie — Verschwendung im
>    Same-Doc-Fall, **Korruption durch Merge unverwandter Historien**, falls
>    der Bump je als frische Historie implementiert wird (was Ä6 für
>    physisches GC gerade vorschreibt).
> 2. **Passphrase-Rotation ⇒ Checkpoint unter neuem Schlüssel ⇒ Truncation.**
>    Das Deployment-Modell ist „Offboarding = Rotation"; der Relay speichert
>    Ciphertext; die Crypto-Regel droppt Undecryptierbares still. Ohne
>    Checkpoint erhält jeder Late-Joiner nach einer Rotation **lautlos nur
>    die Nach-Rotations-Historie**. Die Rotation ist erst abgeschlossen, wenn
>    der Checkpoint bestätigt ist.

---

## Ä8 — Adoption-blocked als benannter degradierter Zustand *(Teil 7, ERGÄNZEN)*

**Ergänzung zur Epoch-Regel:**

> Kann ein Verlierer seine Konfliktkopie nicht schreiben (I11: die Refusal
> bricht die Adoption ab — das bleibt richtig), tritt er in den benannten
> Zustand **ADOPTION-BLOCKED**: keine lokalen Writes mehr in das
> Alt-Epoch-Doc, Retry der Konfliktkopie mit eskalierendem Backoff, Notice
> mit konkretem Grund, Signaturpaar `EPOCH ADOPTION BLOCKED:` /
> `EPOCH ADOPTED:`. Stehende, stumme Divergenz — ein Replikat, das die
> höhere Epoch kennt und nicht folgt — ist kein zulässiger Dauerzustand;
> ihr einziges Symptom wäre, dass Imports „quietly stop winning".

---

## Ä9 — Sidecar-Exklusion auf vier Flächen *(Teil 7, ERSETZEN)*

**Der Exklusions-Absatz wird ersetzt durch:**

> Sidecar-, Recovery- und Index-Dateien (`.obsidian/liveshare/**`) sind von
> **vier** Flächen ausgeschlossen, jede einzeln benannt und getestet:
> (1) Manifest, (2) Text-/Canvas-Sync-Erkennung, (3) **File-Op-Broadcast
> outbound** (lokale Ops auf diese Pfade werden nie gesendet — auch nicht
> als Rename-Hälfte), (4) **File-Op-Anwendung inbound** (Remote-Ops auf
> diese Pfade werden verworfen und signiert geloggt — dieser Arm ist von
> jedem Peer ohne lokale Aktion erreichbar und ist damit eine
> Sicherheitsgrenze, keine Hygiene). Replikat-Zustand verlässt das Replikat
> nicht; fremder Replikat-Zustand betritt es nicht.

---

## Ä10 — Lock-Seam: Phasenzuweisung und Interim-Regel *(Teil 9 + Teil 13, ERGÄNZEN)*

**Teil 13:** Die Entfernung der Write-Denial-Maschinerie (Teil 9) wird
**P1 zugewiesen** (sie ist die Konsequenz der atomaren Register, die die
Denial-Logik überflüssig machen). Sie war bisher keiner Phase zugewiesen.

**Teil 9, neue Interim-Regel (gilt von P0 bis zur Entfernung in P1):**

> Solange der Daten-Seam existiert, ist seine Interaktion mit dem Shadow
> definiert als: **Der Shadow advanced nur bei akzeptiertem Upsert.** Ein
> Denial schreibt nichts und rührt den Shadow nicht an; der abgelehnte Wert
> bleibt dadurch beim nächsten Diff sichtbar (natives Äquivalent des alten
> „Baseline-Hold", ohne Sondermechanik), und der Reconcile-Revert setzt den
> View auf Doc-Wahrheit zurück, was den Shadow regulär advanced. Ein
> „gehaltener" Shadow — einer, der absichtlich von dem abweicht, was der
> User nachweislich gesehen hat — ist verboten: er zerstörte die eine
> Eigenschaft, die den Shadow korrekt macht.

---

## Ä11 — Rig-Prämisse korrigieren *(Teil 14, ERSETZEN)*

**Der Satz „`tools/launch_liveshare_e2e.py` existiert und lief nie" wird
ersetzt durch:**

> Der Real-Obsidian-Host-Layer ist **unbuilt**. Der existierende Launcher ist
> ein Headless-Mock-Host-Rig, das echtes Obsidian bewusst ausschließt. Das
> Pflicht-Gate aus diesem Teil erfordert den Bau dieses Layers; jede Aussage
> über „läuft in echtem Obsidian" ist bis dahin unbelegt. (Die Fehleinschätzung
> stammt aus V1-ARCHITECTURE, die den Rig als „built and never executed"
> beschrieb, ohne seine Headless-Natur zu nennen — und sie war der größte
> Einzeltreiber des Arbeitsumfangs.)

---

## Ä12 — Intent-Trace-Orakel und Referenzmodellpflicht *(Teil 14, ERGÄNZEN)*

**Ergänzung zum Orakel-Set des Fuzzers/Gates:**

> Die vier bisherigen Orakel — SEC, Schema, Byte-Gleichheit,
> Shadow-Konsistenz — sind **gemessen alle grün über einem beweisbar
> korrupten Dokument** (200 Szenarien × 10 Fenster; SEC und Byte-Gleichheit
> strukturell blind: beide Replikate können sich auf den *falschen* Wert
> einigen). „Convergence is not correctness" ist damit von einem Argument zu
> einer Spezifikationsanforderung geworden: Das Orakel-Set MUSS ein
> **Intent-Trace-Orakel** enthalten — erwarteter Endzustand = deterministische
> Auswertung des Intent-Logs durch ein **Referenzmodell**.
>
> **Referenzmodellpflicht:** Das Referenzmodell ist eine eigenständige,
> minimale, ausführbare Spezifikation der Register-Semantik (LWW über
> Stempel, Tombstone-Regel, Präzedenzregel aus Ä4), unabhängig von der
> Implementierung autorisiert. Stammen Erwartungswerte aus derselben
> Codebasis oder demselben Entwurfsvorgang wie der Prüfling, misst das Orakel
> Selbstkonsistenz — die zehnte Variante eines Tests, der nicht scheitern
> kann.

---

## Ä13 — Gate-Pfadpflicht, Chaos-Suiten, Pfad-Evidenz *(Teil 14, ERGÄNZEN)*

**Ergänzung zu den Gate-Anforderungen:**

> 1. **Pfadpflicht.** Das Gate MUSS den Pfad exerzieren, auf dem der Fix
>    lebt: echte Editor-/Canvas-Gesten durch Obsidian
>    (Reconcile → requestSave → CAPTURE_NET bzw. Adapter-Signale), niemals
>    direkte Injektion ins `Y.Doc`. Ein Rig, das ins CRDT injiziert, testet
>    den Transport — dessen Konvergenz nie in Frage stand — und nichts über
>    P0/P1. Der Treiber muss `applied` ehrlich melden können; ein Host, der
>    konstant Erfolg meldet, macht jede Akzeptanzbedingung unfalsifizierbar.
> 2. **Chaos-Suiten sind Gate-Szenarien.** Die vier benannten Suiten aus
>    diesem Teil („View-Apply verzögert + Obsidian-Save", „Adapter
>    unavailable + offener View", „Host-Rejoin mit älterem Sidecar",
>    „Mixed-Version-Peer") laufen im Real-Gate, jede mit ihrer
>    Discrimination-Variante. Sie sind die konkrete Form der Pfadpflicht.
> 3. **Positive Pfad-Evidenz.** Der Nachweis, welcher Pfad lief, wird
>    **mitgeschrieben, nicht behauptet**: ein expliziter Provenance-Trace pro
>    Edit (Yjs-Transaktions-Origins sind transaktionslokal und nicht
>    persistent — sie genügen nicht). Ein Gate-Ergebnis ohne Pfad-Evidenz
>    ist kein Ergebnis.

---

## Ä14 — Release-Bedingung vs. Phase-Closure *(Teil 13 + Teil 14, ERGÄNZEN)*

> Der Real-Obsidian-Gate-Lauf ist **Release-Bedingung** (vor jedem Einsatz
> mit echten Vaults), nicht Bedingung jedes Phasenabschlusses. Ein
> Phasenabschluss ohne Gate bedeutet exakt: **„headless-verifiziert,
> real-offen"** — und führt verpflichtend ein **Reopen-Risiko-Feld**: die
> benannten Annahmen, deren Widerlegung im Gate die Phase wieder öffnet
> (für P0: `CAPTURE_TRIGGERS`-Realverhalten und requestSave-Timing; für P1:
> Migrations-Präzedenz unter echtem Editor). Vakuum-Läufe sind schlechter
> als kein Lauf: Ein grünes Gate, das nichts beweist, ist genau die
> Fehlerklasse, die dieses Projekt eliminiert — im einzigen Artefakt, an dem
> es gemessen wird.

---

## Ä15 — Fail-closed-Defaults und Config-Dir-Deny-List *(Teil 11 + Trust Boundaries, NEU)*

> **Fail-closed-Defaults.** Ein leerer oder undefinierter Share-Scope führt
> zur **Startverweigerung**, niemals zu „alles teilen". Allgemein: Wo eine
> Konfigurationslücke die Wahl lässt zwischen „nichts tun" und „alles tun",
> ist „nichts tun" normativ.
>
> **Config-Dir-Deny-List.** `isPathSafe` prüft Traversal — das genügt nicht.
> An **jedem** Funnel, an dem ein peer-gelieferter Pfad zu einem
> Filesystem-Write werden kann, gilt zusätzlich eine Deny-List:
> `.obsidian/**` (Plugin-Code, Configs, CSS-Snippets eines
> Electron-Prozesses — peer-erreichbares Schreiben dorthin ist eine
> Remote-Code-Execution-Fläche, keine Hygienefrage) und
> `.obsidian/liveshare/**` (Replikat-Zustand, Ä9). Verstöße werden verworfen
> und signiert geloggt. Diese Regel gehört zu den Trust Boundaries und wird
> pro Funnel per Discrimination-Test gepinnt.

---

## Ä16 — Mutationstest-Metrik *(Teil 14, ERGÄNZEN)*

> Für die puren Decision-Cores (Shadow-Diff, Reconcile-Plan, Präzedenzregel,
> Epoch-Vergleich, Tombstone-Auswertung, Pfad-Gates) wird ein
> **Mutationstest-Score** als Gate-Metrik geführt: automatisiertes Mutieren
> des Prüflings, Assertion muss rot werden. Neun handgefundene
> „green test that cannot fail"-Mechanismen sind der empirische Beweis, dass
> die systematische Form billiger ist als die zehnte Handsuche. Das
> Discrimination-Muster bleibt für Kompositionen (dort mutiert man
> Architektur, nicht Ausdrücke); Mutationstests decken die Ausdrucks-Ebene ab.

---

## Ä17 — Clearing ist Intent *(Teil 4 + Teil 5, ERGÄNZEN)*

> Das Entfernen eines optionalen Werts (`color`, `label`, Leeren von `text`)
> ist ein **explizites Delete-/Änderungs-Ereignis im Sinne von I7** und
> propagiert wie jeder andere Intent — es ist „real, reversible user intent"
> (V1-Architektur, wörtlich). Ein Capture-Pfad, der eine legale
> Intent-Klasse still verwirft, erzeugt exakt die Self-Revert-Erfahrung
> (lokal entfernt → remote restauriert), deren Abschaffung der Zweck von V2
> ist. Bewusste Regressionen dieser Regel sind zulässig nur als
> **known-open, user-reachable** geführt — nicht als stille Fußnote.

---

## Geltung

Mit Annahme dieses Sets gilt:

- Die neun Report-Amendments sind umgesetzt (1–3, 5–7, 9 direkt; 4 als Ä12
  geschärft; 8 als Ä6 aufgelöst statt nur adressiert).
- Die Review-Funde A1–A6, B1, B3, B6, B8, B9 und C5 sind konzeptuell
  geschlossen; B2/B4/B5/B7/B10 und C1–C4/C6 sind Implementierungs- bzw.
  Report-Korrekturen und bewusst **nicht** Teil dieses Files.
- Invariantenstand: **I1–I11**, kein I12.
