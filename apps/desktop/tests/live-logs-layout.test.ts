import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiveLogsPage } from '../src/renderer/features/live/LiveLogsPage.js';
import { LogStreamPanel } from '../src/renderer/features/live/LogStreamPanel.js';
import { StandaloneLogViewer } from '../src/renderer/features/live/StandaloneLogViewer.js';

const noop = async (): Promise<void> => undefined;

describe('Live Logs scroll layout', () => {
  it('marks both embedded and pop-out viewers with dedicated outer-scroll containers', () => {
    const embedded = renderToStaticMarkup(createElement(LiveLogsPage, {
      locale: 'en', lines: [], tunnelLogPath: null, tunnelLogExists: false,
      onClear: noop, onExport: noop, onPopOut: noop, onCaptureIncident: noop,
      incidentBusy: false, incidentClassification: null, incidentCapturedAt: null, incidentNotice: null,
    }));
    const standalone = renderToStaticMarkup(createElement(StandaloneLogViewer));

    expect(embedded).toContain('class="page-content live-logs-page"');
    expect(standalone).toContain('class="window-container log-viewer-window"');
  });

  it('renders newest log lines first regardless of arrival order', () => {
    const markup = renderToStaticMarkup(createElement(LogStreamPanel, {
      source: 'mcp',
      title: 'MCP',
      lines: [
        { id: 1, source: 'mcp', timestamp: '2026-08-22T00:00:01.000Z', level: 'info', text: 'old-line' },
        { id: 3, source: 'mcp', timestamp: '2026-08-22T00:00:03.000Z', level: 'info', text: 'new-line' },
        { id: 2, source: 'mcp', timestamp: '2026-08-22T00:00:02.000Z', level: 'info', text: 'middle-line' },
      ],
      filterPlaceholder: 'filter', pauseLabel: 'pause', followLabel: 'follow', clearLabel: 'clear', exportLabel: 'export',
      onClear: noop, onExport: noop,
    }));
    expect(markup.indexOf('new-line')).toBeLessThan(markup.indexOf('middle-line'));
    expect(markup.indexOf('middle-line')).toBeLessThan(markup.indexOf('old-line'));
  });

  it('keeps vertical scrolling on the page/window instead of trapping it inside the log table', () => {
    const css = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.log-viewer-window\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.live-logs-page \.log-stream\s*\{[^}]*overflow-y:\s*visible/s);
    expect(css).toMatch(/\.log-viewer-shell \.log-stream\s*\{[^}]*overflow-y:\s*visible/s);
    expect(css).toMatch(/\.log-viewer-shell\s*\{[^}]*min-height:\s*calc\(100vh - 38px\)[^}]*height:\s*auto/s);
  });
});
