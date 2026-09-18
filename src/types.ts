// Minimal mirror of pi-ai's message shapes (@earendil-works/pi-ai 0.85.x). Kept local so the
// prototype has no runtime dependency on pi; real sessions deserialize into the same shapes.

export interface TextContent {
	type: "text";
	text: string;
}

export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, any>;
}

export interface UserMessage {
	role: "user";
	content: string | TextContent[];
}

export interface AssistantMessage {
	role: "assistant";
	content: Array<TextContent | ToolCall | { type: "thinking"; thinking: string }>;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: TextContent[];
	isError: boolean;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export const LABELS = ["KEEP", "TRUNCATE", "DROP"] as const;
export type Label = (typeof LABELS)[number];
export type Prediction = Label | "UNCERTAIN";
