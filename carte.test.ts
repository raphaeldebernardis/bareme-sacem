import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FICHES } from "./fiches.gen";

/**
 * ⚠️ CE TEST EXISTE POUR UN ÉCHEC MUET. La carte des fiches est générée : si
 * l'on ajoute un barème sans relancer le script, le build réussit, la fiche
 * n'est nulle part, et `chargerFiche` rend null — un cas prévu, donc personne
 * n'est prévenu. Le simulateur affiche alors « activité inconnue » pour une
 * activité qu'on vient d'écrire.
 */
describe("carte des fiches", () => {
  it("couvre exactement le dossier fiches/", () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fiches");
    const surDisque = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    expect(Object.keys(FICHES).sort()).toEqual(surDisque);
  });
});
