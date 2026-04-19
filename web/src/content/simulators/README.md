# Simulateurs tarifs SACEM

Un fichier JSON par autorisation SACEM (49 au total). Le schéma est
défini dans `web/src/content.config.ts` et validé par Zod au build : un
JSON mal formé casse le build avec un message d'erreur précis.

Toutes les clés, valeurs et conventions listées ici sont **normatives**.
Il ne faut rien inventer de nouveau en encodant une fiche : si un cas
n'entre pas dans les archétypes documentés, on élargit le schéma (et ce
README) avant de toucher au JSON.

---

## 1. Arborescence d'un fichier

```jsonc
{
  "slug": "salon-coiffure",               // kebab-case, = slug de la fiche md
  "activity": "salon de coiffure",         // libellé affiché dans le picker
  "intro": "Tarifs réels du barème...",    // optionnel, une ligne max
  "questions": [ ... ],                    // voir §3
  "compute": { ... },                      // SACEM, voir §4
  "spre": { "compute": { ... } },          // optionnel, voir §5
  "footnote": "SACEM au tarif général..."  // optionnel, affiché sous le panneau
}
```

## 2. Conventions de nommage des `id` de questions

Toujours **snake_case**. Réutiliser ces identifiants quand le concept
existe dans plusieurs fiches, pour que le simulateur générique puisse un
jour les pré-remplir depuis un contexte partagé.

| id                 | type     | signification                                      |
|--------------------|----------|----------------------------------------------------|
| `tarif_reduit`     | boolean  | Coche = contrat général signé dans les 15 jours    |
| `places`           | number   | Places assises dans la salle principale            |
| `m2`               | number   | Mètres carrés sonorisés                            |
| `employes`         | number   | Employés / salariés / postes                       |
| `licencies`        | number   | Licenciés d'un club amateur                        |
| `chambres`         | number   | Chambres d'un hôtel / EHPAD / clinique             |
| `lits`             | number   | Lits d'une institution sociale ou médicale         |
| `emplacements`     | number   | Emplacements (camping)                             |
| `unites`           | number   | Unités d'hébergement (camping)                     |
| `etoiles`          | select   | 1..5 (hôtel, camping)                              |
| `population`       | select   | Population de la commune (`2000`, `15000`, …)      |
| `appareil`         | radio    | `radio`, `tv`, `jukebox`, `jukebox_ecran`, `simple`, `hp` |
| `evenements`       | number   | Événements annuels avec diffusion musicale         |
| `recettes`         | number   | Recettes annuelles (€ HT)                          |
| `ca`               | number   | Chiffre d'affaires annuel (€ HT)                   |
| `musique_vivante`  | boolean  | Coche = 100 % live (skipWhen sur SPRE)             |
| `musique_enregistree` | boolean | Coche = supports enregistrés (majorations 25 %)  |

Exemple : une fiche restaurant et une fiche hôtel utilisent toutes les
deux `tarif_reduit` et `population`, pas un variant par fiche.

## 3. Questions

```jsonc
{
  "id": "places",
  "label": "Places assises",
  "type": "number",
  "default": 50,
  "min": 10,
  "max": 500,
  "step": 1,
  "unit": "places",
  "help": "Optionnel, une phrase max.",    // affiché sous le champ
  "when": { "appareil": "hp" }              // optionnel, gate
}
```

Types supportés : `number`, `radio`, `select`, `boolean`. Les `options`
sont obligatoires pour `radio` et `select` et interdites pour les autres
types. Les `min` / `max` / `step` / `unit` sont réservés à `number`.

## 4. Compute tree (SACEM)

Cinq `kind` possibles. Tous acceptent un tableau `modifiers` appliqué
après le calcul brut.

### 4.1 `constant`
Forfait unique, sans variable.

### 4.2 `lookup`
Grille de règles. La première `match` satisfaite gagne. `value` ou
`formula` pour chaque ligne. `fallback` optionnel si aucune ne matche.

