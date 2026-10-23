# Saraya Assistant — formulaire /recette V6.4

## Nouveautés

- Tous les chiffres extraits sont modifiables **localement** dans le formulaire de vérification : stock début/ajout/fin, employé, dépenses, salaire, Rami Games, ticket caisse (catégorie, quantité, prix, total, ratio), total ventes.
- Le cash caisse démarre **vide**, même si une valeur est extraite de la photo. Il est obligatoire et doit être saisi par le propriétaire. Zéro explicite est accepté.
- Un seul appel au backend lors du clic « Confirmer toutes les données ». Aucune API OpenAI supplémentaire pour ces corrections.
- Le backend vérifie les données soumises et conserve les unités officielles PostgreSQL. Les unités incompatibles bloquent la clôture avec message en arabe.
- Protection doublons : empreinte SHA-256 des deux photos (indépendante de l'ordre) enregistrée dans l'index unique `Shift.sourceFingerprint`; contrôle secondaire des données validées des 48 dernières heures pour éviter les doubles déductions lorsque les photos changent.
- Le workflow corrections financières → validation → sauvegarde transactionnelle reste inchangé.

## Installation

1. Faites une **sauvegarde** de votre projet actuel et de PostgreSQL.
2. Copiez le dossier `backend` et `frontend` du projet fourni, **sans écraser vos fichiers `.env` existants**. Le ZIP ne contient aucune clé ni `.env`.
3. Dans chaque dossier, exécutez `npm ci` (Node 20 ou 22).
4. Dans `backend`, exécutez `npx prisma generate`, puis `npm run dev`.
5. Dans `frontend`, exécutez `npm run dev`.
6. Testez avec deux photos de **test**, jamais avec une vraie caisse en production.

## Tests obligatoires

1. Une extraction : changer plusieurs quantités stock + ticket dans la même interface ; vérifier que la réponse est l'étape corrections.
2. Cash vide : bouton bloqué. Cash `0.000` : accepté.
3. Saisir toutes les valeurs puis valider ; contrôler les calculs avant `OUI ENREGISTRE`.
4. Enregistrer un shift de test, puis renvoyer les mêmes photos : **aucune nouvelle sortie de stock**.
5. Refaire les mêmes données avec photos différentes : le contrôle secondaire doit signaler une possible duplication.
6. Une unité incompatible doit bloquer la clôture et indiquer de contacter le technicien.

## Limitations importantes

- Le détecteur secondaire compare les données validées sur 48 h : deux véritables shifts parfaitement identiques peuvent être bloqués par prudence. Il faut alors une procédure technique d'identification avant de permettre une nouvelle clôture.
- Si une même photo est recadrée ou compressée, son hash change ; la comparaison des données constitue une protection additionnelle, pas une garantie universelle.
- Les doublons **déjà enregistrés** ne sont pas supprimés et les stocks déjà déduits ne sont pas rétablis automatiquement. Un audit et une annulation comptabilisée sont nécessaires.
- Les sessions /recette sont en mémoire ; redémarrer le backend efface une vérification non enregistrée. Pour plusieurs instances/production, migrer ces sessions vers PostgreSQL/Redis et renforcer le verrouillage transactionnel.
- Les anciennes données extraites sont visibles dans le formulaire, mais l'entrée Cash caisse ne reprend jamais la valeur IA.
- Aucune migration Prisma n'est requise pour cette version : l'index unique existant sur `sourceFingerprint` est utilisé.

## Vérification statique

- `tsc --noEmit` backend : OK
- `tsc --noEmit` frontend : OK
- `tsc` build backend : OK

Aucune intégration PostgreSQL ni test end-to-end n'a été exécuté ici : testez avant livraison client.
