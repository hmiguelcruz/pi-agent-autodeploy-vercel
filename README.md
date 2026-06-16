# π Agent Clone

A minimal AI coding agent inspired by pi.dev, built with Next.js 15, Vercel AI SDK, and Google Gemini. Features active safety guardrails at the application level and edge API streaming.

## Features
- **Guardrail Layer**: Single source of truth safety checks (input size, banned topics/patterns, response redacts).
- **Edge API Streaming**: Super-fast streaming responses from `gemini-1.5-flash` using `@ai-sdk/google` under Vercel Edge functions.
- **Dark Terminal Theme**: Minimalist interface using CSS variables, custom cursors, and font styling (JetBrains Mono).

---

## Deployment Steps

### Local Development

1. **Clone the repository**:
   ```bash
   git clone <repo-url>
   cd Pi Agent
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env.local
   # Open .env.local and add your GEMINI_API_KEY
   ```

3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Run the development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

### GitHub Integration

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/USERNAME/Pi Agent.git
git branch -M main
git push -u origin main
```

### Vercel Deployment

#### Option 1: Vercel CLI
```bash
npm install -g vercel
vercel login
vercel --prod
# Configure GEMINI_API_KEY inside the Vercel dashboard Settings -> Environment Variables.
```

#### Option 2: Vercel Dashboard
1. Go to [vercel.com/new](https://vercel.com/new).
2. Import the GitHub repository.
3. Add `GEMINI_API_KEY` (and optionally `MAX_TURNS` / `MAX_TOKENS`) in the **Environment Variables** section.
4. Click **Deploy**. Any future push to `main` will automatically trigger a production build.

---

## Free API Access (Google AI Studio)

1. Navigate to [Google AI Studio](https://aistudio.google.com/).
2. Click **Get API key**.
3. Create a key in a new project or select an existing project.
4. Paste the key as `GEMINI_API_KEY` in `.env.local` or Vercel Settings.

---

## Extending Guardrails

All safety policies are contained in `lib/guardrails.ts`.

### Add a Banned Pattern
To block inputs containing specific regex structures, push to the `BANNED_INPUT_PATTERNS` array:
```typescript
BANNED_INPUT_PATTERNS.push({
  pattern: /your-regex-here/i,
  label: "Description of what was blocked",
});
```

### Add a Banned Topic
To add simple substring topic matching:
```typescript
BANNED_TOPICS.push("the topic string");
```

### Redact or Block Output
To scan streaming chunks before they are sent to the client, modify `checkOutput` in `lib/guardrails.ts`:
```typescript
if (/your-pattern/.test(text)) {
  return { blocked: true, reason: "Reason shown to user" };
}
```

### Alter Agent Personality
Modify the `SYSTEM_PROMPT` string in `lib/guardrails.ts`.

---

## Cost Management
- Running on Vercel Hobby tier is completely free (Edge runtime and stream capabilities are fully included).
- Powered by Google Gemini 1.5 Flash: free tier includes up to 15 Requests Per Minute (RPM) and 1M Tokens Per Minute (TPM).
- To enforce maximum budget safety limits, adjust `MAX_TOKENS=512` in `.env.local`.