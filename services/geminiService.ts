import { GoogleGenAI } from "@google/genai";
import { Transaction, IncomeRule } from '../types';

// Initialize the Gemini API client
// NOTE: In a real production app, requests should go through a backend to protect the API Key.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeBudget = async (
  transactions: Transaction[],
  rules: IncomeRule[],
  currentBalance: number
): Promise<string> => {
  const transactionSummary = transactions.map(t => 
    `${t.date}: ${t.name} (${t.type}) - $${t.amount} [${t.status}]`
  ).join('\n');

  const ruleSummary = rules.map(r => 
    `${r.name}: $${r.amount} (${r.frequency})`
  ).join('\n');

  const prompt = `
    You are a financial advisor AI. Analyze the following financial data for the current month.
    
    Current Balance: $${currentBalance}
    
    Income Rules (Regular Sources):
    ${ruleSummary}
    
    Transactions (History & Projections):
    ${transactionSummary}
    
    Please provide a concise 3-paragraph summary:
    1. Cash Flow Analysis: Are they cash positive?
    2. Upcoming Risks: Point out any bills that might cause an overdraft based on the dates.
    3. Recommendation: Suggest one specific action to improve their situation.
    
    Format the output as plain text. Be direct and helpful.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    
    return response.text || "Unable to generate analysis at this time.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Error connecting to AI service. Please check your API key configuration.";
  }
};
