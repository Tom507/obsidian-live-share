# Obsidian Live Share — V2-Konzept: Theoriebasiertes Redesign der Canvas-Synchronisierung

> **Zweck.** Dieses Dokument identifiziert die konzeptuellen Schwachstellen der in
> `ARCHITECTURE.md` (HEAD `4b34d5e` + canvas-integrity) beschriebenen Architektur
> und entwickelt daraus ein V2-Design, das jede Designentscheidung auf die
> CRDT-Theorie zurückführt (Shapiro et al. 2011; Kleppmann & Beresford 2017;
> Weidner 2022/23; Wallace/Figma; Kleppmann et al. 2019–2024 — siehe
> Recherchebericht) und die gemeldeten Symptome mechanistisch erklärt und schließt.
>
> **Was V2 nicht ist:** kein Rewrite. Die fünf Invarianten (I1–I5), der
> Ownership-Seam, der Single-Writer, der Reconcile-Plan-Kern, das
> Awareness-Liveness-Design und der Minimal-Text-Diff bleiben. V2 ist ein Redesign
> der **semantischen Schicht**: Was ist ein Konflikt, wer erkennt Intent, was ist
> die dauerhafte Wahrheit.

---

## Inhalt

```text
Teil 1   Symptom → Ursache: die gemeldeten Fehlerbilder mechanistisch erklärt
Teil 2   Die zehn konzeptuellen Schwachstellen (W1–W10)
Teil 3   V2-Leitprinzipien (die fünf Invarianten + fünf neue)
Teil 4   Datenmodell V2: Feld-für-Feld-Merge-Politik mit Konvergenzargument
Teil 5   Capture V2: Shadow-basierter Intent-Diff (der wichtigste Fix)
Teil 6   Reconcile V2
Teil 7   Persistenz und Sitzungen: dauerhafte CRDT-Historie
Teil 8   Ownership-Konsens und Degradation ohne Fork
Teil 9   Locks, Presence, Undo
Teil 10  Serialisierung: kanonisch und deterministisch
Teil 11  Validierung, Quarantäne, Selbstreparatur
Teil 12  Edge-Case-Matrix: alt gegen neu
Teil 13  Migrationspfad in sechs Phasen
Teil 14  Teststrategie: Konvergenz-Fuzzing und der E2E-Zwang
Teil 15  Bewusst offene Restrisiken
```

---

# Teil 1 — Symptom → Ursache

Beide gemeldeten Fehlerbilder lassen sich vollständig auf Mechanismen zurückführen,
die im Architekturdokument selbst stehen. Nichts davon ist mysteriös; es sind
Kompositionen bekannter Einzelmechanismen.

## Symptom 1 — „Nodes lösen sich von ihren Pfeilen und schweben im Raum"

Das Architekturdokument benennt die Asymmetrie selbst (Problem 2): *ein durch
schlechten Merge beschädigter Node rendert meist noch; eine Edge ist nichts als
Referenzen.* Drei Mechanismen produzieren gemeinsam dieses Bild:

**(a) Per-Key-LWW zerreißt zusammengesetzte Werte.** `x`, `y`, `width`, `height`
sind vier unabhängige LWW-Register im selben `Y.Map`. Zwei konkurrierende
Bewegungen desselben Nodes konvergieren nicht auf Position A oder Position B,
sondern potentiell auf **A.x mit B.y** — eine Position, die *niemand* je gesetzt
hat. Genau das ist „ein Node schwebt random im Raum": ein torn write. Der
Advisory-Lock soll das verhindern, aber er ist per Design nicht verlässlich
(R7 kein Epoch, Reconnect-Fenster, diff-inferred Fallback ohne private API) — und
ein Korrektheitsproblem, das nur solange nicht auftritt, wie ein UX-Mechanismus
funktioniert, ist per Definition ungelöst. Dieselbe Klasse trifft Edges härter:
`fromNode` und `fromSide` sind getrennte Register; ein Re-Route von A und ein
konkurrierendes Re-Route von B kann `fromNode` von A mit `fromSide` von B
kombinieren — der Pfeil zeigt von einer Seite ab, an der am neuen Node nichts
hängt, oder verweist auf eine (Node, Seite)-Kombination, die geometrisch ins
Leere läuft.

**(b) Pfeil-Rerouting ist ein View-Problem, das als Datenproblem erscheint.**
Per-Node-Geometrie-Moves reroute in Obsidian keine Pfeile (Abschnitt D); dafür
existiert die Eskalation auf `reloadCanvasData`. Jede Lücke in der Eskalation
(z. B. `isBusy()`-Defer, Adapter teilweise unavailable, ein Endpoint-Move, der die
Endpoint-Erkennung verfehlt) lässt die Pfeile mit alter Routing-Geometrie stehen —
optisch „gelöst vom Node". Obsidian speichert anschließend sein eigenes,
neu berechnetes Routing und füttert damit den Capture-Pfad (→ Symptom 2).

**(c) Die bekannte Lücke A.2/16.** Eine Edge, die `fromNode` *komplett* verliert
(nicht auf einen fehlenden Node zeigt, sondern den Key gar nicht mehr hat),
passiert den Dangling-Guard, erreicht die Disk endpunktlos, und Obsidians
`importData` droppt sie still — zusammen mit dem in A.2/17 beschriebenen
Totalverlust bei `type`-Verlust. Es existiert Detektion (`NO TYPE`/`DETACH`
Signaturen), aber keine Reparatur. Der Zufluss solcher Records ist unter Flag OFF
selten, aber der Ingest hat keine Schema-Barriere, die ihn *strukturell*
ausschließt.

## Symptom 2 — „Beim Nachladen von offscreen zerhackt erst eine Version, dann die andere"

Das ist die wichtigste Beobachtung, und sie hat eine präzise Wurzel:
**der Capture-Kanal diffiert gegen die falsche Basis.**

Der Ablauf, Schritt für Schritt, mit den Mechanismen aus dem Architekturdokument:

```text
1  Peer B ändert etwas. Delta erreicht Client A. CanvasPersistence (der Writer,
   dessen Lebensdauer die Subscription ist) schreibt es auf As Disk.
   → onWritten → noteExternalDiskWrite → lastWrittenContent ENTHÄLT Bs Änderung.
2  Der Reconcile in As OFFENEN View schlägt fehl oder verzögert sich:
   isBusy()-Defer, "interacting"-Skip, private API (teil-)unavailable
   (A.3/31: "reconcile is skipped — the file write suffices" — aber Obsidian
   IGNORIERT externe Writes auf offene Canvases, der File-Write genügt also
   gerade NICHT), oder schlicht Timing beim Lazy-Load eines Canvas/Embeds.
   → As LIVE VIEW kennt Bs Änderung nicht.
3  Irgendetwas triggert Obsidians requestSave bei A — ein lokaler Edit, ein
   nachgeladenes Embed, eine Normalisierung. Obsidian serialisiert sein
   VOLLSTÄNDIGES, für Bs Felder VERALTETES Modell. Das liegt außerhalb des
   250-ms-Mute-Fensters ("whenever it feels like it").
4  handleLocalModify: base = lastWrittenContent (enthält Bs Änderung),
   next = Obsidians Save (enthält sie nicht). base ≠ next
   → der Drei-Wege-Diff liest das als ABSICHTLICHEN lokalen Revert
   → As Client schreibt Bs Änderung im CRDT zurück auf den alten Wert.
5  Das Delta erreicht B. Bs View wird per Reconcile auf den Stand VOR der
   eigenen Änderung zurückgesetzt ("bei User A ist es als Erstes zerhackt").
   Bs Obsidian speichert daraufhin sein Modell — das inzwischen selbst
   Felder enthält, die As View nie angekommen sind — und Schritt 3–5
   laufen in Gegenrichtung ("… und bei User B wird es dann auch später
   zerhackt"). Der semantische Echo-Breaker greift nicht: die Zustände SIND
   verschieden, es ist kein Echo, es ist wechselseitige Staleness.
```

