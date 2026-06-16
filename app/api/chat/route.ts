import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";
import { checkInput, checkOutput } from "@/lib/guardrails";
import { Type } from "typebox";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const deployToVercelTool = {
  name: "deployToVercel",
  label: "Deploy to Vercel",
  description: "Deploys the current project to Vercel. Use this tool when the user asks to deploy, redeploy, or publish their app to Vercel.",
  parameters: Type.Object({
    prod: Type.Optional(
      Type.Boolean({
        description: "Whether to deploy to production. Defaults to true.",
      })
    ),
  }),
  async execute(toolCallId: string, params: { prod?: boolean }) {
    try {
      const deployProd = params.prod !== false;
      const cmd = deployProd ? "npx vercel --prod --yes" : "npx vercel --yes";

      const { stdout, stderr } = await execAsync(cmd, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: process.env.HOME || "/tmp",
          npm_config_cache: process.env.npm_config_cache || "/tmp/.npm",
        },
      });

      const output = stdout + "\n" + stderr;
      const urlMatch = output.match(/https:\/\/[a-zA-Z0-9-]+\.vercel\.app/);
      const url = urlMatch ? urlMatch[0] : "";

      if (!url) {
        const genericUrlMatch = output.match(/https:\/\/\S+/);
        if (genericUrlMatch) {
          return {
            success: true,
            url: genericUrlMatch[0],
            content: [{ type: "text" as const, text: `Successfully deployed to ${genericUrlMatch[0]}` }],
            details: undefined,
          };
        }
        throw new Error("Could not extract deployment URL from output:\n" + output);
      }

      return {
        success: true,
        url,
        content: [{ type: "text" as const, text: `Successfully deployed to ${url}` }],
        details: undefined,
      };
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      const output = (err.stdout || "") + "\n" + (err.stderr || "") + "\n" + (err.message || String(error));
      let userFriendlyError = err.message || String(error);

      if (output.includes("token is not valid") || output.includes("Use `vercel login`")) {
        userFriendlyError = "Vercel CLI is not authenticated. Please run `npx vercel login` in your terminal to log in first.";
      } else if (output.includes("Link to existing project") || output.includes("No project linked")) {
        userFriendlyError = "Project is not linked to Vercel. Please run `npx vercel link` in your terminal first.";
      }

      return {
        success: false,
        error: userFriendlyError,
        content: [{ type: "text" as const, text: `Deployment failed: ${userFriendlyError}` }],
        details: undefined,
      };
    }
  },
};

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
    const modelName = (process.env.GEMINI_MODEL || "gemini-2.5-flash") as Parameters<typeof getModel>[1];
    const model = getModel("google", modelName);

    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      authStorage,
      modelRegistry,
      model,
      customTools: [deployToVercelTool],
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

              const toolCall = {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args || {},
              };
              controller.enqueue(encoder.encode(`9:${JSON.stringify(toolCall)}\n`));
            } else if (event.type === "tool_execution_end") {
              const statusStr = event.isError ? "Failed ❌" : "Done ✅";
              const toolMarker = `\n\n\`\`\`bash\n[Tool Finished: ${event.toolName} - ${statusStr}]\n\`\`\`\n\n`;
              controller.enqueue(encoder.encode(formatChunk("0", toolMarker)));

              const toolResult = {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                result: event.result || { success: !event.isError },
              };
              controller.enqueue(encoder.encode(`a:${JSON.stringify(toolResult)}\n`));
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
              let errorMsg = error instanceof Error ? error.message : "Session error";
              const lowerMsg = errorMsg.toLowerCase();
              if (
                lowerMsg.includes("quota") ||
                lowerMsg.includes("429") ||
                lowerMsg.includes("resource_exhausted") ||
                lowerMsg.includes("rate limit") ||
                lowerMsg.includes("limit exceeded")
              ) {
                errorMsg = "AI Quota limit reached. Please wait a moment or try again later.";
              }
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
    let errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    const lowerMsg = errorMessage.toLowerCase();
    if (
      lowerMsg.includes("quota") ||
      lowerMsg.includes("429") ||
      lowerMsg.includes("resource_exhausted") ||
      lowerMsg.includes("rate limit") ||
      lowerMsg.includes("limit exceeded")
    ) {
      errorMessage = "AI Quota limit reached. Please wait a moment or try again later.";
    }
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
