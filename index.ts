/**
 * Le barème SACEM : ses fiches, son moteur de calcul, ses types.
 *
 * POURQUOI CE PAQUET EXISTE. Ces quarante-neuf fiches et ces cinq cents lignes
 * de calcul servent DEUX produits : le simulateur public du site, qui annonce
 * à un visiteur ce qu'il paie aujourd'hui, et le parcours d'installation de
 * l'application, qui lui rappelle la même somme au moment de payer. Les deux
 * doivent dire le même nombre. Un écart de quarante euros entre la page qui
 * l'a fait venir et l'écran où il sort sa carte, et on a perdu la vente et la
 * confiance en même temps.
 *
 * ⚠️ AVANT, L'APPLICATION ALLAIT SE SERVIR DANS LE SITE, par un chemin
 * `../../web/src/lib/`. Ça tenait tant que les deux vivaient dans le même
 * dépôt. Le jour où l'on sépare le site, ce chemin n'existe plus, et la
 * tentation est alors de recopier les fiches — c'est-à-dire de créer la
 * divergence qu'on veut éviter. On pose donc la frontière maintenant, pendant
 * que les deux sont encore côte à côte et qu'on peut vérifier que rien ne
 * bouge.
 *
 * ⚠️ LES FICHES RESTENT CHARGÉES À LA DEMANDE. Elles pèsent 288 Ko : les
 * empaqueter d'un bloc les ferait télécharger à quiconque ouvre le site, pour
 * une page que la plupart ne visitent pas. L'import dynamique ci-dessous
 * produit un fragment par fiche, et on n'en télécharge qu'une.
 */

export type * from "./types";
export { defaultAnswers, simulate, visibleQuestions } from "./moteur";
import type { FicheSimulator } from "./types";

import { FICHES } from "./fiches.gen";

const cache = new Map<string, FicheSimulator>();

/**
 * Une fiche du barème, par son identifiant.
 *
 * ⚠️ LA CARTE EST GÉNÉRÉE, PAS CALCULÉE. Un import dont le chemin se construit
 * à l'exécution n'est plus analysé une fois le paquet installé en dépendance :
 * le build réussit, les quarante-neuf fiches n'y sont pas, et cette fonction
 * rend null pour toutes — ce qui est un cas prévu, donc silencieux. Voir
 * `gen-fiches.mjs`.
 */
export async function chargerFiche(slug: string): Promise<FicheSimulator | null> {
  const connue = cache.get(slug);
  if (connue) return connue;
  const charger = FICHES[slug];
  if (!charger) return null;
  try {
    const mod = (await charger()) as { default?: FicheSimulator };
    const fiche = (mod.default ?? mod) as FicheSimulator;
    cache.set(slug, fiche);
    return fiche;
  } catch {
    // Une fiche absente n'est pas une panne : le barème ne couvre pas toutes
    // les activités, et l'appelant sait rester neutre. Voir `useFiche`.
    return null;
  }
}
