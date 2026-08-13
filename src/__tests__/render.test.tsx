// @vitest-environment jsdom
/**
 * Render smoke tests.
 *
 * These exist because of a bug that only appeared in the production build: the
 * store's `useDb` returned a freshly built object as its `useSyncExternalStore`
 * snapshot, so React re-rendered forever and the deployed app showed a blank
 * page ("Maximum update depth exceeded"). Development only warned about it.
 *
 * Rendering the real routes in jsdom turns that class of mistake into a failing
 * test: an unstable snapshot or a state update loop throws here rather than in
 * front of a student.
 */

import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import App from '../App';
import { ThemeProvider } from '../lib/theme';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/**
 * React 18.3 exports `act` itself; `react-dom/test-utils` is deprecated and its
 * copy does not flush updates here. The cast is only because the bundled
 * `@types/react` predates the export.
 */
const act = (React as unknown as {
  act: (callback: () => Promise<unknown> | void) => Promise<void>;
}).act;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  // jsdom implements neither of these, and the theme system asks for the first
  // one on mount.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

afterEach(async () => {
  await act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  // Each test starts from a fresh guest browser.
  window.localStorage?.clear();
});

/**
 * Mounts the whole app at `path` and waits until `ready` is satisfied.
 *
 * `ready` matters for redirects: a guard sends /dashboard to /login, so the tree
 * settles more than once and "something rendered" is too weak a signal.
 */
async function renderAt(
  path: string,
  ready: (view: HTMLElement) => boolean = (view) => view.textContent !== '',
): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root!.render(
      <StrictMode>
        <ThemeProvider>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </ThemeProvider>
      </StrictMode>,
    );
  });

  // Routes other than the landing page are code-split, so the first pass only
  // renders the Suspense fallback. Yield until the dynamic import has settled
  // and the page has painted something.
  for (let attempt = 0; attempt < 50 && !ready(container); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  return container;
}

/** The sign-in form has arrived (used for the redirect cases). */
const hasPasswordField = (view: HTMLElement): boolean =>
  view.querySelector('input[type="password"]') !== null;

describe('app rendering', () => {
  it('renders the landing page for a guest', async () => {
    const view = await renderAt('/');
    expect(view.textContent, view.innerHTML).toContain('AcadMap');
  });

  it('renders the GPA calculator without an account', async () => {
    const view = await renderAt('/calculator');
    expect(view.textContent?.toLowerCase()).toContain('gpa');
  });

  it('renders the sign-in page', async () => {
    const view = await renderAt('/login', hasPasswordField);
    expect(view.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('sends a signed-out visitor from the dashboard to sign-in', async () => {
    const view = await renderAt('/app', hasPasswordField);
    expect(view.querySelector('input[type="password"]'), view.textContent ?? '').not.toBeNull();
  });
});
