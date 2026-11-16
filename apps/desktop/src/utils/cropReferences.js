// Agricultural references for the built-in crop profiles.
// Soil texture lists reflect preferred (not exclusive) classes in the cited
// references. Drainage, crop variety, climate and fertility are not scored.
export const BUILTIN_CROP_REFERENCES = Object.freeze({
  'CRP-001': {
    preferredSoils: [], // FAO EcoCrop describes a wide texture tolerance; do not exclude arbitrary classes.
    url: 'https://ecocrop.apps.fao.org/ecocrop/srv/en/dataSheet?id=1574',
    source: 'FAO EcoCrop — Oryza sativa',
    note: 'Rice tolerates varied textures; drainage and cultivation method are important and not assessed here.'
  },
  'CRP-002': {
    preferredSoils: ['loam', 'silt-loam'],
    url: 'https://cagayanvalley.da.gov.ph/wp-content/uploads/2018/02/corn_techno_guide_final.pdf',
    source: 'Philippine Department of Agriculture — Corn Production Guide',
    note: 'Loam and silt-loam are preferred; other textures may be workable with appropriate management.'
  },
  'CRP-003': {
    preferredSoils: ['loam', 'silt-loam', 'clay-loam', 'clay'],
    url: 'https://www.bswm.da.gov.ph/wp-content/uploads/MISAMIS_ORIENTAL_SUITABILITY_CASSAVA.pdf',
    source: 'BSWM — Land Suitability for Cassava',
    note: 'Listed textures are among S1 reference types; observed soil texture alone does not establish cassava suitability.'
  },
  'CRP-004': {
    preferredSoils: ['sandy-loam', 'loam', 'clay-loam'],
    url: 'https://ati2.da.gov.ph/ati-7/content/sites/default/files/users/user16/PECHAY%20final_2.pdf',
    source: 'Department of Agriculture ATI — Pechay Production Guide',
    note: 'Pechay prefers well-drained, organic-rich sandy-to-clay loam; the existing profile pH can be edited to match local references.'
  },
  'CRP-CACAO': {
    preferredSoils: ['sandy-loam', 'loam', 'clay-loam'],
    url: 'https://pcaf.da.gov.ph/wp-content/uploads/2022/06/Philippine-Cacao-Industry-Roadmap-2021-2025.pdf',
    source: 'Philippine Cacao Industry Roadmap 2021–2025 — S1 criteria',
    note: 'Preferred cacao pH is 5.5–6.7 and preferred textures are sandy loam, loam, and clay loam. Site drainage, depth, climate and other requirements are not assessed.'
  }
});