Das Architekturdokument beschreibt exakt diese Klasse als historisch gefixt —
aber nur die **Klassifikationsseite** wurde gefixt (Reconcile klassifiziert
gegen den `canvasApplied`-Shadow statt gegen Live-ID-Sets, Abschnitt D). Die
**Capture-Seite** diffiert weiterhin gegen `lastWrittenContent`, also gegen den
Disk-Zustand — und Disk kann dem View beliebig weit voraus sein. Sobald *irgendein*
Apply-Pfad hakt, wird jeder Obsidian-Save zur Revert-Maschine. „Nachladen von
offscreen" ist dabei nur der zuverlässigste Trigger, weil Lazy-Load-Situationen
(Canvas wird erst beim Öffnen subscribed, Embeds laden beim Scrollen nach,
Obsidian normalisiert und speichert dabei) genau die Kombination „View stale +
requestSave außerhalb des Mute-Fensters" maximieren.

Theoretisch formuliert: Das System betreibt **Operations-Inferenz aus
unversionierten Zustands-Snapshots**. Ein CRDT braucht Operationen (Intent) oder
versionierte Zustände (State-CRDT mit Vektor). Obsidians Save ist beides nicht —
er ist ein Snapshot gemischten Alters: Felder, die der User eben geändert hat
(neuer als das CRDT), neben Feldern, die der View nie erreicht haben (älter als
das CRDT), ohne jede Versionsinformation pro Feld. Ein Drei-Wege-Diff gegen
*eine* Basis kann diese Mischung prinzipiell nicht trennen, solange die Basis
nicht exakt „das, was dieser View zuletzt gesehen hat" ist. Der Fix ist deshalb
kein weiterer Guard, sondern die Korrektur der Diff-Basis (Teil 5).

---

# Teil 2 — Die zehn konzeptuellen Schwachstellen

Jede Schwachstelle: Mechanismus → Theoriebezug → Schwere. Die Reihenfolge ist
Konsequenz-sortiert.

## W1 — Capture diffiert gegen Disk statt gegen den View-Shadow

**Mechanismus:** Teil 1, Symptom 2. `handleLocalModify` nutzt
`lastWrittenContent` als Diff-Basis; die kann dem offenen View voraus sein; jede
Differenz wird als Intent gelesen. Betroffen sind *alle* Fälle, in denen Apply
nicht sofort und vollständig landet: `isBusy()`, `"interacting"`, degradierte
private API (A.3/31 — dort ist der offene View **strukturell dauerhaft stale**),
Timing bei Lazy-Subscribe und Embed-Loads.

**Theorie:** Snapshot-Merging ohne Versionsvektor ist kein CRDT-Merge; es fehlt
die `happened-before`-Information pro Feld. Die korrekte Basis für Intent-Inferenz
ist die letzte auf die beobachtete Oberfläche projizierte Version — das Prinzip
„read your applied writes" pro Feld.

**Schwere: kritisch.** Das ist die Wurzel des Kaskaden-Symptoms.

## W2 — Per-Key-LWW zerreißt zusammengesetzte Werte

**Mechanismus:** `x/y/width/height` und `fromNode/fromSide` bzw.
`toNode/toSide` sind unabhängige Register. Konkurrierende Writes konvergieren auf
Mischwerte, die kein Replikat je hatte (Teil 1, Symptom 1a).

