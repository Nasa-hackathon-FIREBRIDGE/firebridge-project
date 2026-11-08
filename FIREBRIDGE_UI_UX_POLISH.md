# FIREBRIDGE — amélioration UI/UX et identité originale

Passe du 7 novembre 2026. La référence retenue à la demande de l’utilisateur est
l’identité FIREBRIDGE bleu sombre antérieure à Astra. La direction graphite/vert
lime est remplacée ; les améliorations fonctionnelles et la navigation sont conservées.

## Couleurs et marque

Les sources historiques ont été comparées à `HEAD` : `src/index.css`,
`src/App.css` et `src/features/analyses/workspace.css`. Leur contenu est inchangé
(hors conventions de fin de ligne/BOM lors de la comparaison).

| Élément | Valeur originale réutilisée |
| --- | --- |
| Fond principal | `#060c19` |
| Panneau | `#0c1627` |
| Surface secondaire | `#101c31` |
| Bordure | `#1b2a44` |
| Texte principal | `#e3ebf7` |
| Texte secondaire du workspace | `#9aabc6` |
| Accent cyan | `#38bdf8` |
| Accent bleu secondaire | `#5b9cf5` |
| Accent orange | `#f08a4b` |

Le shell partagé applique désormais `fb-shell`. Les surcharges Astra de couleurs,
fonds, bordures et ombres ont été retirées des composants historiques. Leurs règles
originales retrouvent donc leur effet, y compris les dégradés de la navigation,
les panneaux, les états des boutons, les statuts, les formulaires et la carte.
Les nouveaux composants réutilisent les valeurs de leurs homologues historiques.
Le nom FIREBRIDGE, la flamme Lucide existante, le titre du document, le favicon
cyan et la couleur de thème du navigateur sont rétablis. Les noms internes
`astra-*` sont conservés pour éviter une migration de classes sans utilité produit.
Les noms historiques des démonstrations restent présents dans leurs contenus.

Une vérification navigateur compare **28 composants historiques**, en états
normal, survolé et focalisé, entre les CSS provenant de Git et les styles actuels.
Elle compare aussi trois homologues du nouveau tableau de bord, les variables
racine et les composants du serveur Vite en cours. Les couleurs, dégradés,
bordures et ombres comparés correspondent exactement. Chaque couleur littérale
du fichier de présentation ajouté existe dans les styles Git d’origine.

Preuves locales : `.qa/firebridge-polish/legacy-palette-results.json` et
`legacy-style-provenance.json`. Les anciens fichiers `baseline-*` et
`after-computed-colors.json` de ce répertoire décrivent la référence Astra avant
la clarification ; ils ne constituent pas la référence finale.

## Améliorations d’usage

- Formulaire avancé : validation locale de la borne de fin exclusive, message
  associé au champ et focus sur la date à corriger. Verrou de soumission pour
  empêcher les doubles requêtes pendant l’opération.
- Onglets avancés : rôles et relations ARIA, navigation par flèches et Home/End,
  montage à la première visite puis conservation du panneau. Les filtres,
  formulaires et pages restent disponibles au retour sans requêtes de remontage.
- Formulaires natifs : focus sur le champ GeoJSON ou la date invalide ; noms
  accessibles stables même lorsqu’un message de validation apparaît.
- Action « Set up an analysis » / « New analysis » : ouvre le bon éditeur et
  focalise le nom de zone ou la date de début selon les données disponibles.
- Navigation : retour en haut lors d’un changement de page, sans modifier les
  liens internes ni la restauration Back/Forward du navigateur. Fermeture du
  menu mobile et restitution du focus. Focus initial du tiroir vérifié avec
  et sans réduction des animations ; suppression des transitions sous cette
  préférence pour éviter le focus d’un descendant encore masqué.
- Tableau de bord : heure de vérification explicitement affichée en UTC.
- Les espacements, grilles adaptatives, tables à défilement local, états vides,
  chargements et messages d’erreur partagés de la passe précédente sont conservés.

## Intégration backend

