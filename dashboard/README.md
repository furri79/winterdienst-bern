# Meteo Dashboard: Quellcode-Spiegel

Stand: 24. Oktober 2026. Quellcommit der bestehenden Sites-Version: b50be0a470066b59525ddba40f67cf282c0a4960.

Die Anwendung liegt im Unterordner `dashboard/`. Bestehende Dateien im Repository bleiben erhalten. Diese Kopie enthält Frontend, Worker-Backend, Symbole, mitgelieferte Messwertbrücken und Buildskript. Sie enthält keine Laufzeitdaten aus dem R2-Speicher, Benutzerlisten oder konfigurierten Laufzeitgeheimnisse.

## Was funktioniert hier bereits?

Die unveränderte Anwendung verwendet weiterhin die von Sites geprüften ChatGPT-Identitätsheader. Eine Kopie auf GitHub stellt keine eigene Anmeldung bereit. Die bestehende ChatGPT-Seite bleibt erhalten. Es wurde weder eine automatische Synchronisation noch eine zweite Live-Website eingerichtet.

## Build

Mit installiertem Node.js:

```sh
cd dashboard
node scripts/build-worker.cjs
```

Das erzeugt `dist/server/index.js` mit eingebetteten öffentlichen Assets. `.openai/hosting.json` gehört zur vorhandenen Sites-Instanz; die Projekt-ID darf nicht für eine andere Instanz verwendet werden. Keine automatische Veröffentlichung aus dieser Kopie starten.

## Benutzer ohne ChatGPT- oder GitHub-Konto

Für die unabhängige Version sind ein ausführbares Backend-Hosting und eine eigene Authentifizierung nötig. GitHub Pages allein führt dieses Worker-Backend und seine geschützten APIs nicht aus.

Ziel: ausschliesslich Einladungen, E-Mail und Passwort, zeitlich begrenzte Aktivierung, Passwort zurücksetzen, serverseitige Autorisierung aller APIs und Administratorfunktionen. Nur der Hauptadministrator darf Benutzer verwalten. Clientseitige Loginmasken allein schützen die Daten nicht. Die Sites-Identitätsheader dürfen ausserhalb von Sites niemals ungeprüft vom Browser übernommen werden.

Im Administratorenbereich sollen Einladungsdatum, erster erfolgreicher Login (einmalig) und letzter erfolgreicher Login stehen. Speicherung serverseitig in UTC, Anzeige in Europe/Zurich. Diese Authentifizierung und Login-Protokollierung sind in diesem Spiegel noch nicht implementiert.

Vor dem zweiten Livebetrieb: Hosting und Mail-/Anmeldedienst auswählen, Geheimnisse ausschliesslich im Server konfigurieren, Speicher anbinden, Zugangsschutz und Einladungsablauf testen. Keine bestehenden Zugangsschranken für eine Vorschau entfernen.