**Theorie:** Die Granularität eines Registers definiert die atomare Einheit der
Konfliktauflösung (Weidner, „Designing Data Structures for Collaborative Apps").
Figma behandelt eine Property als *einen* LWW-Wert genau deshalb. Werte, die nur
gemeinsam Sinn ergeben, gehören in *ein* Register; Werte, die unabhängig editiert
werden (Position vs. Größe, Farbe vs. Text), in getrennte — damit unabhängige
Edits kommutieren statt sich gegenseitig zu überschreiben.

**Schwere: hoch.** Direkte Ursache von „schwebenden" Nodes und geometrisch
unmöglichen Edges.

## W3 — Kein Schema-Zwang am Ingest; partielle Beobachtung kann löschen

**Mechanismus:** A.2/16 (fehlender Endpoint-Key passiert den String-Guard) ist nur
das sichtbare Ende. Die tiefere Ursache steht in R1: die (deaktivierte)
Binding-Capture emittiert `{id}` ohne Endpoints, und `writeRecordMinimal`
**löscht jeden Doc-Key, der im eingehenden Record fehlt**. Das ist eine
Verwechslung von „nicht beobachtet" mit „gelöscht". `PROTECTED_KEYS` ist ein
Pflaster darüber, kein Modell: es schützt eine Aufzählung, nicht eine Invariante,
und A.2/16–18 sind die Keys bzw. Pfade, die durchrutschen. Es existiert Detektion,
aber keine Reparatur.

**Theorie:** Partielle Beobachtungen dürfen nur Upserts erzeugen, niemals
Deletions; Löschung braucht ein explizites Delete-Ereignis. Schema-Invarianten
(„eine Edge hat zwei Endpoints") gehören als Typzwang an die Grenze des
Replikats, nicht als Filter an die Serialisierung — sonst konvergieren alle
Replikate korrekt auf einen ungültigen Zustand („convergence is not
correctness", das eigene Problem 2, konsequent zu Ende gedacht).

**Schwere: hoch** (Blocker für die Binding-Zukunft; offene Korruptionstür heute).

## W4 — Keine dauerhafte CRDT-Historie: Snapshot-Reseeding zerstört Kausalität

**Mechanismus:** Der Relay hält kein Dokument; verlassen alle Peers den Raum, ist
die Historie weg. Der nächste Start seedet aus einer JSON-Datei — einem Snapshot
ohne jede kausale Beziehung zur vorherigen Doc-Historie. `coldOpen` „doc-wins"
mildert das innerhalb einer Session; über Session-Grenzen existiert nichts, und
R4 (`applyCanvasToYMaps` löscht beim Host-Rejoin alles, was in der lokalen Datei
fehlt) ist die dokumentierte Folge: ein Host mit älterer Datei verwirft
Peer-Arbeit.

**Theorie:** Das Longevity-Ideal von Local-first (Kleppmann et al. 2019) und das
Automerge-Modell (save/load der Update-Historie): Die Wahrheit eines CRDTs ist
seine Update-Historie bzw. sein Zustand *mit* Metadaten, nicht seine Projektion.
Zwei aus verschiedenen Snapshots geseedete Docs sind formal zwei **unverwandte
Replikate** — dieselbe Klasse Fehler wie der historische Two-Writer-Defekt
(„two different id strings are two unrelated documents"), nur auf der Zeitachse
statt im Namensraum.

**Schwere: hoch.** Jeder Session-Neustart ist heute ein potentielles
Divergenz-Ereignis.

## W5 — Ownership ist eine Per-Client-Entscheidung ohne Konsens

**Mechanismus:** `canvasOwned` und der R10-Text-Fallback werden **pro Client**
entschieden. Scheitert `CanvasSync.subscribe` bei Client A (waitForSync-Timeout),
synct A den Canvas als `Y.Text` unter der Doc-ID `<path>`, während B ihn unter
`__canvas__:<path>` synct — zwei unverwandte Dokumente *im selben Raum, für
dieselbe Datei, auf verschiedenen Clients*. Innerhalb eines Clients ist der
Fallback exklusiv; über Clients hinweg ist er ein Split-Brain: A und B sehen
gegenseitig keine Änderungen mehr, beide schreiben dieselbe Datei aus
verschiedenen Wahrheiten, und die spätere Rückkehr in den Owned-Modus
(doc-wins) verwirft As Fallback-Arbeit.

**Theorie:** Der Modus einer geteilten Ressource ist geteilter Zustand und braucht
eine einzige Autorität — dieselbe Lektion, die das Architekturdokument selbst für
die *lokale* Ownership zieht („ownership a property of the system, decided in one
place"), nur eine Ebene höher: pro *Raum*, nicht pro Client.

**Schwere: mittel-hoch** (selten, aber wenn, dann Voll-Desync mit Datenverlust).

## W6 — Locks tragen Korrektheitslast, die ins Datenmodell gehört

**Mechanismus:** Ein verweigerter Write hält die Diff-Baseline
(„held rather than advanced"), erzeugt absichtliche lokale Divergenz, die später
zurückgerollt wird; der Lock-Seam prüft Edges über beide Endpoints und beide
Record-Versionen; R7 akzeptiert bounded LWW bei Lock-Wechsel mid-write. Das ist
viel Maschinerie an einem Mechanismus, der per Design unzuverlässig ist
(advisory, Awareness-basiert, prunebar).

**Theorie:** Figmas Lektion: Konflikte am selben Objekt löst das Datenmodell
(LWW auf atomaren Composites — „der Karteneffekt springt" ist akzeptabel und
selten, wenn Locks als UX funktionieren); Locks sind ausschließlich
Intent-Signalisierung. Sobald das Datenmodell W2-fest ist, darf die
Write-Denial-Maschinerie ersatzlos entfallen — mit ihr eine ganze
Edge-Case-Familie (A.2/13, A.2/14, R7).

**Schwere: mittel** (Komplexitäts- und Edge-Case-Treiber, weniger direkter
Korruptionspfad).

## W7 — Reihenfolge ist nicht modelliert

**Mechanismus:** `parseCanvas` wirft die Array-Reihenfolge weg;
`buildCanvasData` serialisiert in unspezifizierter Map-Reihenfolge. Obsidian
rendert Canvas-Arrays in Reihenfolge (Z-Ordnung/Überlappung); zwei Clients
serialisieren denselben Doc-Zustand in verschiedener Reihenfolge — semantisch
gleich, byte-verschieden — Dauer-Churn auf Disk, permanenter Druck auf den
semantischen Echo-Breaker, nutzlose Diffs in Git-versionierten Vaults, und
sichtbare Z-Order-Sprünge zwischen Peers.

**Theorie:** Reihenfolge in einer keyed Map ist ein eigenes Datum. Der
Industriestandard für Canvas-Ordnung ist Fractional Indexing (Wallace/Figma,
Excalidraw, Loro) mit Jitter und PeerID-Tiebreak gegen Kollisionen; für
Objektordnung (nicht Text!) ist das Interleaving-Problem irrelevant.

**Schwere: mittel.**

## W8 — Node-Text ist ein LWW-Primitiv

**Mechanismus:** `text` ist ein Key im Node-Map. Zwei Personen, die gleichzeitig
in dieselbe Karte schreiben, konvergieren per LWW — die Eingabe eines der beiden
verschwindet vollständig. Das widerspricht dem Kernanspruch „reibungslose
Multiplayer-Texteditierung": ausgerechnet der Inhalt, der Sequenz-Merge am
nötigsten hat, bekommt als einziger keinen.

**Theorie:** Text gehört in ein Sequenz-CRDT (`Y.Text` nested im Node-Record;
YATA-Konvergenz ist bewiesen, Interleaving-Anomalien sind bei YATA begrenzt und
für Karten-Text akzeptabel — Fugue wäre die Maximallösung, ist aber mit Yjs nicht
verfügbar und hier nicht nötig). Der Minimal-Diff-Mechanismus inkl.
Surrogate-Snapping existiert im Codebase bereits für den Text-Pfad und ist direkt
wiederverwendbar.

**Schwere: mittel** (kein Korruptionspfad, aber ein Kern-Feature-Defizit).

## W9 — Obsidian-originierte Modellmutationen sind von User-Intent ununterscheidbar

**Mechanismus:** Obsidians `requestSave` feuert auch ohne User-Edit: beim
Nachladen von Embeds, bei Normalisierungen (Zahlformat, Key-Reihenfolge,
Default-Ergänzungen), beim Reload nach Reconcile. Der semantische Echo-Breaker
fängt nur exakte Gleichheit; jede *tatsächliche* Wertabweichung (Rundung,
recomputetes Edge-Routing nach 1b, Defaults) wird als Intent gepusht und pingt
zwischen Clients hin und her, weil beide Obsidians unterschiedlich normalisieren.
Das ist der zweite Zünder des „Nachladen von offscreen"-Symptoms und eine
Unterklasse von W1, aber mit eigener Gegenmaßnahme (kanonische Serialisierung +
Shadow-Diff, Teile 5 und 10).

**Schwere: hoch** in Kombination mit W1; allein: mittel.

## W10 — Die Verifikationslücke ist selbst eine Architektur-Schwachstelle

**Mechanismus:** R2 (nichts je behavioral verifiziert, `CAPTURE_TRIGGERS`
inferiert statt bestätigt), R3 (`main.ts`, 1689 Zeilen Wiring, ungetestet), und
die eigene Geschichte: der Two-Writer-Defekt überlebte 526 grüne Tests, weil
niemand die *Komposition* testete. Die aktuellen 674 Tests testen wieder
Subsysteme und zwei-Peer-Harnesse — aber keinen randomisierten
Mehr-Peer-Konvergenztest und keinen einzigen echten Obsidian-Lauf.

**Theorie:** Konvergenz ist eine ∀-Aussage über alle Interleavings; Beispieltests
prüfen ∃. Der Standard dafür ist property-based Fuzzing (zufällige
Op-Sequenzen, Partitionen, Reordering → assert: identischer Zustand +
Invarianten auf allen Replikaten) — die Methode, mit der die publizierten
OT-Algorithmen-Fehler und diverse CRDT-Implementierungsbugs gefunden wurden.

**Schwere: strukturell.** Jeder V2-Mechanismus ist nur so glaubwürdig wie seine
Konvergenz-Prüfung.

---

# Teil 3 — V2-Leitprinzipien

I1–I5 bleiben unverändert. V2 ergänzt fünf neue Invarianten; jede schließt
mindestens eine Schwachstelle strukturell (nicht per Guard):

```text
I6  INTENT IST SHADOW-RELATIV   Ein aus einem Zustands-Snapshot inferierter Edit
                                zählt nur als Intent, wenn das Feld von der
                                zuletzt auf DIESE Oberfläche projizierten Version
                                abweicht.                              → W1, W9
I7  BEOBACHTUNG LÖSCHT NIE      Partielle Captures erzeugen ausschließlich
                                Upserts. Löschen erfordert ein explizites
                                Delete-Ereignis und wird als Tombstone-Flag
                                modelliert, nicht als Key-Abwesenheit.  → W3
I8  ATOMAR IST, WAS ZUSAMMEN    Werte, die nur gemeinsam gültig sind, sind EIN
    GEHÖRT                      Register; unabhängig editierbare Aspekte sind
                                getrennte Register.                     → W2
I9  HISTORIE IST DIE WAHRHEIT   Ein Doc wird genau EINMAL in seinem Leben aus
                                einer Datei geseedet. Danach ist seine
                                Update-Historie persistent; Snapshots sind
                                Projektionen. Import aus Datei ist eine
                                explizite, benannte User-Aktion.        → W4
I10 EIN MODUS PRO RAUM          Der Sync-Modus eines Pfads ist geteilter,
                                host-autorisierter Zustand. Ein Client, der den
                                Modus nicht erfüllen kann, degradiert zu
                                Empfangen-und-Persistieren — er forkt nie in
                                einen anderen Modus.                    → W5
```

Und eine Politik-Entscheidung oberhalb der Invarianten, weil sie das
Recherche-Fazit direkt umsetzt: **Yjs bleibt.** Die Alternativen wurden geprüft —
Loro (Movable Tree, Fugue) und Eg-walker lösen Probleme, die dieses System nicht
hat: Der Canvas ist flach (Obsidian-Gruppen sind geometrisch, nicht
hierarchisch — es gibt keinen Baum, also kein Move-Tree-Problem), die
Dokumentgrößen liegen Größenordnungen unter den Skalen, bei denen
Eg-walker/Columnar-Encoding entscheidend werden, und Yjs bringt die drei Dinge
mit, die V2 wirklich braucht: Awareness (Presence/Locks), `Y.UndoManager`
(selektives Per-Client-Undo) und nested `Y.Text` (W8). Ein Bibliothekswechsel
wäre Risiko ohne adressiertes Problem.

---

# Teil 4 — Datenmodell V2

## Struktur

```text
Y.Doc  "__canvas__:<guid>"                     ← GUID, nicht Pfad (Teil 7)
├── meta   : Y.Map                              schemaVersion, guid, epoch, path
├── nodes  : Y.Map<id, Y.Map<field, value>>
├── edges  : Y.Map<id, Y.Map<field, value>>
└── deleted: Y.Map<id, {t: lamport, by: clientID, on: bool}>   ← Tombstones
```

Container werden **einmal erzeugt und nie ersetzt** (die bekannte
Detach-Falle bei `parent.set(id, new Y.Map())` wird damit zur verbotenen
Operation, nicht zum vermiedenen Fehler): Record-Erzeugung ist eine Transaktion
mit vollständigem, schema-validiertem Record; danach existieren nur noch
Feld-Updates und das Tombstone-Flag.

## Feld-für-Feld-Merge-Politik

| Feld | CRDT-Typ | Merge | Begründung |
|---|---|---|---|
| `pos` = `[x, y]` | ein LWW-Register (JSON-Array als ein Wert) | atomarer LWW | eine Position ist ein Punkt, kein Koordinatenpaar mit getrennten Autoren. Konkurrierende Moves → einer gewinnt vollständig; „Karte springt einmal" statt „Karte landet, wo niemand sie hingelegt hat". Schließt W2 für Nodes. |
| `size` = `[w, h]` | ein LWW-Register | atomarer LWW | getrennt von `pos`, damit Move ⊥ Resize: A bewegt, B resized denselben Node → beides überlebt (die Operationen kommutieren, weil sie disjunkte Register treffen). |
| `type` | write-once | Set-einmal, danach immutabel am Ingest | Obsidian ändert den Typ eines Nodes nie. Ein `type`-Verlust (A.2/17) wird damit von „geschützter Key" zu „unmögliche Operation". |
| `text` (Text-Node, Edge-`label`) | `Y.Text` nested | YATA-Sequenz-Merge | W8. Capture über Minimal-Diff (vorhandener Mechanismus inkl. Surrogate-Snapping); konkurrierendes Tippen merged zeichenweise. |
| `file`, `url`, `subpath` | LWW-Register | LWW | echte Einzelwerte; Änderung ist seltener, bewusster Intent. |
| `color` | LWW-Register | LWW, löschbar | reversibler Stil-Intent; Löschung = explizites Delete-Ereignis (I7), nicht Key-Abwesenheit. |
| `from` = `{node, side, end?}` | ein LWW-Register | atomarer LWW | ein Edge-Endpunkt ist eine Einheit. Konkurrierendes Re-Routing → ein Endpunkt gewinnt konsistent. Schließt W2 für Edges. |
| `to` = `{node, side, end?}` | ein LWW-Register | atomarer LWW | dito; `from` ⊥ `to`, konkurrierendes Umhängen beider Enden kommutiert. |
| `ord` | LWW-Register, Fractional-Index-String | LWW; Vergabe mit Jitter + `(clientID)`-Suffix als Tiebreak | W7. Deterministische Serialisierungsreihenfolge und stabile Z-Ordnung. Objektordnung, nicht Text → Interleaving irrelevant (Recherche: Wallace, Loro-Praxis). |
| Gruppen (`type:"group"`) | wie normale Nodes | — | Obsidian-Gruppen sind geometrische Container ohne Membership-Relation; es gibt bewusst **kein** Tree-CRDT. Multi-Node-Drags (Gruppe zieht Kinder) werden als eine Transaktion gecaptured — ein Undo-Schritt, ein Delta-Burst. |
| Löschung | `deleted[id] = {t, by, on:true}` | LWW auf `on` (Lamport `t`, Tiebreak `by`) | ersetzt „delete-wins per Diff-Logik". `on:true` unterdrückt den Record überall (Reconcile, Serialisierung, Capture-Resurrect-Sperre). **Undo eines Delete = `on:false` + kein Datenverlust**, weil die Feldcontainer nie zerstört wurden — das löst den Konflikt zwischen No-Resurrect und Undo, den ein G-Set-Tombstone hätte (aus einem G-Set kommt nichts zurück). GC: Records mit `on:true` älter als der Kompaktionshorizont werden bei der Sidecar-Kompaktion (Teil 7) physisch entfernt. |

## Konvergenzargument (Shapiro-Rahmen)

Jeder Feldtyp ist einzeln ein bewiesener CRDT, und ihre Komposition in
unabhängigen Map-Keys erhält SEC (Weidner: Komposition unabhängiger CRDTs ist ein
CRDT):

- **LWW-Register** über Yjs' `(clock, clientID)`-Totalordnung: kommutativ,
  assoziativ, idempotent per Konstruktion. Die V2-Änderung ist nur die
  *Granularität* (I8), nicht der Mechanismus.
- **`Y.Text`**: YATA, Konvergenz publiziert bewiesen (Nicolaescu et al. 2016).
- **Tombstone-Map**: LWW-Register pro id; die Suppressions-Semantik ist eine
  reine Leseregel und berührt die Konvergenz nicht.
- **Fractional Index**: jeder vergebene Wert ist immutabel; konkurrierende
  Vergabe identischer Strings ist durch Jitter+clientID-Suffix ausgeschlossen;
  die Sortierung `(ord, id)` ist total → alle Replikate serialisieren identisch.

Wichtig ist, was *nicht* mehr behauptet wird: V2 verspricht keine
Intent-Bewahrung bei konkurrierenden Writes auf dasselbe atomare Register — dort
gilt ehrlicher LWW („einer gewinnt ganz"), und die Locks (Teil 9) machen den
Fall selten. Das ist die Figma-Position aus der Recherche, bewusst übernommen:
für einen Canvas ist konsistenter, vollständiger LWW pro semantischer Einheit
besser als der Versuch, alles zu bewahren und dabei Chimären zu erzeugen.

---

# Teil 5 — Capture V2: der Shadow-basierte Intent-Diff

Der wichtigste Einzelfix. Er ersetzt die Diff-Basis, nicht den Diff.

## Der Surface-Shadow

Pro subscribed Canvas hält der Client einen **Surface-Shadow**: die letzte
Version jedes Felds, die nachweislich auf der Oberfläche angekommen ist, von der
Obsidians Save stammt.

```text
View OFFEN        shadow[field] ← Wert bei erfolgreichem Apply in den Live-View
                                   (das existierende canvasApplied, erweitert
                                   auf Feld-Granularität)
                  shadow[field] ← Wert bei Capture eines lokalen User-Edits
                                   (der User hat ihn gesehen, er stammt von ihm)
View GESCHLOSSEN  shadow        ← Inhalt des letzten Persistence-Writes
                                   (ohne View ist Disk die einzige Oberfläche,
                                   und dort existiert das Staleness-Problem
                                   nicht — Obsidian saved geschlossene
                                   Canvases nicht)
```

## Die Diff-Regel

Bei jedem Obsidian-Save (`vault modify`, owned, nicht gemutet):

```text
für jedes Feld f jedes Records r in next = parse(save):
  next[f] == shadow[f]                     → kein Intent. IGNORIEREN.
                                             (Auch wenn CRDT[f] ≠ shadow[f]:
                                             das ist Staleness des Views, der
                                             Reconciler holt den View ab —
                                             NICHT der Capture-Pfad das CRDT.)
  next[f] ≠ shadow[f]                      → Intent. Upsert ins CRDT (I7),
                                             shadow[f] := next[f].
  r fehlt in next, existiert im shadow     → NUR wenn der View offen ist UND r
                                             im letzten Apply an den View
                                             übergeben wurde: Delete-Intent →
                                             Tombstone. Sonst: ignorieren
                                             (Obsidian kann einen Record nicht
                                             gelöscht haben, den es nie hatte).
  r existiert in next, id ∈ deleted(on)    → Resurrect-Sperre: ignorieren,
                                             Reconcile entfernt ihn aus dem View.
```

Warum das die Kaskade tötet: In Schritt 4 des Symptom-2-Ablaufs ist Bs Feld im
Obsidian-Save gleich dem Shadow (der View hat Bs Änderung nie bekommen, also
serialisiert Obsidian exakt den Shadow-Stand) → kein Intent → nichts wird
gepusht → Schritt 5 existiert nicht. Die Staleness bleibt ein lokales
View-Problem und wird vom Reconciler behoben, statt in den geteilten Zustand zu
lecken. Genau die Trennung, die I3 („DOC IS TRUTH — view und file sind
Projektionen") schon behauptet, aber der Capture-Pfad bislang unterlief.

## Das ABA-Restrisiko, benannt

Setzt der User ein Feld absichtlich exakt auf den Shadow-Wert zurück, während
das CRDT remote weitergezogen ist, wird dieser eine Edit als Staleness
verworfen; der Reconciler zeigt dem User den Remote-Wert, und sein zweiter
Versuch (jetzt gegen aktualisierten Shadow) greift. Ein sichtbarer,
selbstkorrigierender Einzelfall-Verlust gegen eine unsichtbare, sich
aufschaukelnde Korruptionskaskade — dieser Tausch ist der Kern des Fixes und
wird bewusst eingegangen. (Zum Vergleich: LWW verliert dieselbe Klasse Edits
lautlos und dauerhaft.)

## Zwei Quellen, eine Senke

Die Adapter-Op-Capture (heute Flag OFF wegen R1) wird unter I7/I8 reparabel:
Captures emittieren nur beobachtete Felder als Upserts auf atomare Register;
`writeRecordMinimal`s Löschverhalten entfällt ersatzlos (Löschen nur via
explizitem Delete-Trigger → Tombstone). Sie wird damit zur **primären,
latenzarmen Quelle** (Origin `CAPTURE_OP`), und der Shadow-Diff auf
Obsidian-Saves wird zum **Sicherheitsnetz** (Origin `CAPTURE_NET`), das alles
auffängt, was die gepatchten Signale nicht abdecken (Paste, unbekannte
Interaktionen, R2-Unsicherheit über `CAPTURE_TRIGGERS`). Beide advancen den
Shadow; Dedup ist damit strukturell (die zweite Quelle sieht keinen Diff mehr).
Bis die Op-Capture behavioral verifiziert ist (Teil 14), trägt das Netz allein —
V2 funktioniert vollständig ohne private API auf dem Capture-Pfad.

---

# Teil 6 — Reconcile V2

Der Kern (`planReconcile` als pure function, Klassifikation gegen den Shadow,
Nodes vor Edges, Geometrie-Eskalation für Edge-Endpoints) bleibt. Vier
Änderungen:

1. **Feld-genauer Shadow.** `canvasApplied` wird vom Record-Snapshot zum
   Feld-Shadow aus Teil 5 — dieselbe Struktur dient Reconcile-Klassifikation und
   Capture-Basis. Eine Wahrheit, zwei Konsumenten, keine Drift zwischen beiden.
2. **`isBusy()` erweitert um Text-Editing.** Ein strukturelles Reload, während
   der User in einer Karte tippt, zerstört Fokus und Editor-Zustand. Der
   Busy-Prädikat erhält „inline editor focused" als Signal; strukturelle Applies
   für den *editierten* Node werden deferred (Queue, Apply bei Blur), Applies
   für andere Records laufen weiter. Remote-`Y.Text`-Änderungen am gerade
   editierten Node werden ebenfalls bei Blur gemerged (Yjs merged
   positionskorrekt nach; das ist der ehrliche Kompromiss, solange kein Binding
   in Obsidians privaten Inline-Editor existiert — als Stretch-Goal unter I5
   notiert, Degradation ist Blur-Merge statt Feature-Bruch).
3. **Apply-Quittung pro Feld.** Der Shadow advanced pro Feld nur bei bestätigtem
   Apply (heutige Regel, feiner granuliert). Ein `"interacting"`-Skip lässt exakt
   die Felder des einen Nodes offen statt des ganzen Applies.
4. **Degradierter Modus ist ehrlich.** Ist die private API weg (A.3/31), wird der
   offene View als „nicht reconcilierbar" markiert: Banner im View („Live-Ansicht
   pausiert — Datei ist synchron, Ansicht aktualisiert beim Neuöffnen"), Capture
   läuft weiter über das Netz (der Shadow schützt vor Stale-Pushes — die heutige
   strukturelle Revert-Maschine dieses Modus ist damit entschärft), und beim
   nächsten Öffnen zieht ein `initial`-Reconcile den View nach. „Degrade, never
   break" (I5) gilt damit erstmals auch für die Korrektheit, nicht nur für die
   Verfügbarkeit.

---

# Teil 7 — Persistenz und Sitzungen: dauerhafte CRDT-Historie

## Das Sidecar-Log (schließt W4)

Pro Canvas-Doc führt der Client ein Append-Log der Yjs-Updates außerhalb des
geteilten Vault-Scopes:

```text
.obsidian/liveshare/state/<guid>.yhistory     append-only: jedes lokale und
                                              remote Update (encodeUpdate)
.obsidian/liveshare/state/<guid>.ycheckpoint  periodische Kompaktion:
                                              encodeStateAsUpdate(doc); danach
                                              wird .yhistory truncated
index.json                                     path → guid → epoch Mapping
```

- **Ausgeschlossen aus Manifest und Sync** (die Dateien sind lokale
  Replikat-Zustände, keine geteilten Inhalte) und aus jeder Text-Sync-Erkennung.
- Beim Subscribe: Sidecar laden → das Doc hat seine volle kausale Historie →
  der Sync mit Peers ist ein normaler Update-Austausch zwischen *verwandten*
  Replikaten. `coldOpen` seedet nur noch, wenn **weder** Sidecar **noch**
  irgendein Peer das Doc kennt — einmal im Leben des Docs (I9).
- Kompaktion nutzt Yjs' eingebautes GC (Inhalte gelöschter Items werden
  verworfen, Struktur-Tombstones bleiben klein) plus die Tombstone-GC aus
  Teil 4. Bei Canvas-Skalen (10²–10³ Records) ist Wachstum kein Thema; die
  Kompaktionsperiode ist ein Tunable, kein Risiko.
- **Korruptes/fehlendes Sidecar** ist der definierte Degradationsfall: Client
  verhält sich wie ein frischer Peer (holt Zustand von Peers; sind keine da,
  greift die Epoch-Regel unten). Nie schlimmer als der heutige Normalfall.

## Doc-Identität: GUID + Epoch (schließt R4 und das Rename-Loch)

Die Doc-ID wird `__canvas__:<guid>`; der Pfad ist ein Attribut in `meta` und im
Manifest (`path → guid`). Konsequenzen:

- **Rename mid-session** ist ein Metadaten-Update statt eines
  Identitätswechsels — das bisher unbehandelte Loch (Doc-ID = Pfad → Rename
  hätte ein verwaistes Doc plus ein leeres neues erzeugt) verschwindet
  strukturell.
- **`meta.epoch`** (monoton, host-inkrementiert) markiert bewusste Neuaufsetzung.
  Treffen zwei Replikate mit gleicher GUID aber verschiedener Epoch aufeinander,
  gewinnt die höhere Epoch vollständig, und der Verlierer archiviert seinen
  Stand als lokale Konfliktkopie (`<name>.conflict-<datum>.canvas`) statt still
  zu mergen oder still zu verlieren. Unverwandte Historien werden damit
  *erkannt* statt zusammengeworfen — die Divergenzklasse aus W4 wird von
  „lautlos" zu „benannt und archiviert".
- **Host-Rejoin** (R4): `applyCanvasToYMaps` mit Destruktiv-Semantik entfällt.
  Ein Host, der zurückkommt, ist ein Replikat wie jedes andere: Sidecar laden,
  mergen. Will der Host explizit „meine Datei soll gelten", gibt es dafür den
  benannten Befehl **„Aus Datei importieren"** (I9): epoch++, Datei seeden,
  Peers folgen der Epoch-Regel — mit Bestätigungsdialog, der sagt, wessen
  Arbeit das überschreibt. Destruktion wird von einem Timing-Nebeneffekt zu
  einer informierten Entscheidung.

## Relay-Persistenz (optional, E2E-kompatibel)

Der Relay bleibt content-blind, bekommt aber pro `roomId:docId` einen
Blob-Store: eingehende `MUX_SYNC`-Frames (auch verschlüsselte — der Relay
speichert Ciphertext, ohne ihn zu verstehen) werden appended und einem später
Subscribenden vor dem Live-Verkehr replayed; ein Client-gesendeter
Checkpoint-Frame (voller State als ein Update) erlaubt Truncation. Damit
überlebt ein Raum die Abwesenheit aller Peers, ohne die
Vertrauensarchitektur zu ändern (der Relay kann weiterhin nichts lesen, nur
speichern und wiederholen — Replays sind idempotente, kommutative
Update-Zustellung, also per CRDT-Definition harmlos in jeder Reihenfolge und
Häufigkeit). Das Sidecar allein deckt „wiederkehrender Client" ab;
Relay-Persistenz deckt zusätzlich „völlig neuer Client betritt leeren Raum" ab.
Beides komponiert, keines ist Voraussetzung des anderen.

---

# Teil 8 — Ownership-Konsens und Degradation ohne Fork (schließt W5)

Der Sync-Modus pro Pfad wird geteilter, host-autorisierter Zustand (im
Manifest-Doc: `path → {mode: "canvas" | "text", guid}`). Alle Clients folgen ihm;
niemand entscheidet lokal einen anderen Modus.

Der R10-Text-Fallback **entfällt ersatzlos**. Ein Client, der den Canvas-Modus
für einen Pfad nicht erfüllen kann (waitForSync-Timeout, Doc-Fehler),
degradiert zu **Receive-and-Persist**: Er subscribed das Canvas-Doc weiter
lesend, `CanvasPersistence` schreibt weiter auf Disk (das braucht keinerlei
private API und keinen Capture), lokale Edits an diesem Pfad werden mit Notice
abgewiesen bzw. beim nächsten Persistence-Write überschrieben, und ein Retry
versucht periodisch den Vollmodus. Damit ist der schlechteste Fall „ein Client
ist vorübergehend read-only für eine Datei" statt „zwei unverwandte CRDTs
schreiben dieselbe Datei auf verschiedenen Rechnern". R6 (verwaistes `Y.Text`
nach Fallback-Handover) verschwindet mit dem Fallback; `skipsAutoTextSync`
verliert seinen vierten Konsumenten und die Tür, die `BackgroundSync.subscribe`
bewusst offen ließ, wird zugemauert.

---

# Teil 9 — Locks, Presence, Undo

**Locks werden reine UX** (schließt W6). Sie bleiben in Awareness (die
Cannot-Strand-Eigenschaft ist richtig und bleibt), sie färben weiter Ringe und
treiben den Loser-Revert der *Ansicht* — aber der Daten-Seam
(`canWriteEntity`, Baseline-Hold bei Denial, Endpoint-Doppelprüfung) entfällt.
Konflikte am selben Register löst das Datenmodell per atomarem LWW (Teil 4);
der Lock reduziert nur die Häufigkeit, in der zwei Personen dasselbe Register
gleichzeitig anfassen. R7 (Lock-Epoch) wird damit gegenstandslos: Es gibt keine
Write-Berechtigung mehr, die ein Epoch schützen müsste. Die
Awareness-Liveness-Maschinerie (Deadline-Pulse, Reconnect-Reclaim-Defer) bleibt
unverändert — sie ist korrekt und getestet.

**Presence** bleibt strikt ephemer (Cursor in Canvas-Koordinaten, getrennter
Kanal) — das entspricht bereits dem Stand der Technik aus der Recherche
(Awareness-Trennung bei Yjs/tldraw/Excalidraw) und wird nicht angefasst.

**Undo** wird explizit: ein `Y.UndoManager` pro Client und Canvas-Doc mit
`trackedOrigins = {CAPTURE_OP, CAPTURE_NET}` — selektives Per-Client-Undo
(Stewen & Kleppmann 2024; Yjs-Modell aus der Recherche): Strg+Z macht die
eigene letzte Aktion rückgängig, nie die eines Peers, auch wenn dessen Edit
zeitlich dazwischen lag. Delete-Undo funktioniert über das Tombstone-Flag
(`on:false`, Teil 4) verlustfrei. `captureTimeout` bündelt Drag-Bursts zu einem
Undo-Schritt; Multi-Node-Drags sind ohnehin eine Transaktion (Teil 4). Der
UndoManager operiert auf CRDT-Ebene und ersetzt Obsidians dateibasiertes Undo
für owned Canvases — der Reconciler projiziert das Ergebnis in den View wie
jedes Remote-Delta.

---

# Teil 10 — Serialisierung: kanonisch und deterministisch (schließt W7, entlastet W9)

`buildCanvasData` V2 erzeugt aus demselben Doc-Zustand auf jedem Client
byte-identische Dateien:

```text
Nodes und Edges sortiert nach (ord, id)         → stabile Z-Ordnung, stabile Diffs
Objekt-Keys in Obsidian-kanonischer Reihenfolge → id, type, pos→x/y, size→width/height, …
Zahlen im Obsidian-Format                       → Ganzzahlen ohne Nachkommastellen;
                                                  Capture rundet Geometrie auf ganze
                                                  Pixel VOR dem Register-Write, damit
                                                  Rundung nie als Intent erscheint
CRDT-interne Felder expandiert                  → pos/size/from/to zurück in das
                                                  exakte Obsidian-Schema; ord wird
                                                  NICHT in die Datei geschrieben
                                                  (reine Array-Reihenfolge trägt sie)
```

Konsequenzen: Der semantische Echo-Breaker wird in der Praxis zur
Byte-Gleichheit (billiger, schärfer); Vault-Git-Diffs werden minimal;
Obsidian-Normalisierungs-Pingpong (W9) verliert seinen Treibstoff, weil beide
Clients identisch serialisieren und Capture-seitig identisch runden. Die
Reihenfolge-Erfassung aus Obsidian-Saves ist bewusst konservativ: `ord` ändert
sich nur, wenn sich die *relative* Reihenfolge existierender IDs im Save
nachweislich geändert hat (minimale Fractional-Reassignments); bloßes Anhängen
neuer Records vergibt neue `ord`-Werte am Ende. (Ob Obsidian Z-Ordnung aktiv
umsortiert, ist unbestätigt — R2-Klasse; die konservative Regel ist unter beiden
Antworten korrekt.)

---

# Teil 11 — Validierung, Quarantäne, Selbstreparatur (schließt W3)

**Ingest-Schema.** Eine einzige Validierungsfunktion an jeder Schreibgrenze des
Docs (Seed, `CAPTURE_OP`, `CAPTURE_NET`, Import):

```text
Node  gültig ⟺ id ∧ type ∧ pos ∧ size ∧ typspezifisch (file→file, text→text, …)
Edge  gültig ⟺ id ∧ from.node ∧ to.node
```

Ungültige Records aus lokalen Quellen werden **abgewiesen** (mit Signatur) —
sie entstehen dann gar nicht erst im geteilten Zustand. Remote-Deltas werden
nicht abgewiesen (das würde Divergenz erzeugen: Replikat A akzeptiert, B
lehnt ab), sondern vom nächsten Punkt behandelt:

**Auditor mit Reparatur statt Detektion.** Der bestehende `auditCanvasState`
wird von „warnen" auf „reparieren" gehoben: Ein Record, der im Doc gegen das
Schema verstößt (die heutige A.2/16-Klasse), wird per Tombstone in
**Quarantäne** gesetzt (`deleted[id] = {on:true, q:true}`) — nie serialisiert,
nie gerendert, aber nicht zerstört (die Feldcontainer bleiben; stellt ein
späteres Delta die fehlenden Felder wieder her, hebt der Auditor die Quarantäne
auf: `on:false`). Die Operation ist idempotent und LWW-konvergent, mehrere
Clients dürfen sie gleichzeitig ausführen. Damit erreicht ein endpunktloser
Pfeil nie wieder eine Disk und Obsidians Silent-Drop-Kaskade (A.2/17) verliert
ihren Auslöser — und zwar auch dann, wenn der Verursacher ein alter Client oder
ein Bug ist, den V2 nicht vorhergesehen hat. Selbstheilung statt Signatur.

**`PROTECTED_KEYS` bleibt** als letzte Verteidigungslinie erhalten (Defense in
depth ist billig), trägt aber keine Korrektheitslast mehr: I7 (Beobachtung
löscht nie) macht den Angriffsvektor — Key-Löschung durch partielle Reads —
strukturell unmöglich, statt ihn aufzuzählen.

---

# Teil 12 — Edge-Case-Matrix: alt gegen neu

## Die gemeldeten Symptome

| Symptom | Ursache (W#) | V2-Mechanismus | Verhalten nachher |
|---|---|---|---|
| Nodes „schweben" losgelöst von Pfeilen | W2 (torn writes), W6 (Lock als Krücke) | atomare `pos`/`size`/`from`/`to`-Register | konkurrierender Move → sichtbarer Einmal-Sprung auf einen *echten* Zustand; Chimären-Positionen unmöglich |
| Pfeile optisch losgelöst trotz korrekter Daten | 1b (Rerouting-Eskalations-Lücken) | Eskalationsregel bleibt; degradierter Modus ehrlich (Teil 6.4) statt still stale | View-Lag ist sichtbar gebannert und heilt beim Neuöffnen; leckt nie mehr in den geteilten Zustand |
| Endpunktlose Edges auf Disk, Obsidian droppt still | W3 (A.2/16) | Ingest-Schema + Quarantäne-Auditor | strukturell unerreichbar; Bestand wird selbstgeheilt |
| „Zerhackt" nach Offscreen-Nachladen, dann Kaskade zum Peer | W1 + W9 | Shadow-Diff (I6) + kanonische Serialisierung | Stale-Save wird als Staleness erkannt und ignoriert; Kaskade endet bei Hop 0 |
| Gegenseitiges Normalisierungs-Pingpong | W9 | kanonische Serialisierung + Capture-Rundung | beide Clients erzeugen identische Bytes; nichts zu pingen |
| Konkurrierendes Tippen in einer Karte verliert eine Seite | W8 | `Y.Text` pro Text-Feld, Merge bei Blur | zeichenweiser Merge; kein Totalverlust mehr |
| Session-Neustart/Host-Rejoin verwirft Peer-Arbeit | W4 (R4) | Sidecar-Historie + GUID/Epoch + expliziter Import | Rejoin = Merge verwandter Replikate; Überschreiben nur als benannte, bestätigte Aktion |
| Voll-Desync einzelner Clients (Text-Fallback-Fork) | W5 | Modus-Konsens + Receive-and-Persist | schlimmster Fall: temporär read-only, nie zwei Wahrheiten |

## Der bestehende Katalog (Appendix A) unter V2

Unverändert gültig (Mechanismus bleibt): A.1/3, A.1/5–8, A.2/9, A.2/19–21,
A.2/23–24, A.3/25–31, A.4/33–38, A.5/40–46, A.6/47–56, A.7/57–64, A.8/65–69.

Verändert oder gegenstandslos:

| Alt | Neu |
|---|---|
| A.1/1–2, A.1/4 (Seed-/doc-wins-Choreografie) | nur noch beim allerersten Seed eines Doc-Lebens relevant (I9); danach ersetzt „Sidecar laden + mergen" die gesamte Fallunterscheidung |
| A.2/10 (gleiche Karte, Lock entscheidet) | Lock ist UX; Daten entscheidet atomarer LWW. Kein Baseline-Hold, kein Revert-Rollback-Tanz — Verlierer sieht einen Sprung |
| A.2/11 (Delete vs. Edit) | identische Semantik, neuer Mechanismus: Tombstone-Flag statt Diff-Logik; zusätzlich Undo-fähig |
| A.2/13–14 (Lock-Denial-Familie) | entfällt mit dem Daten-Seam (W6) |
| A.2/15–18 (Protected Keys / Key-Verlust) | I7 + Ingest-Schema + Quarantäne; aus Detektion wird Unmöglichkeit bzw. Reparatur |
| A.2/22 (structural via Shadow) | bleibt, jetzt feld-genau (Teil 6.1) |
| A.4/39 / R7 (Lock-Epoch) | gegenstandslos (Locks tragen keine Schreibrechte mehr) |
| A.3/32 / R10 (Text-Fallback) | entfällt; ersetzt durch Receive-and-Persist (Teil 8) |
| R1 (`useCanvasBinding`) | Capture-Kontrakt unter I7/I8 neu; Aktivierung erst nach Phase 5 + E2E-Verifikation |
| R4 (destruktiver Host-Reseed) | entfällt; expliziter Import-Befehl |
| R5 (unguarded `getDoc`) | GUID-Namensraum entschärft die Verwechslung strukturell (`__canvas__:<guid>` kollidiert mit keinem Pfad); die zwei Call-Sites werden trotzdem gefixt |
| R6 (verwaistes `Y.Text`) | entfällt mit dem Fallback |

## Neue Edge-Cases, die V2 selbst einführt (ehrliche Rechnung)

| Fall | Verhalten |
|---|---|
| ABA am Shadow (User setzt Feld exakt auf Shadow-Wert zurück, CRDT ist remote weiter) | Edit wird als Staleness verworfen, View zeigt Remote-Wert, zweiter Versuch greift. Sichtbar, selbstkorrigierend (Teil 5) |
| Sidecar korrupt / gelöscht | Client = frischer Peer; Zustand von Peers oder (leer + allein) Epoch-bewusster Seed. Nie schlechter als V1-Normalfall |
| GUID gleich, Epoch verschieden | höhere Epoch gewinnt; Verlierer archiviert Konfliktkopie mit Datum. Lautloser Merge unverwandter Historien ausgeschlossen |
| `index.json` und Vault divergieren (Pfad existiert, GUID-Mapping fehlt) | wie „neues Doc": Peers fragen (Manifest trägt path→guid); nur wenn niemand die GUID kennt, wird geseedet |
| Remote-Text-Merge bei Blur überrascht den Tipper | akzeptierter Kompromiss; Lock-Ring an der Karte signalisiert die Ko-Editierung vorher. Stretch: Inline-Editor-Binding (I5-Degradation dokumentiert) |
| Quarantäne-Aufhebung race (Delta stellt Felder wieder her, während zwei Auditoren quarantänisieren) | alle Operationen sind LWW auf `deleted[id]`; letzte Entscheidung gewinnt konvergent, Auditor läuft periodisch → Endzustand korrekt |
| Gemischte Plugin-Versionen im Raum | `meta.schemaVersion`; ein Client mit fremder Major-Version geht in Receive-and-Persist statt zu raten (die tldraw-Lektion aus der Recherche: Schema-Versionierung von Tag eins) |
| Zwei Clients vergeben `ord` zwischen denselben Nachbarn | Jitter + clientID-Suffix → verschiedene Strings, totale Ordnung, deterministisch identische Serialisierung |

---

# Teil 13 — Migrationspfad in sechs Phasen

Jede Phase ist einzeln shipbar, einzeln testbar und lässt das System in einem
besseren Zustand zurück als davor. Reihenfolge nach Symptomdruck.

```text
P0  Shadow-Diff + kanonische Serialisierung           (W1, W9)   kein Formatwechsel
    └─ reine Logikänderung in Capture/Serializer; tötet die gemeldete
       Kaskade. Messbar: die Revert-Signaturen und der Disk-Churn müssen
       gegen null gehen.
P1  Datenmodell V2                                    (W2,W3,W7) meta.schemaVersion = 2
    └─ atomare Register, ord, Tombstone-Map, Ingest-Schema, Quarantäne-
       Auditor. Formatwechsel im Doc (nicht in der .canvas-Datei!);
       Mixed-Version-Regel aus Teil 12 gilt ab hier.
P2  Sidecar + GUID/Epoch + expliziter Import          (W4, R4, R5, Rename-Loch)
P3  Modus-Konsens + Receive-and-Persist               (W5, R6, R10-Tür)
P4  Y.Text für Node-Text + Blur-Merge + Undo-Manager  (W8)
P5  Op-Capture als Primärquelle                       (R1-Kontrakt neu)
    └─ erst NACH bestandener E2E-Verifikation der CAPTURE_TRIGGERS (R2);
       bis dahin trägt das Shadow-Netz allein — vollwertig, nur latenter.
P6  Relay-Blob-Persistenz                             (optional; leerer-Raum-Fall)
```

P0 zuerst ist die zentrale Entscheidung: Es ist die kleinste Änderung mit dem
größten Bezug zu den gemeldeten Symptomen, sie benötigt keinen Formatwechsel,
und sie ist vollständig headless testbar (der Shadow-Diff ist eine pure
function über drei Zustände).

---

# Teil 14 — Teststrategie (schließt W10)

Die bestehende Suite (pure functions, injizierte Seams, Discrimination-Tests)
bleibt das Fundament. Drei Ergänzungen, ohne die V2 nicht „bulletproof" genannt
werden darf:

**1. Konvergenz-Fuzzer (property-based).** N simulierte Replikate (3–5, nicht
2 — Interleaving-Klassen ab drei Peers sind nachweislich eigene), zufällige
Op-Sequenzen aus dem vollen Vokabular (create/move/resize/reroute/relabel/
delete/undo/reorder/text-edit), zufällige Partitionen, Reordering und
Duplikation der Deltas, zufällige Obsidian-Save-Simulationen mit absichtlich
stalem View-Modell. Nach Quieszenz asserted der Fuzzer auf **jedem** Replikat:
identischer Doc-Zustand (SEC), Schema-Invarianten (keine endpunktlose Edge,
kein Record ohne pos), identische kanonische Serialisierung (Byte-Gleichheit),
und Shadow-Konsistenz (kein Replikat hat je ein Stale-Feld gepusht — das ist
die W1-Diskriminante). Jeder gefundene Fall wird als benannter
Regressionstest eingefroren. Das ist die ∀-Prüfung, die Beispieltests
prinzipiell nicht leisten (W10) und die Methode, mit der die Literatur ihre
Gegenbeispiele fand.

**2. Der E2E-Rig wird Pflicht-Gate.** `tools/launch_liveshare_e2e.py` existiert
und lief nie (R2). Ab P0 ist ein grüner Zwei-Vault-Lauf mit echtem Obsidian
Release-Bedingung; ab P5 zusätzlich die empirische Bestätigung jeder einzelnen
`CAPTURE_TRIGGERS`-Annahme (Move, jeder Resize-Handle, Multi-Select-Drag,
Paste, Text-Edit, Node/Edge-Add/Delete) gegen die live gepatchten Signale. Eine
Architektur, deren kritischste Konstante „inferiert" ist, hat ihre
Verifikationsschuld an der teuersten Stelle.

**3. Chaos-Szenarien als benannte Suiten.** Die Symptom-Trigger dieses Berichts
als reproduzierbare Fälle: „View-Apply künstlich verzögert + Obsidian-Save"
(die Kaskade), „Adapter unavailable + offener View + Remote-Deltas" (der
degradierte Modus), „Host-Rejoin mit älterem Sidecar", „Fallback-Client neben
Owned-Client" (muss nach P3 unmöglich, davor erkannt sein). Jede Suite enthält
ihre Discrimination-Variante: Fix entfernen → Test muss rot werden — das
wertvollste Muster der bestehenden Suite, konsequent auf die neuen Mechanismen
angewandt.

---

# Teil 15 — Bewusst offene Restrisiken

Vollständigkeit verlangt, zu sagen, was V2 *nicht* löst:

1. **LWW verliert Intent am selben Register.** Zwei gleichzeitige Moves
   derselben Karte: einer gewinnt ganz. Das ist die bewusste Figma-Position;
   die Alternative (Intent-Bewahrung durch Transformation) ist für
   Canvas-Geometrie theoretisch unfundiert und praktisch die Quelle der
   Chimären, die V2 gerade abschafft.
2. **Kein Echtzeit-Co-Typing in derselben Karte.** Blur-Merge ist der ehrliche
   Stand, solange Obsidians Inline-Editor kein Binding erlaubt. Der Verlust ist
   Latenz der Sichtbarkeit, nie Daten.
3. **Byzantinische Peers sind out of scope.** Alle Teilnehmer sind
   authentifiziert und wohlwollend angenommen; ein bösartiger Client kann den
   geteilten Zustand beschädigen (der Quarantäne-Auditor begrenzt, verhindert
   aber nicht). BFT-CRDTs (Kleppmann 2022, Hash-DAG-Retrofit) sind der
   dokumentierte Pfad, falls die Trust-Annahme je fällt.
4. **Obsidians private API bleibt das fundamentale Risiko.** V2 verkleinert die
   Abhängigkeit (Capture funktioniert vollständig ohne sie; Reconcile
   degradiert ehrlich), aber ein offener View ohne API bleibt eine pausierte
   Ansicht. Das ist die Physik dieses Produkts, keine lösbare Schwachstelle.
5. **Die Datei als Austauschformat mit Nicht-Teilnehmern.** Editiert ein
   Nicht-Session-Tool die `.canvas`-Datei während einer Session, ignoriert I3
   das (file is not an input while owned) — der Edit wird beim nächsten
   Persistence-Write überschrieben. Erkennbar (mtime/Inhalt vor eigenem Write
   prüfen → Notice), aber nicht mergebar, ohne I3 aufzugeben. Dokumentierte
   Grenze.

---

## Schlussbild: die V2-Pipeline auf einen Blick

```text
                       ┌──────────────── SHADOW (feld-genau, pro Oberfläche) ──┐
                       │                                                        │
User-Interaktion ───► Adapter-Ops ───► [Ingest-Schema] ───► Y.Doc ◄── Peers (mux)│
                       ▲   (P5, Upsert-only)             │  ▲                   │
Obsidian requestSave ──┘                                 │  └── Sidecar-Log     │
   │                                                     │      (.yhistory)     │
   └──► parse ──► SHADOW-DIFF (I6) ──► nur echte Intents ─┘                      │
              Staleness: verworfen ──► (Reconciler holt View ab)                 │
                                                         │                       │
                              ┌── Reconciler ───► Live View ── advanced ─────────┤
                              │   (plan gegen Shadow, busy⊃editing)              │
                    Y.Doc ────┤                                                  │
                              └── Serializer (kanonisch, (ord,id)-sortiert)      │
                                       │                                         │
                                  CanvasPersistence ───► Disk ── advanced ───────┘
                                  (einziger Writer, unverändert)
```

Ein Doc, ein Shadow, drei Projektionen (View, Disk, Peers) — und keine
Projektion kann je wieder als Wahrheit missverstanden werden. Das ist die
strukturelle Fassung dessen, was I3 immer behauptet hat, und der Grund, warum
die gemeldeten Symptome in V2 nicht anders auftreten *können*, statt nur
seltener aufzutreten.
