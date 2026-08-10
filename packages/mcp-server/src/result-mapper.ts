import type { AppError, Result } from '@lnwjud/domain';

export interface McpTextContent {
  readonly type: 'text';
  readonly text: string;
}

export interface McpToolResponse {
  readonly content: readonly McpTextContent[];
  readonly isError?: boolean;
  readonly structuredContent?: Readonly<Record<string, unknown>>;
}

export function mapResult<T>(result: Result<T>): McpToolResponse {
  if (!result.ok) return mapError(result.error);
  const structuredContent = toStructuredContent(result.value);
  return {
    content: [{ type: 'text', text: toText(result.value) }],
    ...(structuredContent === undefined ? {} : { structuredContent }),
  };
}

export function mapError(error: AppError): McpToolResponse {
  const message = error.code === 'INTERNAL_ERROR' ? 'Operation failed' : error.message;
  return {
    isError: true,
    content: [{ type: 'text', text: `${error.code}: ${message}` }],
    structuredContent: { error: { code: error.code, message, recoverable: error.recoverable } },
  };
}

function toText(value: unknown): string {
  if (value === undefined) return 'null';
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 'null' : serialized;
}

function toStructuredContent(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { value };
  return value as Readonly<Record<string, unknown>>;
}
