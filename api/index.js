export default function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method==='OPTIONS') return res.status(200).end();
  res.status(200).json({ 
    name: "Trimémo Academic Engine", 
    version: "2.2-prompt-universel-international-rigoureux", 
    status: "operational", 
    prompts: "universels avec sujet exact conservé",
    domaines: ["Marketing digital","Finance","RH","Droit","Informatique","Éducation","Santé","Entrepreneuriat","Gestion","Management","Économie","Comptabilité","Audit","Banque & Assurance","Commerce international","Logistique","Supply Chain","Communication","Journalisme","Sociologie","Psychologie","Philosophie","Histoire","Géographie","Sciences politiques","Relations internationales","Environnement","Agronomie","Architecture","Urbanisme","Génie civil","Énergie","Transport","Tourisme & Hôtellerie","Arts & Culture","Littérature","Langues & Traduction","Sport","Biologie","Chimie","Physique","Mathématiques","Électronique","Mécanique","Immobilier","Autre"],
    tarifs: "Licence 18 000 FCFA (10-45p), Master 25 000 FCFA (10-80p), Thèse 50 000 FCFA (10-100p), Pack5 Licence 72 000, Pack5 Master 100 000, Pack5 Thèse 200 000",
    style: "rigoureux-dynamique, anti-GPT, sigles définis, phrases <28 mots, sans -ment, sans ceci/cela, exemples internationaux adaptés au sujet",
    env: { hasOpenAI: !!process.env.OPENAI_API_KEY }
  });
}
