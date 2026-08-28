import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DoctorPanel } from '../src/renderer/features/doctor/DoctorPanel.js';

describe('Doctor recovery actions', () => {
  it('offers Add Project recovery when the workspace check is not ready', () => {
    const markup = renderToStaticMarkup(createElement(DoctorPanel, {
      locale: 'en',
      report: {
        exitCode: 0,
        checks: [{ id: 'workspaces', required: false, status: 'warn', message: 'No project workspace is registered yet' }],
      },
      onRunDoctor: async () => undefined,
      onOpenProjects: () => undefined,
    }));

    expect(markup).toContain('Add Project');
  });
});
