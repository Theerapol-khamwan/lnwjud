import { appError, err, ok, type Result } from '@lnwjud/domain';
import type { CapabilityService } from '@lnwjud/capabilities';
import { SetOfMarksService } from './set-of-marks-service.js';

interface ComputerUseInput extends Record<string, unknown> {
  readonly workspaceId: string;
  readonly action: string;
  readonly userConfirmed?: boolean;
  readonly dry_run?: boolean;
  readonly target?: unknown;
}

interface ComputerUseTarget extends Record<string, unknown> {
  readonly name?: string;
  readonly automation_id?: string;
  readonly observationId?: string;
  readonly observationHash?: string;
  readonly markId?: string;
  readonly x?: number;
  readonly y?: number;
}

/**
 * High-level native desktop control facade.
 *
 * Routing order deliberately mirrors how a human/GUI agent should operate:
 * semantic UI Automation first, revalidated Set-of-Marks when a visual mark is
 * supplied, and raw pointer/keyboard input only when coordinates or focused
 * input are explicitly requested.
 */
export class ComputerUseService {
  public constructor(
    private readonly capabilities: CapabilityService | undefined,
    private readonly setOfMarks: SetOfMarksService,
  ) {}

  public async execute(input: unknown, signal?: AbortSignal): Promise<Result<unknown>> {
    if (!isRecord(input) || typeof input.workspaceId !== 'string' || typeof input.action !== 'string') {
      return err(appError('INVALID_INPUT', 'computer_use input is invalid'));
    }
    if (signal?.aborted === true) return cancelledResult();
    const request = input as ComputerUseInput;

    switch (request.action) {
      case 'snapshot': return this.snapshot(request, signal);
      case 'inspect': return this.inspect(request, signal);
      case 'click': return this.click(request, signal);
      case 'double_click': return this.coordinateInput('double_click', request, signal);
      case 'right_click': return this.coordinateInput('right_click', request, signal);
      case 'mouse_move': return this.coordinateInput('mouse_move', request, signal);
      case 'type_text': return this.typeText(request, signal);
      case 'press_key': return this.inputEvent('press_key', { key: request.key }, request, signal);
      case 'hotkey': return this.inputEvent('hotkey', { key: request.key, modifiers: request.modifiers }, request, signal);
      case 'scroll': return this.inputEvent('scroll', { delta_y: request.delta_y }, request, signal);
      case 'drag': return this.inputEvent('drag', { from: request.from, to: request.to }, request, signal);
      case 'activate_window': return this.activateWindow(request, signal);
      default: return err(appError('INVALID_INPUT', `Unsupported computer_use action: ${request.action}`));
    }
  }

  private async snapshot(request: ComputerUseInput, signal?: AbortSignal): Promise<Result<unknown>> {
    const captureInput = compact({
      workspaceId: request.workspaceId,
      capture: request.capture ?? 'display',
      region: request.region,
      app: request.app,
      window_index: request.window_index,
      display_id: request.display_id,
      max_depth: request.max_depth,
      max_marks: request.max_marks,
      ttl_seconds: request.ttl_seconds,
    });
    const annotated = await this.setOfMarks.capture(captureInput, signal);
    if (annotated.ok) return ok({ mode: 'annotated', ...asRecord(annotated.value) });
    if (signal?.aborted === true) return cancelledResult();

    const fallback = await this.executeCapability('vision', compact({
      action: `capture_${String(request.capture ?? 'display')}`,
      region: request.region,
      app: request.app,
      window_index: request.window_index,
      display_id: request.display_id,
    }), signal);
    if (!fallback.ok) return annotated;
    return ok({
      mode: 'visual_fallback',
      semantic_available: false,
      semantic_error: annotated.error,
      image: fallback.value,
    });
  }

  private async inspect(request: ComputerUseInput, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.executeCapability('accessibility', {
      action: 'observe',
      parameters: compact({
        ...asRecord(request.app),
        window_index: request.window_index,
        max_depth: request.max_depth,
        max_items: request.max_items,
      }),
    }, signal);
  }

