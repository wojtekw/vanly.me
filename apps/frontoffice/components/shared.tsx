'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../../packages/ui/components/shared';

export * from '../../../packages/ui/components/shared';

const emptyInitialData: Record<string, any> = {};

function dataPath(path: string | null) {
  if (!path) return null;
  const [pathname, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.sort();
  return pathname + (params.size ? '?' + params.toString() : '');
}

function serverData(path: string | null, initialData: Record<string, any>) {
  if (!path) return null;
  const exact = Object.keys(initialData).find((key) => dataPath(key) === path);
  if (exact !== undefined) return initialData[exact];
  return null;
}

export function useData(path: string | null, version: any = 0) {
  const { api, initialData = emptyInitialData } = useApp();
  const requestedPath = dataPath(path);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState(() => ({
    path: requestedPath,
    source: initialData,
    data: version === 0 ? serverData(requestedPath, initialData) : null,
    error: '',
  }));
  const request = useRef({ path: requestedPath, version, tick, api, source: initialData });
  request.current = { path: requestedPath, version, tick, api, source: initialData };

  useEffect(() => {
    let live = true;
    const current = () =>
      live &&
      request.current.path === requestedPath &&
      request.current.version === version &&
      request.current.tick === tick &&
      request.current.api === api &&
      request.current.source === initialData;
    setState((previous) => {
      const freshSeed =
        previous.source !== initialData && version === 0
          ? serverData(requestedPath, initialData)
          : null;
      return {
        path: requestedPath,
        source: initialData,
        data:
          freshSeed !== null
            ? freshSeed
            : previous.path === requestedPath
              ? previous.data
              : null,
        error: '',
      };
    });
    if (path)
      Promise.resolve()
        .then(() => api(path))
        .then((data: any) => {
          if (current()) setState((previous) => ({ ...previous, data, error: '' }));
        })
        .catch((error: Error) => {
          if (current()) setState((previous) => ({ ...previous, error: error.message }));
        });
    return () => {
      live = false;
    };
  }, [requestedPath, version, tick, api, initialData]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return {
    data: state.path === requestedPath ? state.data : null,
    error: state.path === requestedPath ? state.error : '',
    reload,
  };
}
