/**
 * Compatibility facade for the single Trimémo academic master prompt.
 * All generation routes import this symbol so public and admin use the same engine.
 */
export { SYSTEM_PROMPT_MASTER_V4 as TRIMEMO_MASTER_ACADEMIC_RULES } from './prompt-master.js';