  private async click(request: ComputerUseInput, signal?: AbortSignal): Promise<Result<unknown>> {
    const target = readTarget(request.target);
    if (target === undefined) return err(appError('INVALID_INPUT', 'computer_use click requires a target'));
    if (hasMarkTarget(target)) {
      return this.setOfMarks.act(compact({
        workspaceId: request.workspaceId,
        observationId: target.observationId,
        observationHash: target.observationHash,
        markId: target.markId,
        action: 'click',
        userConfirmed: request.userConfirmed,
        dry_run: request.dry_run,
      }), signal);
    }
    if (hasSemanticTarget(target)) {
      return this.executeCapability('accessibility', {
        action: 'click',
        parameters: { ...asRecord(request.app), ...target },
        userConfirmed: request.userConfirmed,
        dry_run: request.dry_run,
      }, signal);
    }
    return this.coordinateInput('click', request, signal, target);
  }

  private async typeText(request: ComputerUseInput, signal?: AbortSignal): Promise<Result<unknown>> {
    if (typeof request.text !== 'string') return err(appError('INVALID_INPUT', 'computer_use type_text requires text'));
    const target = readTarget(request.target);
    if (target !== undefined) {
      const focused = hasMarkTarget(target)
        ? await this.setOfMarks.act(compact({
            workspaceId: request.workspaceId,
            observationId: target.observationId,
            observationHash: target.observationHash,
            markId: target.markId,
            action: 'focus',
            userConfirmed: request.userConfirmed,
            dry_run: request.dry_run,
          }), signal)
        : hasSemanticTarget(target)
          ? await this.executeCapability('accessibility', {
              action: 'focus',
              parameters: { ...asRecord(request.app), ...target },
              userConfirmed: request.userConfirmed,
              dry_run: request.dry_run,
            }, signal)
          : ok(undefined);
      if (!focused.ok) return focused;
      if (signal?.aborted === true) return cancelledResult();
    }
    return this.inputEvent('type_text', { text: request.text }, request, signal);
  }

  private async coordinateInput(
    operation: 'click' | 'double_click' | 'right_click' | 'mouse_move',
    request: ComputerUseInput,
    signal?: AbortSignal,
    suppliedTarget?: ComputerUseTarget,
  ): Promise<Result<unknown>> {
    const target = suppliedTarget ?? readTarget(request.target);
    if (target === undefined || !isFiniteNumber(target.x) || !isFiniteNumber(target.y)) {
      return err(appError('INVALID_INPUT', `computer_use ${operation} requires finite x/y coordinates`));
    }
    return this.inputEvent(operation, { x: target.x, y: target.y }, request, signal);
  }

  private async inputEvent(operation: string, parameters: Readonly<Record<string, unknown>>, request: ComputerUseInput, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.executeCapability('input_event', {
      operation,
      parameters,
      userConfirmed: request.userConfirmed,
      dry_run: request.dry_run,
    }, signal);
  }

  private async activateWindow(request: ComputerUseInput, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.executeCapability('window', {
      operation: 'activate',
      parameters: compact({ ...asRecord(request.app), window_index: request.window_index }),
      userConfirmed: request.userConfirmed,
      dry_run: request.dry_run,
    }, signal);
  }

  private async executeCapability(tool: 'accessibility' | 'input_event' | 'vision' | 'window', input: unknown, signal?: AbortSignal): Promise<Result<unknown>> {
    if (this.capabilities === undefined) return err(appError('INTERNAL_ERROR', 'Capability service is unavailable', true));
    return this.capabilities.execute(tool, input, signal);
  }
}

function readTarget(value: unknown): ComputerUseTarget | undefined {
  return isRecord(value) ? value as ComputerUseTarget : undefined;
}

function hasMarkTarget(target: ComputerUseTarget): target is ComputerUseTarget & { observationId: string; markId: string } {
  return typeof target.observationId === 'string' && target.observationId.length > 0
    && typeof target.markId === 'string' && target.markId.length > 0;
}

function hasSemanticTarget(target: ComputerUseTarget): boolean {
  return (typeof target.name === 'string' && target.name.length > 0)
    || (typeof target.automation_id === 'string' && target.automation_id.length > 0);
}

function compact<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cancelledResult(): Result<never> {
  return err(appError('PROCESS_TIMEOUT', 'Computer use operation was cancelled', true));
}
