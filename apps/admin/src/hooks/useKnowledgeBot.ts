import { useState, useCallback, useEffect, useRef } from 'react';

type Chat = {
  id: number;
  title: string;
  createdAt: string;
};

type Message = {
  id: number;
  content: string;
  isBot: boolean;
  createdAt: string;
};

type UseKnowledgeBotReturn = {
  chatId: number | null;
  messages: Message[];
  loading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  createNewChat: () => Promise<void>;
};

export const useKnowledgeBot = (userId: number): UseKnowledgeBotReturn => {
  const [chatId, setChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Ref to store the abort controller for ongoing requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load chatId from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem('knowledgeBotChatId');
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed)) {
        setChatId(parsed);
        // Optionally load messages for existing chat
        loadMessages(parsed);
      }
    }
  }, []);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const createChat = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Abort any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`${process.env.BOT_SERVICE_URL || 'http://localhost:8080'}/chats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': userId.toString(),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to create chat: ${response.status}`);
      }

      const data: Chat = await response.json();
      setChatId(data.id);
      // Store in sessionStorage
      sessionStorage.setItem('knowledgeBotChatId', data.id.toString());
      // Initialize messages array (empty for new chat)
      setMessages([]);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      setLoading(false);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [userId]);

  const loadMessages = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(
        `${process.env.BOT_SERVICE_URL || 'http://localhost:8080'}/chats/${id}/messages?limit=50`,
        {
          method: 'GET',
          headers: {
            'X-User-ID': userId.toString(),
          },
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to load messages: ${response.status}`);
      }

      const data: Message[] = await response.json();
      setMessages(data);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      setLoading(false);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [userId]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!chatId) {
        throw new Error('No active chat. Please create a chat first.');
      }
      setLoading(true);
      setError(null);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch(
          `${process.env.BOT_SERVICE_URL || 'http://localhost:8080'}/chats/${chatId}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-ID': userId.toString(),
            },
            body: JSON.stringify({ content }),
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to send message: ${response.status}`);
        }

        const data: Message = await response.json(); // Assuming the API returns the bot message
        // Update messages optimistically: we already sent user message? We'll handle by adding user message and then bot message.
        // For simplicity, we assume the backend returns the bot message and we append both.
        // Better: we should add the user message immediately, then when bot responds, add that.
        // We'll implement a more sophisticated approach: we have a pending user message state.
        // For now, we'll just reload messages to keep it simple.
        await loadMessages(chatId);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError(err.message);
        }
      } finally {
        setLoading(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [chatId, userId, loadMessages]
  );

  const createNewChat = useCallback(async () => {
    // Clear existing chat
    sessionStorage.removeItem('knowledgeBotChatId');
    setChatId(null);
    setMessages([]);
    await createChat();
  }, [createChat]);

  // If chatId changes and we have a chatId, load messages
  useEffect(() => {
    if (chatId) {
      loadMessages(chatId);
    }
  }, [chatId, loadMessages]);

  return {
    chatId,
    messages,
    loading,
    error,
    sendMessage,
    createNewChat,
  };
};