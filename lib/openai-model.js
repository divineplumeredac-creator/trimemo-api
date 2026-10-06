export function getOpenAIModel() {
  const configured = String(process.env.OPENAI_MODEL || '').trim();
  if (!configured) {
    const error = new Error('OPENAI_MODEL doit être configuré avec le nom exact d’un modèle disponible sur votre compte.');
    error.status = 500;
    throw error;
  }
  return configured;
}
