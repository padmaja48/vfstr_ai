import { useCallback, useEffect, useState } from 'react';

/**
 * Lightweight data hook matching the student app's useState + useEffect + axios pattern
 * (no React Query in this repo).
 */
export const useAdminQuery = (fetcher, deps = [], { enabled = true, initialData = null } = {}) => {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps.concat([enabled]));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!enabled) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await fetcher();
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps.concat([enabled]));

  return {
    data,
    setData,
    loading,
    error,
    refetch,
    isPendingBackend: error?.code === 'PENDING_BACKEND',
  };
};

export default useAdminQuery;
