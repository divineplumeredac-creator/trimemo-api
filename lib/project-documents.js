export const FILE_CATEGORIES=["methodology","instructions","context","source","reference"];

export function isImageFile(file){
  const mime=String(file?.type||"").toLowerCase();
  const name=String(file?.name||"").toLowerCase();
  return mime.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(name);
}

export function buildImageInputs(files){
  return (Array.isArray(files)?files:[])
    .filter(isImageFile)
    .map(file=>({type:"input_image",image_url:String(file.content||""),detail:"high"}))
    .filter(item=>item.image_url.startsWith("data:image/"));
}

export function normalizeFileCategory(file){
  const explicit=String(file?.category||"").trim().toLowerCase();
  if(FILE_CATEGORIES.includes(explicit))return explicit;
  const name=String(file?.name||"").toLowerCase();
  if(/(methodolog|méthodolog|guide|consigne|instruction|norme|format|jury)/i.test(name))return "methodology";
  return "reference";
}
function decodeDataUrl(v){const m=/^data:([^;]+);base64,(.+)$/s.exec(v||"");return m?{mime:m[1],buffer:Buffer.from(m[2],"base64")}:null}
export async function extractFileText(file){
  const d=decodeDataUrl(file?.content);if(!d)return "";
  const n=String(file?.name||"").toLowerCase();
  if(n.endsWith(".txt")||n.endsWith(".md"))return d.buffer.toString("utf8");
  if(n.endsWith(".docx")){const mammoth=await import("mammoth");return (await mammoth.extractRawText({buffer:d.buffer})).value||""}
  if(n.endsWith(".pdf")){const pdfParse=(await import("pdf-parse")).default;return (await pdfParse(d.buffer)).text||""}
  return "";
}
export async function buildProjectDocumentContext(files){
  const g={methodology:[],instructions:[],context:[],source:[],reference:[]};
  for(const f of Array.isArray(files)?files:[]){if(!f?.content)continue;const c=normalizeFileCategory(f),t=await extractFileText(f);if(t.trim())g[c].push("DOCUMENT : "+(f.name||"document")+"\n"+t.trim())}
  return {methodologyText:g.methodology.join("\n\n"),instructionsText:g.instructions.join("\n\n"),contextText:g.context.join("\n\n"),sourcesText:g.source.join("\n\n"),referencesText:g.reference.join("\n\n"),allText:Object.values(g).flat().join("\n\n"),counts:Object.fromEntries(Object.entries(g).map(([k,v])=>[k,v.length]))}
}
export async function uploadProjectFiles(files,apiKey){
  const ids=[];
  for(const f of Array.isArray(files)?files:[]){if(isImageFile(f))continue;const d=decodeDataUrl(f?.content);if(!d)continue;const form=new FormData();form.append("purpose","user_data");form.append("file",new Blob([d.buffer],{type:d.mime||f.type||"application/octet-stream"}),f.name||"document");const r=await fetch("https://api.openai.com/v1/files",{method:"POST",headers:{Authorization:"Bearer "+apiKey},body:form});if(!r.ok)throw Object.assign(new Error("Impossible de transmettre le fichier "+(f.name||"document")+" à OpenAI."),{status:502});const data=JSON.parse(await r.text());if(data?.id)ids.push(data.id)}
  return ids;
}
export function buildDocumentInstructions(c={}){
  return [c.methodologyText?"GUIDE MÉTHODOLOGIQUE DU PROJET, PRIORITAIRE ET LOCAL :\n"+c.methodologyText:"AUCUN GUIDE MÉTHODOLOGIQUE DU PROJET N'A ÉTÉ FOURNI.",c.instructionsText?"INSTRUCTIONS DU PROJET :\n"+c.instructionsText:"",c.contextText?"CONTEXTE DU PROJET :\n"+c.contextText:"",c.sourcesText?"SOURCES FOURNIES :\n"+c.sourcesText:"",c.referencesText?"DOCUMENTS DE RÉFÉRENCE :\n"+c.referencesText:""].filter(Boolean).join("\n\n")
}
export async function deleteOpenAIFiles(fileIds, apiKey) {
  const ids = Array.isArray(fileIds) ? fileIds.filter(Boolean) : [];
  if (!ids.length || !apiKey) return;
  await Promise.allSettled(ids.map((id) => fetch(`https://api.openai.com/v1/files/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + apiKey },
  })));
}
