# md2chat — Markdown adapté aux conversations

[简体中文](../../README.md) · [English](en.md) · [Español](es.md) · [Português](pt-BR.md) · [日本語](ja.md) · [한국어](ko.md) · [Deutsch](de.md) · [Français](fr.md) · [हिन्दी](hi.md)

<!-- language: fr; source-sha256: a4607b50438048b9ba1495a6554c9b2c6e20ab1bb623b0e0f13212abd7e63f41 -->

Transformez le Markdown des outils d’IA ou de vos documents en texte et images pour vos conversations. Le texte ordinaire reste modifiable ; tableaux, code, formules et diagrammes Mermaid deviennent des images dans l’ordre d’origine. Les tâches utilisent ✅ / ⬜. Les noms d’outils d’IA désignent des sources possibles, pas des intégrations officielles ni une compatibilité vérifiée.

[Site](https://forgeturl.github.io/md2chat/fr/) · [Éditeur Web](https://forgeturl.github.io/md2chat/editor.html?lang=fr) · [Dernière version](https://github.com/forgeturl/md2chat/releases/latest) · [Preuves de compatibilité](../compatibility.md)

![Aperçu de bureau](../desktop-preview.png)

## Téléchargement

- [DMG universel macOS — Apple Silicon et Intel](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-mac-universal.dmg)
- [Installateur Windows x64 — Intel et AMD](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-windows-x64-setup.exe)
- [Sommes SHA256](https://github.com/forgeturl/md2chat/releases/latest/download/SHA256SUMS.txt)

Ces liens pointent toujours vers la dernière version. Pour installer sur Mac, utilisez le DMG ; `.app.tar.gz` sert aux mises à jour intégrées. Aucun paquet natif Windows ARM n’est disponible. Le bureau utilise Tauri 2, Rust et le WebView du système, sans inclure Electron ou Node.js. Sous Windows, l’installateur télécharge WebView2 si nécessaire. Les versions officielles Mac exigent une signature Developer ID et la notarisation ; Windows n’utilise pas encore Authenticode. Les anciennes installations Electron ne sont pas migrées automatiquement.

## Utilisation

Collez du Markdown, du texte ou des images à gauche, vérifiez l’aperçu, choisissez une destination et collez dans l’application. Effacer ouvre un document vide. La copie DingTalk et Feishu est désactivée sur le Web ; utilisez le bureau.

- **WeChat :** texte et images standards ; vérifiez la présence de chaque image.
- **DingTalk :** format natif sur Mac, HTML et texte de secours sur Windows. Les essais historiques Mac ne valident pas toutes les versions actuelles ; Windows nécessite une vérification dans le client.
- **Feishu/Lark :** déployez d’abord l’éditeur enrichi sur Mac. Le mélange texte-images et l’envoi ont été testés sur Mac ; Windows reste expérimental.
- **WeCom :** sur Mac, collez tout en une fois avec du texte modifiable. Web et Windows utilisent des segments ordonnés avec les images. Le test Mac a eu lieu dans un brouillon sans envoi.
- **E-mail :** tableaux HTML modifiables ; contenu complexe en images. Expérimental : vérifiez les images après collage et envoi.

Le bureau peut aussi convertir tout le document en un PNG blanc. Le texte de cette image n’est pas modifiable. Les longs contenus peuvent être réduits ou refusés selon les limites. Si le presse-papiers change pendant la conversion, le nouveau contenu est conservé et une nouvelle tentative est proposée. Les chemins absolus et images locales `file:///` sont pris en charge après validation : PNG, JPEG, GIF, WebP ou BMP, 10 Mo et 20 millions de pixels maximum par image. Sur le Web, collez directement l’image. Aucun message n’est envoyé automatiquement.

## Barre système et raccourcis

La barre de menus Mac ou la zone système Windows permet de convertir le presse-papiers sans modifier l’éditeur, rouvrir la fenêtre et les préférences, vérifier les mises à jour ou quitter complètement. Fermer la fenêtre conserve le processus et la saisie en mémoire. Les préférences permettent d’épingler et trier les formats, d’activer le lancement à la connexion et les raccourcis globaux de conversion. Ces deux fonctions exigent une activation explicite ; sur Mac, installez d’abord l’app dans Applications. La barre système et le démarrage Windows restent à valider sur un appareil réel.

## Langues et mises à jour

Interface, exemples intégrés, site, README et résumés de version prennent en charge neuf langues. Le menu du globe affiche leurs noms natifs. Seuls les exemples non modifiés suivent la langue ; après modification, collage, dépôt ou effacement, le contenu utilisateur reste préservé, même après annulation.

Les résumés couvrent les versions publiées entre la version installée et celle visée. Les trois plus récentes sont affichées, les anciennes se déploient et les avis importants restent visibles. Les détails techniques gardent leur langue d’origine. Une vérification a lieu après démarrage et toutes les six heures ; téléchargement et redémarrage demandent votre action. Enregistrez avant d’installer. Les anciens clients obtiennent la nouvelle interface après installation d’une version qui l’inclut ; les migrations réelles exigent des tests de paquets signés.

## Confidentialité et diagnostic

Aucun compte ni envoi de contenu vers un service md2chat. La conversion est locale. Les images distantes contactent leur serveur d’origine ; le bureau peut conserver un cache local pour permettre le collage ultérieur. La saisie n’est pas enregistrée durablement et disparaît après fermeture complète ou rechargement.

Le diagnostic ne lit que sur demande. Le ZIP exporté contient les données originales, texte, images, liens et éventuellement des formats privés : vérifiez-le avant partage. Fermer efface l’échantillon ; aucun envoi automatique. Le lien d’incident ouvre GitHub pour joindre le ZIP manuellement. Les requêtes de mise à jour n’incluent pas le document.

## Développement

Node.js 22.12+ et Rust 1.90+. Mac nécessite Xcode Command Line Tools ; Windows, les outils Visual Studio C++ et WebView2. Construisez chaque paquet sur son système. Le DMG officiel exige aussi Python 3.10+ et les dépendances à empreinte fixe de `scripts/dmgbuild-requirements.txt`.

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

Les tests natifs remplacent temporairement le presse-papiers puis le restaurent ; lancez-les lorsqu’il n’est pas utilisé. Les tests Web ou de format ne valident pas les vrais clients de conversation. Seules les pages locales intégrées peuvent appeler les commandes de bureau restreintes ; le WebView n’expose pas Node.js.

## Contribution et publication

Pour tout changement visible, synchronisez les neuf langues selon la [règle de localisation](../localization.md). Lancez `npm run seo:generate` après modification des pages ou ressources, puis `npm run check` avant commit. Les sources traduites sont regroupées dans `site/locales/`, sans changer les URL publiques. Ce dossier contient huit traductions du README ; celui à la racine est chinois. Les traces techniques peuvent conserver leur langue d’origine.

Préparez des notes détaillées et un résumé en neuf langues :

```sh
npm run release:prepare -- patch --notes-file /tmp/md2chat-release-notes.md --summary-file /tmp/md2chat-update-summary.json
npm run release:verify -- --tag vX.Y.Z
```

Vérifiez les fichiers et les tests, puis `npm run release:verify -- --tag vX.Y.Z`. La préparation ne crée aucun commit ni publication. Seule une demande explicite autorise la création et l’envoi du tag. Main et PR ne publient pas ; un flux distinct déploie seulement le site. La publication officielle valide paquets et signatures, publie GitHub Release puis le site correspondant. Les lancements manuels du bureau génèrent seulement des paquets de test, sans mise à jour intégrée ni publication. Voir [signatures et publication](../auto-update.md), [résumés](../update-summaries.md), [validation Windows](../windows-clipboard-qa.md) et [référence détaillée](../../README.md#发布).

Utilisez des exemples fictifs. Ne commitez ni messages privés, ni données brutes du presse-papiers, ni identifiants, ni captures personnelles. [Licence MIT](../../LICENSE) · [Avis tiers](../../THIRD_PARTY_NOTICES.md).
