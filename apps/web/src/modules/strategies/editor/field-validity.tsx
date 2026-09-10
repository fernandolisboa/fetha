"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";

interface FieldValidityContextValue {
  register: (id: string, valid: boolean) => void;
  unregister: (id: string) => void;
}

const FieldValidityContext = createContext<FieldValidityContextValue | null>(null);

// NumberField and DecimalField each register their own commit state here
// instead of bubbling a boolean through every intermediate row component
// (StrikeRow, ConditionRow, SizingFields, ...): the form only needs to know
// whether any field, anywhere in the tree, is currently uncommitted.
export function FieldValidityProvider({
  children,
  onAnyInvalidChange,
}: {
  children: ReactNode;
  onAnyInvalidChange: (anyInvalid: boolean) => void;
}) {
  const invalidIds = useRef(new Set<string>());

  const notify = useCallback(() => {
    onAnyInvalidChange(invalidIds.current.size > 0);
  }, [onAnyInvalidChange]);

  const register = useCallback(
    (id: string, valid: boolean) => {
      if (valid) {
        invalidIds.current.delete(id);
      } else {
        invalidIds.current.add(id);
      }
      notify();
    },
    [notify],
  );

  const unregister = useCallback(
    (id: string) => {
      invalidIds.current.delete(id);
      notify();
    },
    [notify],
  );

  const value = useMemo(() => ({ register, unregister }), [register, unregister]);

  return <FieldValidityContext.Provider value={value}>{children}</FieldValidityContext.Provider>;
}

export function useFieldValidityRegistration(id: string, valid: boolean): void {
  const context = useContext(FieldValidityContext);
  useEffect(() => {
    context?.register(id, valid);
    return () => {
      context?.unregister(id);
    };
  }, [context, id, valid]);
}
