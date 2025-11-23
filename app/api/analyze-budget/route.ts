import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { Transaction, IncomeRule } from "@/lib/types";

// Route Segment Config - Next.js 15 pattern
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      transactions,
      rules,
      currentBalance,
    }: {
      transactions: Transaction[];
      rules: IncomeRule[];
      currentBalance: number;
    } = body;

    // Validate required fields
    if (!transactions || !rules || currentBalance === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: transactions, rules, or currentBalance" },
        { status: 400 }
      );
    }

    // Get API key from environment variables
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
    }

    // Initialize the Gemini API client
    const ai = new GoogleGenAI({ apiKey });

    // Prepare data summaries
    const transactionSummary = transactions
      .map((t) => `${t.date}: ${t.name} (${t.type}) - $${t.amount} [${t.status}]`)
      .join("\n");

    const ruleSummary = rules.map((r) => `${r.name}: $${r.amount} (${r.frequency})`).join("\n");

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

    // Generate content using Gemini
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const analysis = response.text || "Unable to generate analysis at this time.";

    return NextResponse.json({ analysis });
  } catch (error) {
    console.error("Gemini API Error:", error);

    // More specific error handling
    if (error instanceof Error) {
      return NextResponse.json({ error: `Error: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json(
      { error: "Error connecting to AI service. Please check your API key configuration." },
      { status: 500 }
    );
  }
}
