import { createContext, useContext } from 'react';

/** Reading actions pause following before their expansion changes layout. */
export const ScrollIntent = createContext<() => void>(() => {});
export const useReadingIntent = () => useContext(ScrollIntent);