```jsonc
{
  "kind": "lookup",
  "rows": [
    { "match": { "places": { "lte": 30 } }, "value": 353.94 },
    { "match": { "places": { "lte": 60 } }, "value": 584.58 },
    { "match": { "places": { "lte": 100 } }, "value": 643.41 },
    { "match": {},                             "value": 707.10 }  // catch-all
  ],
  "fallback": 0
}
```

Les `match` acceptent ces clauses : scalaire (= `{ "eq": x }`),
`{ "eq": x }`, `{ "ne": x }`, `{ "in": [x, y] }`, `{ "lt|lte|gt|gte": n }`.
Un objet `match` vide `{}` matche toujours (utile en dernière ligne).

### 4.3 `percentage`
Pourcentage sur la valeur d'une réponse numérique.

```jsonc
{
  "kind": "percentage",
  "rate": 0.055,           // 5,50 %
  "of": "recettes",
  "min": 61.88             // forfait minimum par séance
}
```

### 4.4 `formula`
Petite expression : `+ - * /`, parenthèses, `min()`, `max()`, références
d'answers. La SACEM calculée peut être référencée dans une SPRE formula
sous l'identifiant `sacem`.

```jsonc
{ "kind": "formula", "expr": "111.39 * appareils_simples", "min": 0 }
```

### 4.5 `composite`
Combine plusieurs sub-computes.

```jsonc
{
  "kind": "composite",
  "op": "sum",                               // ou "max", "highestPlusFractionOfLower"
  "parts": [ { ... }, { ... } ],
  "fraction": 0.6667,                         // uniquement pour highestPlus...
  "modifiers": [
    { "kind": "multiply", "value": 1.25, "when": { "etoiles": "4" } }
  ]
}
```

