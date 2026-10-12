# Conformité avant ouverture publique

Le code ajoute une information sur l'envoi des fichiers aux services d'IA et un stockage serveur privé à durée limitée. Cela ne remplace pas les pages légales obligatoires ni une validation juridique.

Avant la mise en production publique, renseigner et publier :

- l'identité juridique exacte de l'exploitant de Trimémo et son adresse de contact;
- une adresse de contact valide (`VITE_CONTACT_EMAIL`) et le canal de demande de suppression/export des données;
- les conditions d'utilisation, les conditions de paiement/remboursement et la portée exacte de la prestation automatisée;
- la politique de confidentialité avec finalités, bases légales, destinataires, transferts internationaux, droits des personnes et modalités de réclamation;
- la durée de conservation finale des projets et le calendrier d'exécution de `cleanup_expired_trimemo_project_files()` (activer Supabase Cron/pg_cron ou un job planifié);
- les paramètres contractuels et de conservation applicables aux services OpenAI et PayPal.

Ne pas considérer Trimémo comme pleinement conforme au RGPD tant que ces informations ne sont pas complétées et affichées à l'utilisateur. La correction humaine doit être tarifée séparément et son prix communiqué avant toute commande de cette prestation.
