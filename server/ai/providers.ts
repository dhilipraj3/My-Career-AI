import { GoogleGenAI } from "@google/genai";

export interface GenerateRequest {
  system?: string;
  prompt: string;
  json: boolean;
  maxTokens?: number;
  /** Images or PDFs for the model to read (base64). Only vision-capable (Gemini) providers accept these. */
  files?: Array<{ mime: string; base64: string }>;
}
export interface GenerateResponse {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface AiProvider {
  id: string;
  /** "gemini" or "compat" — task routing prefers one kind over the other. */
  kind?: "gemini" | "compat";
  available(): boolean;
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  /** Same as generate, but reports text as it arrives. Optional: callers fall back to generate. */
  stream?(req: GenerateRequest, onText: (chunk: string) => void): Promise<GenerateResponse>;
}

/** Errors that mean "this key/model is out of quota or unavailable right now", as opposed to a bad request. */
export const isCapacityError = (err: unknown) => /429|RESOURCE_EXHAUSTED|quota|rate.?limit|503|UNAVAILABLE|overloaded/i.test(String((err as any)?.message || err));
export const isAuthError = (err: unknown) => /API_KEY_INVALID|API key not valid|PERMISSION_DENIED|401|403|invalid.?api.?key|unauthori[sz]ed/i.test(String((err as any)?.message || err));

export class GeminiProvider implements AiProvider {
  kind = "gemini" as const;
  private client: GoogleGenAI | null = null;
  constructor(public id: string, private apiKey: string, private models: string[]) {}

  available() {
    return Boolean(this.apiKey && this.models.length);
  }

  private params(model: string, req: GenerateRequest) {
    return {
      model,
      contents: req.files?.length
        ? [{ role: "user", parts: [{ text: req.prompt }, ...req.files.map((f) => ({ inlineData: { mimeType: f.mime, data: f.base64 } }))] }]
        : req.prompt,
      config: {
        ...(req.system ? { systemInstruction: req.system } : {}),
        ...(req.json ? { responseMimeType: "application/json" } : {}),
        ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
        temperature: 0.3,
      },
    };
  }

  /** Each model has its own free quota: on quota/not-found move to the next model; anything else is final. */
  private async eachModel(fn: (model: string) => Promise<GenerateResponse>): Promise<GenerateResponse> {
    let lastErr: unknown;
    for (const model of this.models) {
      try {
        return await fn(model);
      } catch (err: any) {
        lastErr = err;
        if (!(isCapacityError(err) || /404|NOT_FOUND/i.test(String(err?.message || err)))) throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    this.client ||= new GoogleGenAI({ apiKey: this.apiKey });
    return this.eachModel(async (model) => {
      const res = await this.client!.models.generateContent(this.params(model, req));
      const text = res.text || "";
      if (!text) throw new Error("Empty response");
      return { text, tokensIn: res.usageMetadata?.promptTokenCount, tokensOut: res.usageMetadata?.candidatesTokenCount };
    });
  }

  async stream(req: GenerateRequest, onText: (chunk: string) => void): Promise<GenerateResponse> {
    this.client ||= new GoogleGenAI({ apiKey: this.apiKey });
    return this.eachModel(async (model) => {
      let text = "";
      let usage: any;
      for await (const chunk of await this.client!.models.generateContentStream(this.params(model, req))) {
        const t = chunk.text || "";
        if (t) { text += t; onText(t); }
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
      }
      if (!text) throw new Error("Empty response");
      return { text, tokensIn: usage?.promptTokenCount, tokensOut: usage?.candidatesTokenCount };
    });
  }
}

/** Any OpenAI-compatible chat-completions API (Groq, OpenRouter, Cerebras, Together, ...). */
export class OpenAiCompatProvider implements AiProvider {
  kind = "compat" as const;
  constructor(public id: string, private baseUrl: string, private apiKey: string, private model: string) {}

  available() {
    return Boolean(this.apiKey && this.baseUrl && this.model);
  }

  private request(req: GenerateRequest, stream: boolean, signal: AbortSignal) {
    return fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.3,
        ...(stream ? { stream: true } : {}),
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          ...(req.system ? [{ role: "system", content: req.system }] : []),
          { role: "user", content: req.json ? `${req.prompt}\n\nRespond with a single valid JSON object only.` : req.prompt },
        ],
      }),
    });
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await this.request(req, false, controller.signal);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      const data: any = await res.json();
      const text = data?.choices?.[0]?.message?.content || "";
      if (!text) throw new Error("Empty response");
      return { text, tokensIn: data?.usage?.prompt_tokens, tokensOut: data?.usage?.completion_tokens };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Server-sent events: `data: {choices:[{delta:{content}}]}` lines, ending with `data: [DONE]`. */
  async stream(req: GenerateRequest, onText: (chunk: string) => void): Promise<GenerateResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await this.request(req, true, controller.signal);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      const decoder = new TextDecoder();
      let buf = "";
      let text = "";
      let usage: any;
      for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(part, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const data = JSON.parse(payload);
            const t = data?.choices?.[0]?.delta?.content || "";
            if (t) { text += t; onText(t); }
            if (data?.usage) usage = data.usage;
          } catch { /* keep-alive or partial line */ }
        }
      }
      if (!text) throw new Error("Empty response");
      return { text, tokensIn: usage?.prompt_tokens, tokensOut: usage?.completion_tokens };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Well-known free OpenAI-compatible providers, offered as presets in Admin → AI setup. Models are editable. */
export const COMPAT_PRESETS: Record<string, { label: string; baseUrl: string; model: string; keyUrl: string }> = {
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", keyUrl: "https://console.groq.com/keys" },
  openrouter: { label: "OpenRouter (free models)", baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free", keyUrl: "https://openrouter.ai/settings/keys" },
  cerebras: { label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", model: "llama-3.3-70b", keyUrl: "https://cloud.cerebras.ai/" },
};

const versionOf = (name: string) => Number((name.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);

/**
 * Ask Google which models this key can use and pick the newest stable Flash and Flash-Lite. Model names change often,
 * so detecting them beats hard-coding. Returns [] if the listing fails; callers then fall back to configured names.
 */
export async function detectGeminiModels(apiKey: string): Promise<string[]> {
  // Key in a header (works for every key format, and keeps it out of URLs and logs).
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": apiKey } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  const names: string[] = (data?.models || [])
    .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m: any) => String(m.name).replace(/^models\//, ""))
    .filter((n: string) => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n)); // stable names only: no -preview, -exp, -tts, -image
  const newest = (lite: boolean) => names.filter((n) => n.endsWith("-lite") === lite).sort((a, b) => versionOf(b) - versionOf(a))[0];
  return [newest(false), newest(true)].filter(Boolean) as string[];
}

/** One tiny real request, so "Test" proves the key works end to end. */
export async function pingProvider(p: AiProvider): Promise<void> {
  const r = await p.generate({ prompt: 'Reply with the JSON {"ok":true}', json: true, maxTokens: 20 });
  if (!/ok/i.test(r.text)) throw new Error("Unexpected reply from the model");
}
