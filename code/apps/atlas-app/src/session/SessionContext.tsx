// SPDX-License-Identifier: AGPL-3.0-only
//
// The one context that carries an EditorSession to the editor's views.

import React, { createContext, useContext } from "react";
import { useStore } from "zustand";

import type { EditorSession } from "./EditorSession";
import type { PersistenceState } from "../state/persistenceState";
import type { ViewState } from "./view";

const SessionContext = createContext<EditorSession | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: EditorSession;
  children: React.ReactNode;
}) {
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}

/** The session of the editor this component is in. */
export function useSession(): EditorSession {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession: no SessionProvider above this component");
  }
  return session;
}

/**
 * Read the session's view state. The component renders again when the
 * selected value changes.
 */
export function useView<T>(selector: (state: ViewState) => T): T {
  return useStore(useSession().view, selector);
}

/** Read the session's autosave state. */
export function usePersistence<T>(selector: (state: PersistenceState) => T): T {
  return useStore(useSession().persistence, selector);
}
