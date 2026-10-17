# Tests obligatoires avant production

## Configuration

1. Exécuter `supabase-trimemo-admin-tables.sql`, `supabase-trimemo-orders.sql` puis `supabase-trimemo-project-state.sql` dans le bon projet Supabase. Les scripts sont conçus pour être réexécutés sans recréer les tables existantes.
2. Définir les variables listées dans `DEPLOIEMENT_SECURITE.md`.
3. Configurer les origines exactes dans `TRIMEMO_ALLOWED_ORIGINS`.
4. Configurer Upstash Redis. Les endpoints coûteux doivent échouer en mode fermé si Redis est indisponible.
5. Garder PayPal en sandbox jusqu'à la fin des essais.

## Parcours fonctionnel

- Créer un projet avec 1, 40, 45 et 100 pages; vérifier que le volume n'est pas arrondi à un forfait.
- Vérifier la détection du pays et les devises XOF, EUR, CHF, CAD et USD.
- Joindre un guide PDF, un DOCX, un fichier texte et une image; vérifier que les consignes sont conservées après estimation et au retour de paiement.
- Générer une problématique, l'améliorer ou demander une alternative; confirmer que la limite serveur est de trois propositions.
- Générer un plan, l'améliorer ou demander une alternative; confirmer la limite serveur de trois générations.
- Valider la problématique et le plan; produire un aperçu de 2 500 mots maximum entre introduction et premier chapitre.
- Payer le prix total estimé; vérifier que le contenu de l'aperçu est conservé et que la rédaction reprend au bon endroit.
- Vérifier qu'un autre sujet, type, niveau, plan, volume supérieur au volume acheté ou projet ne peut pas réutiliser le paiement.
- Vérifier que la commande PayPal est rattachée au compte client authentifié et qu'un autre compte ne peut ni la confirmer ni récupérer le jeton premium.
- Exporter; vérifier qu'un export réussi consomme le crédit une seule fois et qu'un export échoué ne le consomme pas.
- Rejouer l'URL de retour PayPal après consommation; aucun nouveau jeton utilisable ne doit être délivré.
- Tester refus, annulation, interruption réseau, retour PayPal sans projet local et indisponibilité temporaire de Supabase/Redis.

## Sécurité

- Appeler directement les endpoints sans devis signé, sans jeton ou avec un jeton d'un autre projet.
- Vérifier que `/api` ne révèle aucune configuration ni aucun secret.
- Tester les origines CORS explicitement autorisées et refusées, y compris les previews Vercel non déclarées.
- Vérifier que la lecture et l'écriture de l'état distant nécessitent une session client propriétaire du projet ou une session administrateur.
- Envoyer des fichiers trop volumineux et des DOCX dont la taille décompressée dépasse les limites.
- Vérifier qu'une source qui résout vers une adresse privée n'est jamais consultée.
- Vérifier que les références non vérifiées n'apparaissent pas dans la bibliographie comme sources contrôlées.
