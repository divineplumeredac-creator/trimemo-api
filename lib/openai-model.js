export function getOpenAIModel() {
  const configured = String(process.env.OPENAI_MODEL || "").trim();
  if (!configured || configured === "gpt-5.6-luna") return "gpt-6-luna";
  return configured;
}
