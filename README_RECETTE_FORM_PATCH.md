# /recette formulaire — patch

- Décisions et montants des corrections modifiables localement sans requêtes réseau.
- Une seule confirmation transmet le brouillon complet au backend.
- Validation des codes, montants en millimes et recalcul déterministe côté serveur.
- Corrections rejetées conservées avec montant retenu zéro.
- Cash caisse éditable à la vérification, soumis avec confirmation des données.
- Total ventes du ticket conservé séparément du cash.

Tester avec `/recette mock`, confirmer les données, cocher les corrections et modifier les montants puis confirmer. L'enregistrement du shift reste une action distincte.
