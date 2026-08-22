import { defineTool, missingService, type McpToolContext, type McpToolDefinition } from './tool-types.js';
import type { Result } from '@lnwjud/domain';
import { SetOfMarksService } from '../set-of-marks-service.js';
import {
  accessibilityCapabilitySchema,
  audioCapabilitySchema,
  clipboardCapabilitySchema,
  domCdpCapabilitySchema,
  fileDialogCapabilitySchema,
  healthCapabilitySchema,
  inputEventCapabilitySchema,
  notificationCapabilitySchema,
  officeCapabilitySchema,
  schedulerCapabilitySchema,
  screenRecordCapabilitySchema,
  shellCapabilitySchema,
  systemInfoCapabilitySchema,
  visionCapabilitySchema,
  visionAnnotatedCaptureSchema,
  uiTargetActionSchema,
  webFetchCapabilitySchema,
  windowCapabilitySchema,
  wslCapabilitySchema,
  wslFilesystemCapabilitySchema,
} from './schemas.js';

const MCP_MAX_POLL_WAIT_SECONDS = 5;

function normalizeNonBlockingCliInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const request = input as Record<string, unknown>;
  const operation = request.operation ?? 'run';
  if (operation === 'run') return { ...request, execution: 'background' };
  if (operation === 'wait') {
    const requestedWait = typeof request.timeout_seconds === 'number' ? request.timeout_seconds : MCP_MAX_POLL_WAIT_SECONDS;
    return { ...request, timeout_seconds: Math.min(requestedWait, MCP_MAX_POLL_WAIT_SECONDS) };
  }
  return input;
}

