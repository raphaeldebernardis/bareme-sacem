#!/usr/bin/env node
/**
 * Écrit `fiches.gen.ts` : la carte explicite des quarante-neuf fiches.
 *
 * ⚠️ POURQUOI UNE CARTE ÉCRITE PLUTÔT QU'UN IMPORT À TROU. Un
 * `import(`./fiches/${slug}.json`)` fonctionne tant que le paquet est du code
 * source dans le dépôt : l'empaqueteur voit le dossier et prépare un fragment
 * par fichier. Installé en dépendance, il ne l'analyse plus — et le résultat
 * n'est pas une erreur de build, c'est un build qui réussit SANS les fiches.
 * `chargerFiche` rend alors null pour les quarante-neuf, ce qui est un cas
 * prévu, donc muet : l'estimation SACEM disparaît du parcours sans que rien
 * ne l'annonce. Mesuré le 16/08/2026 : 131 fragments au lieu de 180.
 *
 * Une carte de littéraux est analysable partout, source comme dépendance, et
 * conserve un fragment par fiche donc le chargement à la demande.
 *
 *   node packages/bareme-sacem/gen-fiches.mjs
 */
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ici = dirname(fileURLToPath(import.meta.url));
const slugs = readdirSync(resolve(ici, "fiches"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const lignes = slugs.map((s) => `  "${s}": () => import("./fiches/${s}.json"),`).join("\n");

writeFileSync(resolve(ici, "fiches.gen.ts"), `/**
 * GÉNÉRÉ par \`node packages/bareme-sacem/gen-fiches.mjs\`. Ne pas éditer.
 *
 * La carte des fiches du barème, en imports explicites. Voir le script pour
 * la raison : un import à trou cesse d'être analysé une fois le paquet
 * installé en dépendance, et les fiches disparaissent du build en silence.
 */
export const FICHES: Record<string, () => Promise<unknown>> = {
${lignes}
};
`);
console.log(`fiches.gen.ts : ${slugs.length} fiches`);
