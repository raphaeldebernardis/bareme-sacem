# @playsafe/bareme-sacem

Le barème SACEM : quarante-neuf fiches, le moteur de calcul, les types.

## Pourquoi ce dépôt existe

Ces fiches servent **deux produits** : le simulateur public du site, qui annonce
à un visiteur ce qu'il paie aujourd'hui, et le parcours d'installation de
l'application, qui lui rappelle la même somme au moment de payer.

Les deux doivent dire le même nombre. Un écart entre la page qui fait venir le
client et l'écran où il sort sa carte coûte la vente et la confiance. D'où un
dépôt à part plutôt que deux copies.

## Consommation

Le paquet livre du **TypeScript source**, pas du JavaScript compilé : les deux
consommateurs passent par Vite, qui le transpile. Chacun déclare un alias
`@bareme` vers le dossier installé plutôt que de s'en remettre à la résolution
de `main` — un `.ts` dans `node_modules` n'est pas résolu partout de la même
façon.

```js
// vite.config.ts / astro.config.mjs
alias: { "@bareme": path.resolve(__dirname, "./node_modules/@playsafe/bareme-sacem") }
```

Le site charge en plus les fiches comme collection Astro, par chemin de
fichier :

```js
loader: glob({ pattern: "**/*.json", base: "./node_modules/@playsafe/bareme-sacem/fiches" })
```

⚠️ **C'est la ligne la plus sensible des deux produits** : 450 des 579 URL
indexées de playsafe.fm sont générées à partir de cette collection. Une base
fausse ne casse pas le build, elle rend la collection vide et les pages
disparaissent en silence du sitemap. Après toute modification, compter :

```
grep -o '<loc>' dist/sitemap-0.xml | wc -l
```

## Ajouter ou modifier une fiche

1. Poser le JSON dans `fiches/`.
2. `npm run gen` — régénère `fiches.gen.ts`.
3. `npm test`.

⚠️ **L'étape 2 n'est pas optionnelle.** `fiches.gen.ts` est une carte d'imports
explicites, et elle existe pour une raison : un import dont le chemin se
construit à l'exécution n'est plus analysé par l'empaqueteur une fois le paquet
installé en dépendance. Le build réussit, les fiches n'y sont pas, et
`chargerFiche` rend `null` pour toutes — ce qui est un cas prévu, donc muet.
Mesuré : 131 fragments au lieu de 180, et l'estimation SACEM disparue du
parcours d'installation sans un mot.

`carte.test.ts` vérifie que la carte couvre exactement le dossier : oublier
l'étape 2 échoue maintenant bruyamment.