export function capabilityTools(context: McpToolContext): McpToolDefinition[] {
  const execute = (tool: Parameters<NonNullable<McpToolContext['services']['capabilities']>['execute']>[0], input: unknown, signal?: AbortSignal): Promise<Result<unknown>> => (
    context.services.capabilities === undefined
      ? Promise.resolve(missingService())
      : context.services.capabilities.execute(
        tool,
        tool === 'shell' || tool === 'wsl_exec' ? normalizeNonBlockingCliInput(input) : input,
        signal,
      )
  );
  const setOfMarks = new SetOfMarksService(context.services.capabilities);

  return [
    defineTool({
      name: 'shell',
      description: 'Non-blocking command runner for system operations and CLI tasks. MCP run calls are ALWAYS forced to execution=background, even if a client requests foreground or auto, so the call returns a task_id immediately instead of waiting for command completion. Follow with status/logs/result; wait is capped to a short 5-second poll. Never hold a tool call open waiting for a build, test, install, package, or other command to finish. Destructive shell commands still require explicit chat confirmation and userConfirmed: true.',
      permission: 'EXECUTE',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: shellCapabilitySchema,
      handler: async (input, signal) => execute('shell', input, signal),
    }),
    defineTool({
      name: 'dom_cdp',
      description: 'Default for web-page DOM work inside managed Chrome: inspect content, query selectors, click, type, navigate, evaluate JavaScript, wait, manage tabs, and capture screenshots. Use steps to batch related DOM actions in one call.',
      permission: 'DANGEROUS',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: domCdpCapabilitySchema,
      handler: async (input, signal) => execute('dom_cdp', input, signal),
    }),
    defineTool({
      name: 'accessibility',
      description: 'Semantic native Windows UI tool. Inspect UI trees and named controls, then click, focus, read or set values, select controls and menus, or manage a native element. Prefer shell for direct system work and dom_cdp for web pages.',
      permission: 'DANGEROUS',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: accessibilityCapabilitySchema,
      handler: async (input, signal) => execute('accessibility', input, signal),
    }),
    defineTool({
      name: 'input_event',
      description: 'Low-level keyboard and pointer fallback. Use only when DOM/CDP and Accessibility cannot operate the target. Supports text, keys, mouse movement, clicks, drag, scroll, held buttons, release_all, and batched sequences.',
      permission: 'DANGEROUS',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: inputEventCapabilitySchema,
      handler: async (input, signal) => execute('input_event', input, signal),
    }),
    defineTool({
      name: 'vision',
      description: 'Visual and OCR fallback for content unavailable through DOM or Accessibility. Capture a display, window, or region, or run local Vision OCR. It never clicks or types.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: visionCapabilitySchema,
      handler: async (input, signal) => execute('vision', input, signal),
    }),
    defineTool({
      name: 'vision_annotated_capture',
      description: 'Capture a local Windows screen/region/window and return a short-lived Set-of-Marks observation with numbered bounds, a content hash, and an annotated PNG. This tool only observes; use ui_target_action for a separately gated action.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: visionAnnotatedCaptureSchema,
      handler: async (input, signal) => setOfMarks.capture(input, signal),
    }),
    defineTool({
      name: 'ui_target_action',
      description: 'Act on one mark from a current vision_annotated_capture observation. The observation ID, optional hash, TTL, workspace owner, and current Accessibility element are checked before the action is sent.',
      permission: 'DANGEROUS',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: uiTargetActionSchema,
      handler: async (input, signal) => setOfMarks.act(input, signal),
    }),
    defineTool({
      name: 'window',
      description: 'Direct native Windows window management. List, inspect, activate, move, resize, minimize, maximize, restore, or close windows without raw coordinates when a window operation is sufficient.',
      permission: 'DANGEROUS',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: windowCapabilitySchema,
      handler: async (input, signal) => execute('window', input, signal),
    }),
    defineTool({
      name: 'health',
      description: 'Diagnostics only. Check all lnwjud backends or one public tool after a failure, when asked for status, or while diagnosing permissions. Do not use as a preflight before normal work.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: healthCapabilitySchema,
      handler: async (input, signal) => execute('health', input, signal),
    }),
    defineTool({
      name: 'system_info',
      description: 'Read-only system information: OS, CPU, memory, disks, battery, uptime, and top processes by memory. Use for environment checks and diagnostics.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: systemInfoCapabilitySchema,
      handler: async (input, signal) => execute('system_info', input, signal),
    }),
    defineTool({
      name: 'notification',
      description: 'Show a Windows notification (toast when BurntToast is installed, balloon otherwise). Use to tell the user when a long task finishes.',
      permission: 'EXECUTE',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: notificationCapabilitySchema,
      handler: async (input, signal) => execute('notification', input, signal),
    }),
    defineTool({
      name: 'file_dialog',
      description: 'Open a native Windows file open/save dialog and return the chosen path(s). The dialog does not read or write files itself; use the guarded file tools afterwards.',
      permission: 'EXECUTE',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: fileDialogCapabilitySchema,
      handler: async (input, signal) => execute('file_dialog', input, signal),
    }),
    defineTool({
      name: 'clipboard',
      description: 'Read or write the Windows clipboard (text, or PNG image as base64). Use get_text/get_image to read and set_text to write.',
      permission: 'DANGEROUS',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: clipboardCapabilitySchema,
      handler: async (input, signal) => execute('clipboard', input, signal),
    }),
    defineTool({
      name: 'web_fetch',
      description: 'Fetch an http/https URL (GET/POST/PUT/DELETE/HEAD) with bounded size and timeout. HTTP DELETE requires explicit chat confirmation and userConfirmed: true. Returns status, headers, and text or base64 body.',
      permission: 'DANGEROUS',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: webFetchCapabilitySchema,
      handler: async (input, signal) => execute('web_fetch', input, signal),
    }),
    defineTool({
      name: 'audio',
      description: 'Record the microphone to a WAV file or play a local audio file through MCI. record is synchronous and limited to 600 seconds. Use stop to abort an ongoing record/play.',
      permission: 'DANGEROUS',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: audioCapabilitySchema,
      handler: async (input, signal) => execute('audio', input, signal),
    }),
    defineTool({
      name: 'screen_record',
      description: 'Record the screen to an MP4 using ffmpeg gdigrab (requires ffmpeg on PATH). start spawns a background capture, status checks it, stop finalizes the file. Recording stops automatically after 3600 seconds.',
      permission: 'DANGEROUS',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: screenRecordCapabilitySchema,
      handler: async (input, signal) => execute('screen_record', input, signal),
    }),
    defineTool({
      name: 'office',
      description: 'Automate Excel or Word through COM. Mutating actions (write, replace, save_as) require explicit chat confirmation and userConfirmed: true. Requires Microsoft Office installed.',
      permission: 'DANGEROUS',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: officeCapabilitySchema,
      handler: async (input, signal) => execute('office', input, signal),
    }),
    defineTool({
      name: 'scheduler',
      description: 'Manage Windows scheduled tasks with schtasks.exe. list enumerates tasks, create registers a new task, run starts one immediately. delete requires the user to confirm in chat first, then pass userConfirmed: true.',
      permission: 'DANGEROUS',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: schedulerCapabilitySchema,
      handler: async (input, signal) => execute('scheduler', input, signal),
    }),
    defineTool({
      name: 'wsl_exec',
      description: 'Non-blocking WSL2 developer runner. MCP run calls are ALWAYS forced to background and return a task_id immediately; foreground/auto requests are normalized by the server. Follow with status/logs/result; wait is capped to a short 5-second poll. It executes one Linux executable with argv, an explicit distribution, and a registered Windows workspace cwd, and never accepts shell command strings.',
      permission: 'EXECUTE',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: wslCapabilitySchema,
      handler: async (input, signal) => execute('wsl_exec', input, signal),
    }),
    defineTool({
      name: 'wsl_fs',
      description: 'Translate paths and inspect metadata between a registered Windows workspace and WSL without exposing raw \\\\wsl$ read/write access.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: wslFilesystemCapabilitySchema,
      handler: async (input, signal) => execute('wsl_fs', input, signal),
    }),
  ];
}
