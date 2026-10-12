# Trimémo — notes d'implémentation

## Modifications incluses

- Limitation des requêtes partagée via Upstash Redis; en environnement Vercel, les routes protégées échouent en mode fermé si Redis n'est pas configuré.
- Devis signé avec `TRIMEMO_PRICING_SECRET` dédié; le secret premium est distinct et les secrets propriétaires ne servent plus de repli.
- Limites serveur des générations de problématiques/plans et de l'aperçu; aperçu plafonné à 2 500 mots et lié à la problématique et au plan choisis.
- Registre Supabase des commandes `pending → paid → consumed`, avec snapshot de reprise; un paiement est lié à un projet, une problématique et un plan, et le crédit est consommé après un export réussi.
- Vérification du montant PayPal côté serveur, vérification de la commande avant de délivrer un jeton, et récupération du projet/aperçu depuis le snapshot si le navigateur a perdu ses données.
- Cache privé des fichiers et du contexte méthodologique côté Supabase; les appels de génération transmettent les métadonnées plutôt que les fichiers base64 répétés. Le navigateur garde les contenus de fichiers en `sessionStorage`, pas dans `localStorage`.
- Vérification de taille avant extraction, limite de taille décompressée DOCX, migration vers `pdf-parse` 2.x et restriction SSRF (DNS privé et redirections non suivies).
- CORS centralisé sur des origines exactes; en-têtes CSP et de sécurité sur le frontend; retrait du CDN Tailwind.
- Comptage des mots corrigé, identifiants de blocs stabilisés, débuts de chapitre limités au premier bloc du chapitre et sources non vérifiées exclues des sources affichées/exportées.
- Retrait de l'adresse Gmail codée en dur et du champ e-mail public inutilisé; ajout d'une information sur le transfert des fichiers aux services d'IA.
- Ajout d'un `tsconfig.json`, d'un script `typecheck` et d'un build frontend qui exécute le contrôle TypeScript.

## Validation réalisée

- `node --check` exécuté sur tous les fichiers JavaScript du backend : réussi.
- Tests isolés exécutés sur signature/vérification du devis, tarifs XOF/CAD/CHF, jeton lié au projet/plan, classification des guides et cycle de commande `pending → paid → consumed` : réussis.
- Le contrôle TypeScript n'a pas signalé d'erreur structurelle supplémentaire, mais ses dépendances ne sont pas installées dans l'environnement de travail.
- Le build Vite complet n'a pas pu être exécuté : `npm install` a échoué à résoudre `registry.npmjs.org` (`EAI_AGAIN`). Il reste à le lancer dans un environnement disposant de l'accès au registre npm.

## Avant production

1. Exécuter `supabase-trimemo-orders.sql` dans Supabase.
2. Définir toutes les variables serveur listées dans `DEPLOIEMENT_SECURITE.md`, notamment Supabase, Upstash, les trois secrets distincts et PayPal.
3. Configurer un job planifié pour `cleanup_expired_trimemo_project_files()`.
4. Compléter les mentions légales et la politique de confidentialité selon `CONFORMITE_A_COMPLETER.md`.
5. Tester le parcours de paiement/export dans PayPal Sandbox puis effectuer les tests de `TESTS_AVANT_DEPLOIEMENT.md`.

Ces changements ne signifient pas que la production a été déployée ni que le compte PayPal/Supabase réel a été testé.