Le dossier `../backend_FIREBRIDGE`, son contrat et son fichier d’environnement
existent. `predev`, `prebuild` et `@firebridge/contracts` utilisaient déjà les
chemins attendus et restent inchangés. La référence résiduelle dans
`src/services/data-api.live.test.ts` pointe désormais vers `backend_FIREBRIDGE`.
Les garde-fous de ce test optionnel restent en place ; il n’a pas été activé.
Le préfixe `/api/v1`, les services Axios et TanStack Query sont conservés.
Aucune modification de configuration backend, d’environnement ou de base.

## Fichiers modifiés dans cette passe

Cette liste exclut les changements déjà présents avant cette passe et les
résolutions de fusion antérieures, qui sont conservés.

- `src/astra.css` : retrait des couleurs Astra, réutilisation des styles
  historiques et conservation des améliorations de mise en page/accessibilité.
- `src/components/ApplicationShell.tsx` : marque et classe FIREBRIDGE,
  navigation, scroll et gestion du focus mobile.
- `src/pages/ApiAnalysisPage.tsx` : validation, anti double soumission, onglets
  accessibles persistants et libellé FIREBRIDGE.
- `src/pages/DashboardPage.tsx` : horodatage UTC et pied de page FIREBRIDGE.
- `src/features/analyses/AnalysisWorkspace.tsx` : ouverture/focus de l’éditeur,
  conservation des onglets et pied de page FIREBRIDGE.
- `src/features/analyses/AreaPanel.tsx` et `AnalysisPanel.tsx` : focus et
  accessibilité des erreurs de formulaire.
- `src/pages/data-pages.test.tsx` et
  `src/features/analyses/AnalysisWorkspace.test.tsx` : régressions fonctionnelles.
- `src/services/data-api.live.test.ts` : correction du chemin backend.
- `index.html`, `public/favicon.svg` : métadonnées et marque originales.
- `README.md`, `ASTRA_PRODUCT_REDESIGN.md` et ce rapport : état final et
  distinction avec le rapport historique Astra.

Les scripts, résultats et captures de contrôle sont locaux, dans le répertoire
ignoré `.qa/firebridge-polish/`.

## Validation

| Contrôle | Résultat |
| --- | --- |
| `npm.cmd run lint` | Réussi, aucune alerte |
| `npm.cmd test -- --reporter=json --outputFile=.qa/firebridge-polish/unit-results.json` | 174 tests réussis, 0 échec, 14 tests optionnels ignorés |
| `npm.cmd run build` | Réussi, contrats puis TypeScript/Vite |
| `node .qa/firebridge-polish/legacy-palette.mjs` | 28 composants + 3 homologues, 3 états, variables et contrôles Vite conformes à Git |
| `node .qa/firebridge-polish/verify.mjs` | 15 routes × 2 formats ; contrôles supplémentaires à 1920, 1366, 768 et 390 px |
| Parcours isolés avec API interceptée | Zones, analyses, carte/échec/reprise, observations, provenance, notes, exports CSV/GeoJSON/Parquet, filtres, onglets, validation et menu mobile réussis |
| États vides et erreurs | Réussis ; aucun détail sensible du message de test exposé |
| Backend réel, lecture seule | Tableau de bord : 8 lignes ; observations : 20 lignes ; 0 alerte, 0 erreur JS, 0 écriture |
| Débordement horizontal | Aucun détecté sur les routes et formats contrôlés |
| `git diff --check` et index non fusionné | Aucun problème d’espacement ; aucun fichier non fusionné |

Les requêtes de mutation des parcours navigateur sont simulées. La vérification
réelle autorise uniquement GET et bloque les mutations. Le serveur Vite existant
sur `http://localhost:5173` reste disponible et n’a pas été arrêté.

## Limites restantes

- Certains anciens enregistrements du backend pointent vers des releases
  absentes ou des résultats indisponibles (404/409). L’interface les signale ;
  cette passe ne répare pas les données. La lecture réelle validée utilise une
  analyse dont les résultats sont disponibles.
- Les 14 tests optionnels d’intégration ne sont pas exécutés sans leur
  environnement explicitement configuré.
- Vite conserve son avertissement sur les gros bundles de carte et graphiques.
- La fusion Git déjà engagée reste ouverte. Les changements préexistants,
  fichiers indexés et modifications locales sont conservés. Aucun commit,
  push, reset, nettoyage ou suppression de fichier n’a été effectué.
