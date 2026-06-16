import { 
  AuthStorage, 
  createAgentSession, 
  ModelRegistry, 
  SessionManager 
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";
import { checkInput, checkOutput } from "@/lib/guardrails";

export const runtime = "nodejs";

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

    // 2. Set up pi-coding-agent session
    const authStorage = AuthStorage.create();
    if (process.env.GEMINI_API_KEY) {
      authStorage.setRuntimeApiKey("google", process.env.GEMINI_API_KEY);
    } else {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured in environment variables." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const modelRegistry = ModelRegistry.create(authStorage);
    const model = getModel("google", "gemini-2.5-flash");

    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      authStorage,
      modelRegistry,
      model,
    });

    function formatChunk(type: string, value: string): string {
      return `${type}:${JSON.stringify(value)}\n`;
    }

    const encoder = new TextEncoder();
    let isClosed = false;
    let unsubscribe: (() => void) | undefined;

    const stream = new ReadableStream({
      async start(controller) {
        function cleanup() {
          if (!isClosed) {
            isClosed = true;
            if (unsubscribe) unsubscribe();
            try {
              controller.close();
            } catch (e) {}
            session.dispose();
          }
        }

        unsubscribe = session.subscribe((event) => {
          if (isClosed) return;

          try {
            if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
              const delta = event.assistantMessageEvent.delta;
              if (delta) {
                // Check Output Guardrail
                const outputGuard = checkOutput(delta);
                if (outputGuard.blocked) {
                  cleanup();
                  session.abort().catch(() => {});
                  return;
                }
                controller.enqueue(encoder.encode(formatChunk("0", delta)));
              }
            } else if (event.type === "tool_execution_start") {
              const argStr = event.args ? JSON.stringify(event.args) : "";
              const toolMarker = `\n\n\`\`\`bash\n[Executing Tool: ${event.toolName} ${argStr}]\n\`\`\`\n\n`;
              controller.enqueue(encoder.encode(formatChunk("0", toolMarker)));
            } else if (event.type === "tool_execution_end") {
              const statusStr = event.isError ? "Failed ❌" : "Done ✅";
              const toolMarker = `\n\n\`\`\`bash\n[Tool Finished: ${event.toolName} - ${statusStr}]\n\`\`\`\n\n`;
              controller.enqueue(encoder.encode(formatChunk("0", toolMarker)));
            } else if (event.type === "agent_end") {
              cleanup();
            }
          } catch (err) {
            // Handle enqueuing failure silently if stream closed
            cleanup();
            session.abort().catch(() => {});
          }
        });

        try {
          await session.prompt(lastUserMessage.content);
        } catch (error) {
          console.error("Agent session prompt error:", error);
          if (!isClosed) {
            try {
              const errorMsg = error instanceof Error ? error.message : "Session error";
              const errorMarker = `\n\n⚠️ Error during execution: ${errorMsg}\n`;
              controller.enqueue(encoder.encode(formatChunk("0", errorMarker)));
            } catch (e) {}
            cleanup();
          }
        }
      },
      async cancel() {
        isClosed = true;
        if (unsubscribe) unsubscribe();
        try {
          await session.abort();
        } catch (e) {}
        session.dispose();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Vercel-AI-Data-Stream": "v1",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error: unknown) {
    console.error("Chat API error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
