import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './workspace.css';

const pages = {
  day: lazy(() => import('./pages/DayOrganizer').then(module=>({default:module.DayOrganizer}))),
  ideas: lazy(() => import('./pages/IdeaInbox').then(module=>({default:module.IdeaInbox}))),
  scripts: lazy(() => import('./pages/ScriptsLibrary').then(module=>({default:module.ScriptsLibrary}))),
  learning: lazy(() => import('./pages/LearningTracker').then(module=>({default:module.LearningTracker}))),
  bookmarks: lazy(() => import('./pages/Bookmarks').then(module=>({default:module.Bookmarks}))),
  files: lazy(() => import('./pages/FileSharing').then(module=>({default:module.FileSharing}))),
  launcher: lazy(() => import('./pages/QuickLauncher').then(module=>({default:module.QuickLauncher}))),
};
export function mountWorkspace(host: HTMLElement, selected: keyof typeof pages) {
  const shadow = host.attachShadow({ mode: 'open' });
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/static/productivity/workspace.css';
  const content = document.createElement('div'); content.className = 'personal-workspace';
  const portals = document.createElement('div'); portals.id = 'workspace-portals';
  const native = document.createElement('link'); native.rel='stylesheet'; native.href='/static/productivity/native.css';
  shadow.append(css, native, content, portals);
  const root = createRoot(content);
  let current=selected;
  let revision=0;
  const render = (page: keyof typeof pages) => {
    const Page = pages[page];
    if (!Page) return;
    current=page;
    root.render(<Suspense fallback={<p role="status">Opening your workspace…</p>}><Page key={`${page}:${revision}`} /></Suspense>);
  };
  render(selected);
  return { select: render, refresh:()=>{revision++;render(current);}, close: () => root.unmount() };
}