`highestPlusFractionOfLower` implémente la règle SACEM « tarif le plus
élevé + 2/3 du plus bas » (combinaisons d'appareils). `fraction` = 2/3,
1/2 ou 3/4 selon l'article du barème.

## 5. Modifiers

```jsonc
{ "kind": "multiply", "value": 0.8, "when": { "tarif_reduit": true } }
{ "kind": "add",      "value": 150 }
{ "kind": "min",      "value": 100 }   // résultat >= 100 (plancher)
{ "kind": "max",      "value": 5000 }  // résultat <= 5000 (plafond)
```

Les modifiers sont évalués dans l'ordre du tableau.

## 6. SPRE

```jsonc
"spre": {
  "compute": { "kind": "formula", "expr": "sacem * 0.65", "min": 110.60 },
  "skipWhen": { "musique_vivante": true }  // optionnel
}
```

Trois patterns SPRE courants :

1. **Ratio de la SACEM** : `{ "kind": "formula", "expr": "sacem * 0.65", "min": X }`
2. **Table par taille** (salon de coiffure, café-resto selon la grille SPRE
   fournie dans le PDF) : `{ "kind": "lookup", "rows": [ ... ] }`
3. **Minimum plat** si la SACEM = 0 : le `min` dans la formule ou le
   lookup de SPRE garantit au moins le minimum annuel d'activité.

`skipWhen` désactive complètement la SPRE (ex : musique 100 % vivante).

## 7. Archétypes par type de barème

### Archétype A — Forfait unique
**Exemples** : attente-telephonique, ceremonie-obseques, musique-ecole-creche-loisirs

```jsonc
"compute": { "kind": "constant", "value": 62.62 }
```

### Archétype B — Forfait par tranche d'une variable
**Exemples** : salon-coiffure (hp), musique-college-lycee, musique-entreprise-administration (salariés), club-sport-amateur (licenciés)

```jsonc
"compute": {
  "kind": "lookup",
  "rows": [
    { "match": { "employes": { "lte": 300 } }, "value": 150 },
    { "match": { "employes": { "lte": 500 } }, "value": 250 },
    { "match": { "employes": { "lte": 900 } }, "value": 400 },
    { "match": {},                                "value": 600 }
  ]
}
```

### Archétype C — Grille 2D (variable × variable)
**Exemples** : café-restaurant (appareil × places), salle-attente, enseignement-superieur

Match sur deux clés dans la même ligne. Les lignes plus spécifiques
passent avant les plus larges.

```jsonc
"compute": {
  "kind": "lookup",
  "rows": [
    { "match": { "appareil": "radio", "places": { "lte": 30 } }, "value": 531.46 },
    { "match": { "appareil": "radio", "places": { "lte": 60 } }, "value": 584.58 },
    { "match": { "appareil": "tv",    "places": { "lte": 30 } }, "value": 353.94 },
    ...
  ]
}
```

### Archétype D — Grille 3D (variable × variable × variable)
**Exemples** : hebergement-touristique, camping, parc-attractions-loisirs, sites internet

Même principe, trois clés par ligne. Attendez-vous à 20-80 lignes. OK
pour la lisibilité tant que le tableau est ordonné par dimension.

### Archétype E — Per unit avec tranches cumulatives
**Exemples** : chambres d'un hôpital / EHPAD (tranches 50 / 25 / 50…),
emplacements d'un camping (0-19 / 20-49 / 50-99…)

Utiliser une `formula` qui reconstitue l'escalier, ou un `composite`
`sum` de plusieurs sub-computes `lookup` partielles, ou une helper
convention à forger au besoin.

### Archétype F — Pourcentage sur recettes / CA / budget
**Exemples** : bar-karaoke, patinoire, cinema, festival, concert-spectacle

```jsonc
"compute": {
  "kind": "percentage",
  "rate": 0.055,
  "of": "recettes",
  "min": 61.88
}
```

### Archétype G — Composite additif (plusieurs blocs tarifaires)
**Exemples** : etablissement-sante (salle + parties communes + chambres),
camping (emplacements + unités + restaurant), institution-sociale-medicosociale

```jsonc
"compute": {
  "kind": "composite",
  "op": "sum",
  "parts": [
    { /* bloc salle restauration  */ },
    { /* bloc parties communes    */ },
    { /* bloc chambres tranchées  */ }
  ]
}
```

### Archétype H — Coefficient multiplicateur (étoiles, CA ≤ seuil, etc.)
**Exemples** : camping (1*..5*), café-resto (abattement 15 % si CA ≤ 80k)

Pose un modifier sur le compute racine plutôt que de redéfinir la grille.

```jsonc
"modifiers": [
  { "kind": "multiply", "value": 1.25,  "when": { "etoiles": "4" } },
  { "kind": "multiply", "value": 0.85,  "when": { "ca_sous_80k": true } }
]
```

### Archétype I — Combinaison d'appareils
**Exemples** : café-resto (TV + radio = max + 2/3 min), EHPAD, enseignement-sup

```jsonc
"compute": {
  "kind": "composite",
  "op": "highestPlusFractionOfLower",
  "fraction": 0.6667,
  "parts": [
    { /* prix si TV seule   */ },
    { /* prix si radio seule */ },
    { /* prix si juke-box   */ }
  ]
}
```

Chaque `part` retourne 0 si l'appareil correspondant n'est pas déclaré
(via un `lookup` avec fallback 0). Le composite prend le max puis ajoute
les fractions des autres.

---

## 8. Template vide

```jsonc
{
  "slug": "ACTIVITE",
  "activity": "ACTIVITE",
  "intro": "Tarifs réels du barème SACEM 2026 (autorisation n° N).",
  "questions": [
    {
      "id": "tarif_reduit",
      "label": "Je bénéficie du tarif réduit (contrat général signé dans les 15 jours)",
      "type": "boolean",
      "default": false
    }
  ],
  "compute": {
    "kind": "constant",
    "value": 0,
    "modifiers": [
      { "kind": "multiply", "value": 0.8, "when": { "tarif_reduit": true } }
    ]
  },
  "spre": {
    "compute": { "kind": "formula", "expr": "sacem * 0.65", "min": 110.60 }
  },
  "footnote": "SACEM au tarif général par défaut. La SPRE n'a pas de tarif réduit."
}
```
