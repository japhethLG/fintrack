/**
 * Defence in depth: `@google/genai` is aliased here too, so even if some path
 * imported the real SDK directly it could never reach Google.
 */
export class GoogleGenAI {
  constructor() {
    throw new Error("[fintrack-e2e] @google/genai is disabled in E2E builds; use the geminiService stub.");
  }
}
