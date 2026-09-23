'use client';

import { useState, useEffect, useCallback } from 'react';

type FeedItem = {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  // Add other fields as needed, e.g., duration, views, etc.
  duration?: number;
  views?: number;
  creator?: string;
  // For multi-language/currency, we might have localized fields, but assume backend handles.
};

type UsePersonalizedFeedReturn = {
  feed: FeedItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

export const usePersonalizedFeed = (userId: number): UsePersonalizedFeedReturn => {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Abort controller for cleanup
    const controller = new AbortController();

    try {
      const response = await fetch(
        `${process.env.RECOMMENDATION_SERVICE_URL || 'http://localhost:8082'}/api/feed/personalized?userId=${userId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            // Optionally accept-language header from navigator.language
            'Accept-Language': navigator.language,
          },
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch feed: ${response.status}`);
      }

      const data: FeedItem[] = await response.json();
      setFeed(data);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchFeed();
    // We could set up an interval to refresh periodically, but not required.
    // Return cleanup function to abort ongoing fetch
    return () => {
      // Note: We cannot access controller here; we'll rely on the fact that fetchFeed creates its own.
      // For simplicity, we don't implement cancellation on unmount in this effect.
    };
  }, [fetchFeed]);

  const refetch = useCallback(() => {
    return fetchFeed();
  }, [fetchFeed]);

  return {
    feed,
    loading,
    error,
    refetch,
  };
};