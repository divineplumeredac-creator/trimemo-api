# Déploiement sécurisé de Trimémo

## Variables serveur obligatoires

Configurer dans Vercel pour le dépôt API : `OPENAI_API_KEY`, `OPENAI_MODEL`, `TRIMEMO_OWNER_EMAIL`, `TRIMEMO_OWNER_PASSWORD_HASH`, `TRIMEMO_OWNER_AUTH_SECRET`, `TRIMEMO_PREMIUM_AUTH_SECRET`, `TRIMEMO_PRICING_SECRET`, `TRIMEMO_FRONTEND_URL`, `TRIMEMO_ALLOWED_ORIGINS`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV`.

Ne pas exposer les secrets `SUPABASE_SERVICE_ROLE_KEY`, les secrets de signature ou les identifiants PayPal dans les variables `VITE_*`.

## Hash du mot de passe propriétaire

Générer un hash scrypt avec Node.js :

```js
import crypto from 'node:crypto';
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('VOTRE_MOT_DE_PASSE', salt, 64).toString('hex');
console.log(`scrypt$${salt}$${hash}`);
```

Stocker uniquement la valeur produite dans `TRIMEMO_OWNER_PASSWORD_HASH` en production. Ne pas définir `TRIMEMO_OWNER_PASSWORD`.

## Registre des commandes à usage unique

Exécuter `supabase-trimemo-orders.sql`, `supabase-trimemo-project-ownership.sql`, puis `supabase-trimemo-project-owner-immutable.sql` dans l'éditeur SQL du projet Supabase. Le premier script crée `trimemo_orders` (commandes en attente/payées/consommées avec snapshot de reprise) et `trimemo_project_files` (fichiers et contexte méthodologique privés). Vérifier les doublons avant l'index d'appartenance unique. Ces tables doivent rester inaccessibles aux rôles anon/authenticated. L'API utilise exclusivement la clé service-role côté serveur. Planifier aussi `cleanup_expired_trimemo_project_files()` quotidiennement.

## Limitation des requêtes

Configurer et valider les deux variables Upstash Redis en production. Les endpoints coûteux répondent maintenant 503 si Redis est absent, mal configuré ou indisponible; le repli mémoire est réservé au développement local.

## Origines autorisées

`TRIMEMO_ALLOWED_ORIGINS` doit contenir les origines exactes autorisées, séparées par des virgules. Ne pas ajouter de wildcard de previews Vercel.

## Identifiants et sauvegarde des projets

Les nouveaux projets utilisent un UUID valide même lorsque `crypto.randomUUID()` n'est pas disponible. Les clés de projet transmises aux API Supabase doivent être des UUID, conformément au schéma des tables. Les sauvegardes cloud sont versionnées et limitées à 3,5 Mo UTF-8 par état. Le client enregistre les écritures dans l'ordre, renouvelle une session expirée une fois, et rattache d'abord le projet au compte avant de sauvegarder son contenu.

## Rotation d'un secret exposé

Si une valeur de clé fournisseur a déjà été enregistrée dans les journaux Vercel, révoquer cette clé auprès du fournisseur et la remplacer dans toutes les variables Vercel concernées (production, preview et développement). Les API ne journalisent plus les messages d'erreur fournisseurs bruts et rejettent les valeurs de clé manifestement mal formées avant l'appel externe. Ne pas remettre une ancienne clé compromise en service.

## Paiements

Garder `PAYPAL_ENV=sandbox` jusqu'à validation des parcours création, capture, vérification du montant, reprise après interruption et export. Le Mobile Money reste désactivé tant qu'un prestataire réel n'est pas intégré.
