const clean = value => String(value || '').trim().toLowerCase();
export function academicStructureProfile(project = {}) {
  const type = clean(project.typeDoc || project.typeDocument || project.type);
  const pages = Number(project.pages) || 1;
  // Respecter d'abord le guide du client, appliqué après ce profil.
  if (/article scientifique|article de recherche|\barticle\b/.test(type)) {
    return { partMin:1, partMax:1, chapterMin:1, chapterMax:1, sectionMin:2, sectionMax:4,
      instruction:'Article : garder une structure concise de sections analytiques ; ne pas reproduire les chapitres d’un mémoire.' };
  }
  if (/dissertation|devoir|essai|expos[eé]/.test(type)) {
    return { partMin:2, partMax:2, chapterMin:1, chapterMax:1,
      sectionMin:pages < 8 ? 1 : 2, sectionMax:3,
      instruction:'Dissertation ou devoir : plan court, deux axes argumentatifs, aucun empilement artificiel de quatre chapitres ou plus.' };
  }
  if (pages < 30) {
    return { partMin:2, partMax:2, chapterMin:1, chapterMax:2, sectionMin:2, sectionMax:3,
      instruction:'Document court : structure proportionnée au volume. Éviter de multiplier les chapitres.' };
  }
  return { partMin:2, partMax:3, chapterMin:2, chapterMax:3, sectionMin:2, sectionMax:3,
    instruction:'Mémoire ou thèse : progression en parties et chapitres selon le sujet et les consignes.' };
}
