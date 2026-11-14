// Détecte les délimitations géographiques majeures ajoutées sans fondement
// dans un dossier sans documents méthodologiques. Une région déjà fournie
// dans le sujet ou les consignes constitue au contraire une délimitation valide.
const SCOPE_TERMS = ['asie','afrique','europe','amerique','océanie','oceanie',
  'chine','japon','inde','benin','bénin','france','canada','cameroun',
  'sénégal','senegal','chine','nigeria','brésil','bresil'];
const folded = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function unexpectedGeographicScope(value, project = {}, approvedText = '') {
  // Les documents joints peuvent définir un périmètre inconnu du formulaire ;
  // ne jamais rejeter une précision qui pourrait provenir du guide client.
  if (Array.isArray(project.files) && project.files.length) return [];
  const supplied = folded([
    project.sujet,project.subject,project.contexte,project.context,
    project.consignes,project.instructions,project.problematiquePersonnelle,
    project.planPersonnel,project.pays,approvedText
  ].join(' '));
  const target = folded(value);
  const boundaries = term => new RegExp('(?:^|[^\\p{L}])'+term+'(?=$|[^\\p{L}])','u');
  return [...new Set(SCOPE_TERMS.map(folded))].filter(term =>
    boundaries(term).test(target) && !boundaries(term).test(supplied)
  );
}
