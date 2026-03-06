"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type PrintableContextValue = {
  isPrintable: boolean;
  setPrintable: (value: boolean) => void;
};

const PrintableContext = createContext<PrintableContextValue>({
  isPrintable: false,
  setPrintable: () => {},
});

export function PrintableProvider({ children }: { children: ReactNode }) {
  const [isPrintable, setIsPrintable] = useState(false);
  const setPrintable = useCallback((value: boolean) => setIsPrintable(value), []);
  return (
    <PrintableContext.Provider value={{ isPrintable, setPrintable }}>
      {children}
    </PrintableContext.Provider>
  );
}

export function usePrintable() {
  return useContext(PrintableContext);
}
