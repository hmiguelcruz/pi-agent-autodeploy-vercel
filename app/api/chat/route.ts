import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText } from "ai";
import { checkInput, checkOutput, SYSTEM_PROMPT, LIMITS } from "@/lib/guardrails";

export const runtime = "edge";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Messages array is required and must not be empty." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const lastUserMessage = messages[messages.length - 1];
    if (!lastUserMessage || lastUserMessage.role !== "user" || typeof lastUserMessage.content !== "string") {
      return new Response(JSON.stringify({ error: "Last message must be a valid user message." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userMessages = messages.filter((m) => m.role === "user");
    const turnIndex = Math.max(0, userMessages.length - 1);

    // 1. Check Input Guardrail
    const inputGuard = checkInput(lastUserMessage.content, turnIndex);
    if (inputGuard.blocked) {
      return new Response(JSON.stringify({ error: inputGuard.reason }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. Call streamText with Google Gemini
    const result = streamText({
      model: google("gemini-2.5-flash"),
      system: SYSTEM_PROMPT,
      messages,
      maxTokens: LIMITS.maxTokens,
      onChunk({ chunk }) {
        if (chunk.type === "text-delta") {
          const outputGuard = checkOutput(chunk.textDelta);
          if (outputGuard.blocked) {
            throw new Error(outputGuard.reason || "Output safety violation.");
          }
        }
      },
    });

    return result.toDataStreamResponse();
  } catch (error: unknown) {
    console.error("Chat API error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
