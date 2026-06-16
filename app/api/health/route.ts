export const runtime = "edge";

export async function GET() {
  return new Response(
    JSON.stringify({
      status: "ok",
      timestamp: new Date().toISOString(),
      model: "gemini-1.5-flash",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
