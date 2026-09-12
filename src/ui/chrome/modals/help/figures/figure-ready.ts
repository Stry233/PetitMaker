import { createContext, useContext } from 'react';

/** Help admits illustration work after its entrance and as each figure approaches the viewport. */
export const FigureReadyContext = createContext(true);

export function useFigureReady(): boolean {
  return useContext(FigureReadyContext);
}
