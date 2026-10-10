import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type DemoSession = { hosted: boolean; providerMode: 'synthetic' | 'local'; actor: null | { name: string; role: 'viewer' | 'reviewer' | 'operator'; reviewer: string } };
const local: DemoSession = { hosted: false, providerMode: 'local', actor: null };
const Session = createContext<DemoSession>(local);
export const useDemoSession = () => useContext(Session);

/** Wait for the authenticated session before mounting routes that fetch records. */
export function DemoSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/session').then(async response => {
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Your session cannot access this workspace. Sign in through the configured access gateway, then reload.' : 'The workspace is unavailable. Reload to try again.');
      return response.json() as Promise<DemoSession>;
    }).then(value => { if (active) setSession(value); }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);
  if (error) return <main className="demo-session-message"><h1>Workspace access</h1><p role="alert">{error}</p><button onClick={() => window.location.reload()}>Reload</button></main>;
  if (!session) return <main className="demo-session-message" aria-busy="true">Opening workspace…</main>;
  return <Session.Provider value={session}>
    {session.hosted && <header className="demo-session-banner"><strong>Private synthetic demo</strong><span>{session.actor?.name} · {session.actor?.role}</span><span>Shared invited workspace. No model calls or quality claims.</span><nav aria-label="Demo workflow"><a href="/ask">Ask</a><a href="/review">Review</a><a href="/compare">Compare</a><a href="/cdn-cgi/access/logout">Sign out</a></nav></header>}
    {children}
  </Session.Provider>;
}
