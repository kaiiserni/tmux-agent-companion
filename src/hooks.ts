import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import {
  getActivity,
  getClaudeUsage,
  getOverviewFull,
  getPanes,
  getSystem,
  getPrompt,
  getRecentActivity,
  getScreen,
  getTranscript,
  postAnswer,
  postClear,
  postGoto,
  postMarkUnread,
  postSeen,
  postSend,
} from './api';
import { useApp } from './context';

const POLL = 12_000;
// Near-real-time cadence, shared by the live screen view and the post-send transcript.
export const LIVE_POLL = 1_500;

// Spinner only for a user-initiated pull, so background polls don't push the
// list down every cycle.
export function useManualRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);
  return { refreshing, onRefresh };
}

export function usePanes() {
  const { baseUrl } = useApp();
  return useQuery({
    queryKey: ['panes', baseUrl],
    queryFn: () => getPanes(baseUrl),
    refetchInterval: POLL,
    enabled: !!baseUrl,
  });
}

export function useOverviewFull() {
  const { baseUrl } = useApp();
  return useQuery({
    queryKey: ['overviewFull', baseUrl],
    queryFn: () => getOverviewFull(baseUrl),
    refetchInterval: POLL,
    enabled: !!baseUrl,
  });
}

export function useRecentActivity() {
  const { baseUrl } = useApp();
  return useQuery({
    queryKey: ['activityRecent', baseUrl],
    queryFn: () => getRecentActivity(baseUrl),
    refetchInterval: POLL,
    enabled: !!baseUrl,
  });
}

export function useActivity(paneId: string) {
  const { baseUrl } = useApp();
  return useQuery({
    queryKey: ['activity', baseUrl, paneId],
    queryFn: () => getActivity(baseUrl, paneId),
    refetchInterval: POLL,
    enabled: !!baseUrl && !!paneId,
  });
}

export function useTranscript(paneId: string, intervalMs: number = POLL) {
  const { baseUrl } = useApp();
  return useQuery({
    queryKey: ['transcript', baseUrl, paneId],
    queryFn: () => getTranscript(baseUrl, paneId),
    refetchInterval: intervalMs,
    enabled: !!baseUrl && !!paneId,
  });
}

export function useScreen(paneId: string, enabled: boolean) {
  const { baseUrl } = useApp();
  return useQuery({
    queryKey: ['screen', baseUrl, paneId],
    queryFn: () => getScreen(baseUrl, paneId),
    // Near-real-time while expanded - capture-pane is cheap and only polls when open.
    refetchInterval: LIVE_POLL,
    enabled: !!baseUrl && !!paneId && enabled,
  });
}

export function usePrompt(paneId: string, enabled: boolean, intervalMs: number = 5_000) {
  const { baseUrl } = useApp();
  return useQuery({
    queryKey: ['prompt', baseUrl, paneId],
    queryFn: () => getPrompt(baseUrl, paneId),
    refetchInterval: intervalMs,
    enabled: !!baseUrl && !!paneId && enabled,
  });
}

export function useSystem(enabled: boolean) {
  const { baseUrl } = useApp();
  return useQuery({
    queryKey: ['system', baseUrl],
    queryFn: () => getSystem(baseUrl),
    refetchInterval: 5_000,
    enabled: enabled && !!baseUrl,
  });
}

export function useClaudeUsage(enabled: boolean) {
  const { baseUrl } = useApp();
  return useQuery({
    queryKey: ['claudeUsage', baseUrl],
    queryFn: () => getClaudeUsage(baseUrl),
    refetchInterval: 30_000,
    enabled: enabled && !!baseUrl,
  });
}

export function usePaneActions() {
  const { baseUrl } = useApp();
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['panes', baseUrl] });
    qc.invalidateQueries({ queryKey: ['overviewFull', baseUrl] });
  };
  const invalidatePane = (id: string) => {
    invalidate();
    qc.invalidateQueries({ queryKey: ['prompt', baseUrl, id] });
    qc.invalidateQueries({ queryKey: ['transcript', baseUrl, id] });
    qc.invalidateQueries({ queryKey: ['screen', baseUrl, id] });
    qc.invalidateQueries({ queryKey: ['activity', baseUrl, id] });
  };
  const seen = useMutation({ mutationFn: (id: string) => postSeen(baseUrl, id), onSuccess: invalidate });
  const clear = useMutation({ mutationFn: (id: string) => postClear(baseUrl, id), onSuccess: invalidate });
  const goto = useMutation({ mutationFn: (id: string) => postGoto(baseUrl, id), onSuccess: invalidate });
  const markUnread = useMutation({
    mutationFn: (v: { id: string; on: boolean }) => postMarkUnread(baseUrl, v.id, v.on),
    onSuccess: invalidate,
  });
  const send = useMutation({
    mutationFn: (v: { id: string; text: string }) => postSend(baseUrl, v.id, v.text),
    onSuccess: (_r, v) => invalidatePane(v.id),
  });
  const answer = useMutation({
    mutationFn: (v: { id: string; key: string }) => postAnswer(baseUrl, v.id, v.key),
    onSuccess: (_r, v) => invalidatePane(v.id),
  });
  return { seen, clear, goto, markUnread, send, answer };
}
