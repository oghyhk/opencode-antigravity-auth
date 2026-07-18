/**
 * Translator for streaming responses from Gemini SSE to Anthropic SSE.
 */

import { Transform, type TransformCallback } from "node:stream";
import crypto from "node:crypto";

export interface StreamContext {
  messageId: string;
  model: string;
  sentMessageStart: boolean;
  activeBlockIndex: number;
  activeBlockType: "text" | "thinking" | "tool_use" | null;
  toolUseId: string | null;
  toolUseName: string | null;
  toolUseInputBuffer: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Creates a transform stream that transcodes Gemini/Antigravity SSE to Anthropic SSE.
 */
export class GeminiToAnthropicStream extends Transform {
  private context: StreamContext;
  private buffer = "";

  constructor(model: string) {
    super({ readableObjectMode: false, writableObjectMode: false });
    this.context = {
      messageId: `msg_${crypto.randomUUID().replace(/-/g, "")}`,
      model,
      sentMessageStart: false,
      activeBlockIndex: -1,
      activeBlockType: null,
      toolUseId: null,
      toolUseName: null,
      toolUseInputBuffer: "",
      promptTokens: 0,
      completionTokens: 0,
    };
  }

  override _transform(chunk: any, encoding: string, callback: TransformCallback): void {
    this.buffer += chunk.toString("utf-8");
    const lines = this.buffer.split("\n");
    // Keep the last partial line in the buffer
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("data:")) {
        const jsonStr = trimmed.slice(5).trim();
        if (jsonStr === "[DONE]") {
          continue;
        }

        try {
          const payload = JSON.parse(jsonStr);
          this.processGeminiChunk(payload);
        } catch (error) {
          // Ignore parse errors for incomplete JSON or debug lines
        }
      }
    }
    callback();
  }

  override _flush(callback: TransformCallback): void {
    // Process remaining buffer
    if (this.buffer.trim().startsWith("data:")) {
      const jsonStr = this.buffer.trim().slice(5).trim();
      try {
        const payload = JSON.parse(jsonStr);
        this.processGeminiChunk(payload);
      } catch {}
    }

    // Ensure all blocks are closed and stream is terminated cleanly
    this.closeActiveBlock();

    const stopEvent = `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: this.context.completionTokens },
    })}\n\nevent: message_stop\ndata: ${JSON.stringify({
      type: "message_stop",
    })}\n\n`;

    this.push(stopEvent);
    callback();
  }

  private processGeminiChunk(chunk: any): void {
    // 1. Emit message_start if not sent yet
    if (!this.context.sentMessageStart) {
      const startEvent = `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: {
          id: this.context.messageId,
          type: "message",
          role: "assistant",
          model: this.context.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: this.context.promptTokens || 10, output_tokens: 0 },
        },
      })}\n\n`;
      this.push(startEvent);
      this.context.sentMessageStart = true;
    }

    const candidate = chunk.candidates?.[0];
    const part = candidate?.content?.parts?.[0];
    
    // Track usage metadata if provided
    if (chunk.usageMetadata) {
      this.context.promptTokens = chunk.usageMetadata.promptTokenCount || this.context.promptTokens;
      this.context.completionTokens = chunk.usageMetadata.candidatesTokenCount || this.context.completionTokens;
    }

    if (!part) return;

    // 2. Handle Thinking Block (thought: true, text)
    if (part.thought === true || part.type === "thinking") {
      const text = part.text || part.thinking || "";
      if (text) {
        this.ensureBlockOpen("thinking");
        const deltaEvent = `event: content_block_delta\ndata: ${JSON.stringify({
          type: "content_block_delta",
          index: this.context.activeBlockIndex,
          delta: { type: "thinking_delta", thinking: text },
        })}\n\n`;
        this.push(deltaEvent);
      }
      return;
    }

    // 3. Handle Tool Use (functionCall)
    if (part.functionCall) {
      const name = part.functionCall.name;
      const args = part.functionCall.args;
      const callId = part.thoughtSignature || part.thought_signature || `call_${crypto.randomUUID().slice(0, 8)}`;

      this.ensureBlockOpen("tool_use", callId, name);

      if (args) {
        let deltaText = "";
        try {
          deltaText = typeof args === "string" ? args : JSON.stringify(args);
        } catch {}

        if (deltaText) {
          const deltaEvent = `event: content_block_delta\ndata: ${JSON.stringify({
            type: "content_block_delta",
            index: this.context.activeBlockIndex,
            delta: { type: "input_json_delta", partial_json: deltaText },
          })}\n\n`;
          this.push(deltaEvent);
        }
      }
      return;
    }

    // 4. Handle Standard Text Part (text)
    if (part.text) {
      this.ensureBlockOpen("text");
      const deltaEvent = `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: this.context.activeBlockIndex,
        delta: { type: "text_delta", text: part.text },
      })}\n\n`;
      this.push(deltaEvent);
    }
  }

  private ensureBlockOpen(type: "text" | "thinking" | "tool_use", toolCallId?: string, toolCallName?: string): void {
    if (this.context.activeBlockType === type) {
      return;
    }

    this.closeActiveBlock();

    this.context.activeBlockIndex++;
    this.context.activeBlockType = type;

    let startData: any = { type };
    if (type === "text") {
      startData = { type: "text", text: "" };
    } else if (type === "thinking") {
      startData = { type: "thinking", thinking: "" };
    } else if (type === "tool_use") {
      this.context.toolUseId = toolCallId || null;
      this.context.toolUseName = toolCallName || null;
      startData = {
        type: "tool_use",
        id: toolCallId,
        name: toolCallName,
        input: {},
      };
    }

    const startEvent = `event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start",
      index: this.context.activeBlockIndex,
      content_block: startData,
    })}\n\n`;
    this.push(startEvent);
  }

  private closeActiveBlock(): void {
    if (this.context.activeBlockType === null) return;

    const stopEvent = `event: content_block_stop\ndata: ${JSON.stringify({
      type: "content_block_stop",
      index: this.context.activeBlockIndex,
    })}\n\n`;
    this.push(stopEvent);

    this.context.activeBlockType = null;
    this.context.toolUseId = null;
    this.context.toolUseName = null;
  }
}
