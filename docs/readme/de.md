# md2chat — Markdown für Chats

[简体中文](../../README.md) · [English](en.md) · [Español](es.md) · [Português](pt-BR.md) · [日本語](ja.md) · [한국어](ko.md) · [Deutsch](de.md) · [Français](fr.md) · [हिन्दी](hi.md)

<!-- language: de; source-sha256: f9bf7ac13d2bff3b856579f2a096a2455518b890f1b2c70cfee24041b9349d15 -->

Wandelt Markdown aus KI-Werkzeugen oder eigenen Dokumenten in Text und Bilder für Chats um. Normaler Text bleibt bearbeitbar; Tabellen, Code, Formeln und Mermaid-Diagramme werden zu Bildern in der ursprünglichen Reihenfolge. Aufgabenlisten verwenden ✅ / ⬜. Namen von KI-Werkzeugen bezeichnen mögliche Inhaltsquellen, keine offiziellen Integrationen oder nachgewiesene Kompatibilität.

[Website](https://forgeturl.github.io/md2chat/de/) · [Web-Editor](https://forgeturl.github.io/md2chat/editor.html?lang=de) · [Neueste Version](https://github.com/forgeturl/md2chat/releases/latest) · [Kompatibilitätsnachweise](../compatibility.md)

![Desktop-Vorschau](../desktop-preview.png)

## Download

- [macOS Universal-DMG — Apple Silicon und Intel](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-mac-universal.dmg)
- [Windows-x64-Installer — Intel und AMD](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-windows-x64-setup.exe)
- [SHA256-Prüfsummen](https://github.com/forgeturl/md2chat/releases/latest/download/SHA256SUMS.txt)

Die Links führen immer zur neuesten Veröffentlichung. Für die normale Mac-Installation dient das DMG; `.app.tar.gz` ist für Updates in der App. Ein natives Windows-ARM-Paket gibt es nicht. Desktop verwendet Tauri 2, Rust und die System-WebView, ohne Electron oder Node.js mitzuliefern. Unter Windows lädt der Installer WebView2 bei Bedarf herunter. Offizielle Mac-Pakete benötigen Developer-ID-Signatur und Notarisierung; Windows verwendet derzeit keine Authenticode-Signatur. Alte Electron-Installationen werden nicht automatisch migriert.

## Verwendung

Links Markdown, Text oder Bilder einfügen, die Vorschau prüfen, ein Ziel wählen und dort einfügen. Leeren beginnt ein neues Dokument. Im Web ist das Kopieren für DingTalk und Feishu deaktiviert; dafür bitte die Desktop-App nutzen.

- **WeChat:** Standardtext und Bilder; prüfen, ob alle Bilder erhalten bleiben.
- **DingTalk:** natives Format auf dem Mac, HTML und Klartext-Ersatz unter Windows. Historische Mac-Tests bestätigen nicht sämtliche aktuellen Versionen; Windows muss im Zielprogramm geprüft werden.
- **Feishu/Lark:** auf dem Mac zuerst die Rich-Text-Eingabe erweitern. Gemischter Text mit Bildern und Versand wurden auf dem Mac geprüft; Windows bleibt experimentell.
- **WeCom:** Mac und Windows fügen Text und Bilder zusammen ein; im Web werden Abschnitte nacheinander eingefügt. Formatproben mit Windows 5.0.12.6018 behielten zwei Bilder, Chinesisch und Nummern, entfernten aber Fettdruck, Schriftgrößen und Farben. Die Proben bestanden auch den Sendetest im Dateiübertragungsassistenten; der neue Windows-Build ist noch zu prüfen.
- **E-Mail:** bearbeitbare HTML-Tabellen, komplexe Inhalte als Bilder. Experimentell: Bilder nach Einfügen und Versand prüfen.

Desktop kann das gesamte Dokument in ein weißes PNG umwandeln. Text darin ist nicht bearbeitbar. Lange Inhalte werden gegebenenfalls verkleinert oder bei überschrittenen Grenzen abgelehnt. Ändert sich die Zwischenablage währenddessen, bleiben neue Inhalte erhalten und eine Wiederholung wird angeboten. Lokale absolute Bildpfade und `file:///` werden nach Prüfung unterstützt: PNG, JPEG, GIF, WebP oder BMP, höchstens 10 MB und 20 Millionen Pixel je Bild. Im Web Bilder direkt einfügen. Nachrichten werden niemals automatisch versendet.

## Infobereich und Tastenkürzel

Über Mac-Menüleiste oder Windows-Infobereich lassen sich Zwischenablageinhalte ohne Änderung des Editors konvertieren, Fenster und Einstellungen öffnen, Updates prüfen oder die App vollständig beenden. Schließen eines Fensters behält Prozess und Eingabe im Speicher. Einstellungen erlauben angeheftete, sortierte Formate, Login-Start und globale Konvertierungskürzel. Kürzel und Autostart müssen ausdrücklich aktiviert werden; auf dem Mac muss die App unter Programme installiert sein. Windows-Infobereich und Autostart benötigen noch reale Geräteprüfung.

## Sprachen und Updates

Oberfläche, integrierte Beispiele, Website, README und Update-Zusammenfassungen unterstützen neun Sprachen. Das Globusmenü zeigt die Eigennamen. Unveränderte Beispiele folgen der Sprachwahl; nach Bearbeiten, Einfügen, Ablegen oder Leeren bleiben Nutzerinhalte erhalten, auch nach Rückgängig.

Zusammenfassungen zeigen die veröffentlichten Versionen zwischen installierter und Zielversion. Die neuesten drei erscheinen zuerst, ältere lassen sich aufklappen; wichtige Hinweise bleiben sichtbar. Technische Details behalten ihre Originalsprache. Updates werden nach dem Start und alle sechs Stunden geprüft. Download und Neustart erfordern eine Nutzeraktion. Eingaben vor der Installation speichern. Alte Clients erhalten die neue Oberfläche nach Installation einer entsprechenden Version; tatsächliche Versionswechsel benötigen Tests mit signierten Paketen.

## Datenschutz und Diagnose

Kein Konto und kein Hochladen von Inhalten an einen md2chat-Dienst. Die Konvertierung erfolgt lokal. Externe Bilder kontaktieren ihren Ursprung; Desktop kann Bilder für späteres Einfügen lokal zwischenspeichern. Eingaben werden nicht dauerhaft gespeichert und gehen bei vollständigem Beenden oder Neuladen verloren.

Die Diagnose liest nur auf Anforderung. Exportierte ZIP-Dateien enthalten Originaldaten, Text, Bilder, Links und möglicherweise private Formate: vor dem Teilen prüfen. Schließen löscht die Probe; kein automatischer Upload. Der Issue-Link öffnet GitHub zum manuellen Anhängen der ZIP-Datei. Update-Anfragen enthalten keine Dokumentinhalte.

## Entwicklung

Node.js 22.12+ und Rust 1.90+. Mac benötigt Xcode Command Line Tools, Windows Visual-Studio-C++-Werkzeuge und WebView2. Pakete auf dem jeweiligen Betriebssystem bauen. Offizielle Mac-DMGs benötigen zusätzlich Python 3.10+ und die per Hash festgelegten Abhängigkeiten in `scripts/dmgbuild-requirements.txt`.

```sh
npm ci
npm run dev
npm run desktop
npm run check
npm run build
npm run desktop:test
npm run desktop:test:render
npm run desktop:test:native
npm run desktop:test:windows
npm run desktop:dist:mac
npm run desktop:dist:win
```

Native Tests ersetzen kurzzeitig die Zwischenablage und stellen sie wieder her; nur ausführen, wenn sie nicht genutzt wird. Web- und Formattests ersetzen keine Prüfung im echten Chat-Client. Nur gebündelte lokale Seiten dürfen die eingeschränkten Desktop-Befehle aufrufen; die WebView stellt Node.js nicht bereit.

## Mitwirken und Veröffentlichen

Bei sichtbaren Änderungen alle neun Sprachen nach den [Lokalisierungsregeln](../localization.md) synchronisieren. Nach Seiten- oder Asset-Änderungen `npm run seo:generate`, vor Commits `npm run check` ausführen. Sprachseiten liegen gesammelt unter `site/locales/`; öffentliche URLs bleiben erhalten. Dieses Verzeichnis enthält acht README-Übersetzungen, die Stammdatei ist Chinesisch. Technische Nachweise dürfen in ihrer Originalsprache bleiben.

Detaillierte Hinweise und eine Zusammenfassung in neun Sprachen vorbereiten:

```sh
npm run release:prepare -- patch --notes-file /tmp/md2chat-release-notes.md --summary-file /tmp/md2chat-update-summary.json
npm run release:verify -- --tag vX.Y.Z
```

Dateien prüfen, Tests ausführen und `npm run release:verify -- --tag vX.Y.Z` starten. Vorbereitung erstellt keinen Commit und veröffentlicht nichts. Nur ein ausdrücklicher Veröffentlichungsauftrag erlaubt das Erstellen und Pushen des Versionstags. Main/PR veröffentlichen nicht; die Website hat einen eigenen Bereitstellungsablauf. Offizielle Releases prüfen Pakete und Signaturen, veröffentlichen GitHub Release und danach die passende Website. Manuelle Desktop-Läufe erzeugen nur Testpakete ohne App-Updates oder Veröffentlichung. Siehe [Signaturen und Veröffentlichung](../auto-update.md), [Zusammenfassungen](../update-summaries.md), [Windows-Prüfung](../windows-clipboard-qa.md) und [ausführliche Wartungsreferenz](../../README.md#发布).

Fiktive Beispiele verwenden; keine privaten Nachrichten, Zwischenablagen, Zugangsdaten oder persönlichen Screenshots einchecken. [MIT-Lizenz](../../LICENSE) · [Drittanbieterhinweise](../../THIRD_PARTY_NOTICES.md).
