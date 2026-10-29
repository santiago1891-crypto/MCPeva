import { useEffect, useState } from 'react';

export interface TerminalSize {
  rows: number;
  columns: number;
}

export function useTerminalSize(defaults: TerminalSize = { rows: 24, columns: 100 }): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(() => ({
    rows: process.stdout.rows ?? defaults.rows,
    columns: process.stdout.columns ?? defaults.columns
  }));

  useEffect(() => {
    const onResize = (): void => {
      setSize({
        rows: process.stdout.rows ?? defaults.rows,
        columns: process.stdout.columns ?? defaults.columns
      });
    };
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, [defaults.rows, defaults.columns]);

  return size;
}
