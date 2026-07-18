/**
 * Translator for Anthropic Messages API.
 * Maps Anthropic POST /v1/messages request format to Gemini API format,
 * then prepares it for Google Antigravity.
 */

import { cleanJSONSchemaForAntigravity } from "../../plugin/request-helpers";
import { prepareAntigravityRequest, type PrepareRequestOptions } from "../../plugin/request";
import type { HeaderStyle } from "../../constants";

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<{
    type: "text" | "tool_use" | "tool_result";
    text?: string;
    id?: string;
    name?: string;
    input?: any;
    tool_use_id?: string;
    content?: string | Array<{ type: "text"; text: string }>;
    is_error?: boolean;
  }>;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: any;
}

export interface AnthropicRequestPayload {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: "text"; text: string }>;
  tools?: AnthropicTool[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  thinking?: {
    type: "enabled" | "disabled";
    budget_tokens: number;
  };
}

/**
 * Converts Anthropic messages to Gemini contents.
 */
export function translateMessagesToGemini(messages: AnthropicMessage[]): any[] {
  return messages.map((msg) => {
    const role = msg.role === "assistant" ? "model" : "user";
    const parts: any[] = [];

    if (typeof msg.content === "string") {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          parts.push({ text: block.text });
        } else if (block.type === "tool_use") {
          parts.push({
            functionCall: {
              name: block.name,
              args: block.input || {},
            },
            // Store tool use ID so we can match it back during response mapping
            thought_signature: block.id, 
            thoughtSignature: block.id,
          });
        } else if (block.type === "tool_result") {
          let textResult = "";
          if (typeof block.content === "string") {
            textResult = block.content;
          } else if (Array.isArray(block.content)) {
            textResult = block.content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("\n");
          }
          parts.push({
            functionResponse: {
              name: block.tool_use_id || "unknown_tool",
              response: { result: textResult },
            },
          });
        }
      }
    }

    return { role, parts };
  });
}

/**
 * Converts Anthropic tools to Gemini function declarations.
 */
export function translateToolsToGemini(tools: AnthropicTool[]): any[] {
  if (!tools || tools.length === 0) return [];
  const functionDeclarations = tools.map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    parameters: cleanJSONSchemaForAntigravity(tool.input_schema),
  }));
  return [{ functionDeclarations }];
}

/**
 * Main entry point: translates an Anthropic Messages request and wraps it in the Antigravity request format.
 */
export function translateRequest(
  anthropicBody: AnthropicRequestPayload,
  accessToken: string,
  projectId: string,
  headerStyle: HeaderStyle = "antigravity",
  options?: PrepareRequestOptions,
): {
  request: RequestInfo;
  init: RequestInit;
  streaming: boolean;
  effectiveModel: string;
} {
  // Translate fields to Gemini format
  const contents = translateMessagesToGemini(anthropicBody.messages);
  const tools = translateToolsToGemini(anthropicBody.tools || []);
  
  let systemInstruction: any = undefined;
  if (anthropicBody.system) {
    let systemText = "";
    if (typeof anthropicBody.system === "string") {
      systemText = anthropicBody.system;
    } else if (Array.isArray(anthropicBody.system)) {
      systemText = anthropicBody.system
        .filter((s) => s.type === "text")
        .map((s) => s.text)
        .join("\n");
    }
    if (systemText) {
      systemInstruction = { parts: [{ text: systemText }] };
    }
  }

  const generationConfig: any = {};
  if (anthropicBody.max_tokens) {
    generationConfig.maxOutputTokens = anthropicBody.max_tokens;
  }
  if (anthropicBody.temperature !== undefined) {
    generationConfig.temperature = anthropicBody.temperature;
  }
  if (anthropicBody.thinking && anthropicBody.thinking.type === "enabled") {
    generationConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingBudget: anthropicBody.thinking.budget_tokens,
    };
  }

  // Create the standard Gemini request body
  const geminiPayload: any = {
    contents,
    generationConfig,
  };
  if (systemInstruction) geminiPayload.systemInstruction = systemInstruction;
  if (tools.length > 0) geminiPayload.tools = tools;

  // Wrap it in the Antigravity envelope format
  const envelope = {
    project: projectId,
    model: anthropicBody.model,
    request: geminiPayload,
  };

  // Generate a mock RequestInit targeting generativelanguage.googleapis.com,
  // which prepareAntigravityRequest intercepts and redirects to cloudcode-pa
  const mockUrl = `https://generativelanguage.googleapis.com/v1beta/models/${anthropicBody.model}:${anthropicBody.stream ? "streamGenerateContent" : "generateContent"}`;
  
  const mockInit: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(envelope),
  };

  // Pass it through the existing preparation layer to handle rotation, fingerprinting, headers, and thinking configs
  const prep = prepareAntigravityRequest(
    mockUrl,
    mockInit,
    accessToken,
    projectId,
    undefined, // baseEndpoint (falls back to default daily/prod)
    headerStyle,
    false, // forceThinkingRecovery
    options,
  );

  return {
    request: prep.request,
    init: prep.init,
    streaming: prep.streaming,
    effectiveModel: prep.effectiveModel || anthropicBody.model,
  };
}
