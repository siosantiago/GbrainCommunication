import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type LLMProvider = "anthropic" | "openai" | "none";

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
}

export function detectProvider(apiKey: string | undefined): LLMProvider {
  if (!apiKey || apiKey.startsWith("demo_")) return "none";
  if (apiKey.startsWith("sk-ant-")) return "anthropic";
  if (apiKey.startsWith("sk-")) return "openai"; // sk- and sk-proj- are both OpenAI
  return "none";
}

export class LLMClient {
  private readonly anthropic?: Anthropic;
  private readonly openai?: OpenAI;
  readonly provider: LLMProvider;

  constructor(apiKey: string | undefined) {
    this.provider = detectProvider(apiKey);
    if (this.provider === "anthropic") {
      this.anthropic = new Anthropic({ apiKey: apiKey! });
    } else if (this.provider === "openai") {
      this.openai = new OpenAI({ apiKey: apiKey! });
    }
  }

  get available(): boolean {
    return this.provider !== "none";
  }

  async complete(prompt: string, options: LLMOptions = {}): Promise<string> {
    const { maxTokens = 900, temperature = 0.2 } = options;

    if (this.anthropic) {
      const response = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-latest",
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: "user", content: prompt }],
      });
      return response.content.map((block) => ("text" in block ? block.text : "")).join("").trim();
    }

    if (this.openai) {
      return this.openaiWithRetry(prompt, maxTokens, temperature);
    }

    return "";
  }

  private async openaiWithRetry(prompt: string, maxTokens: number, temperature: number, attempt = 0): Promise<string> {
    try {
      const response = await this.openai!.chat.completions.create({
        model: "gpt-3.5-turbo",
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: "user", content: prompt }],
      });
      return (response.choices[0]?.message?.content ?? "").trim();
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 429 && attempt < 4) {
        const delay = (attempt + 1) * 3000; // 3s, 6s, 9s, 12s
        await new Promise((res) => setTimeout(res, delay));
        return this.openaiWithRetry(prompt, maxTokens, temperature, attempt + 1);
      }
      throw err;
    }
  }
}
