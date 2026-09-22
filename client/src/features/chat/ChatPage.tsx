import { useState, useEffect, useCallback } from 'react';
import { useOutletContext, useLocation } from 'react-router-dom';
import SidebarHeader from '@/shared/components/SidebarHeader';
import SidebarFooter from '@/shared/components/SidebarFooter';
import ChatSidebar from './ChatSidebar';
import ChatArea from './components/ChatArea';
import { useConversations } from '@/hooks/useConversations';
import { useSidebarResize } from '@/hooks/useSidebarResize';
import { getEndpoints } from '@/services/api';
import type { EndpointOutput } from '@/types';
import { parseMintWikiLink } from '@/shared/utils/wikiLinks';
import type { MouseEvent } from 'react';
import {
  recordModelConnectionEvent,
  recordModelConnectionEventOnce,
} from './modelConnectionEvents';

type AppContext = { onOpenSettings: () => void; openWikiPage: (filePath: string) => void };

export default function ChatPage() {
  const { onOpenSettings, openWikiPage } = useOutletContext<AppContext>();
  const { width: sidebarWidth, onMouseDown: onResizeMouseDown } = useSidebarResize();
  const {
    conversations,
    loading,
    activeId,
    setActiveId,
    create,
    delete: deleteConv,
    clearAll,
    rename,
    updateTitle,
    updateConversation,
  } = useConversations();

  const [endpoints, setEndpoints] = useState<EndpointOutput[]>([]);
  const [activeEndpoint, setActiveEndpoint] = useState<EndpointOutput | null>(null);
  const [endpointsLoading, setEndpointsLoading] = useState(true);
  const [onboardingCompleted, setOnboardingCompleted] = useState(() => {
    try {
      return localStorage.getItem('mint-model-connection-onboarding-completed') === 'true';
    } catch {
      return false;
    }
  });
  const [hadConversationsOnLoad, setHadConversationsOnLoad] = useState<boolean | null>(null);
  const [connectionMode, setConnectionMode] = useState<'onboarding' | 'repair' | null>(null);
  const [initialMessage, setInitialMessage] = useState<string | null>(null);
  const location = useLocation();

  const handleWikiLinkClick = useCallback(
    (href: string, event: MouseEvent<HTMLAnchorElement>) => {
      const filePath = parseMintWikiLink(href);
      if (!filePath) return;
      event.preventDefault();
      openWikiPage(filePath);
    },
    [openWikiPage],
  );

  // Extract wiki jump params from URL and feed to ChatArea
  // Clears URL immediately so StrictMode re-mount won't double-fire
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const msg = params.get('ask');
    const cid = params.get('cid');
    if (!msg || !cid) return;

    window.history.replaceState(null, '', '/chat');
    setActiveId(cid);
    setInitialMessage(msg);
  }, [location.search, setActiveId]);

  const fetchEndpoints = useCallback(async () => {
    try {
      const data = await getEndpoints();
      const list = data.endpoints || [];
      setEndpoints(list);
      const active =
        list.find((ep: EndpointOutput) => ep.isActive && ep.category === 'text' && ep.verifiedAt) ||
        list.find((ep: EndpointOutput) => ep.isActive && ep.category === 'text') ||
        null;
      setActiveEndpoint(active);
    } catch (err) {
      console.error('Failed to fetch endpoints:', err);
    } finally {
      setEndpointsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEndpoints();
  }, [fetchEndpoints]);

  useEffect(() => {
    if (loading || hadConversationsOnLoad !== null) return;
    setHadConversationsOnLoad(conversations.length > 0);
  }, [conversations.length, hadConversationsOnLoad, loading]);

  const chatEnabled = Boolean(activeEndpoint);
  const onboardingRequired =
    !endpointsLoading &&
    !loading &&
    hadConversationsOnLoad === false &&
    !onboardingCompleted &&
    !chatEnabled;

  useEffect(() => {
    if (onboardingRequired) recordModelConnectionEventOnce('first_use_onboarding_shown');
  }, [onboardingRequired]);

  const skipOnboarding = useCallback(() => {
    try {
      localStorage.setItem('mint-model-connection-onboarding-completed', 'true');
    } catch {
      /* ignore */
    }
    recordModelConnectionEvent('first_use_onboarding_skipped');
    setOnboardingCompleted(true);
    setConnectionMode(null);
  }, []);

  const openConnection = useCallback((mode: 'onboarding' | 'repair' = 'repair') => {
    setConnectionMode(mode);
  }, []);

  const handleConnectionSuccess = useCallback(async (endpoint: EndpointOutput) => {
    try {
      localStorage.setItem('mint-model-connection-onboarding-completed', 'true');
    } catch {
      /* ignore */
    }
    setOnboardingCompleted(true);
    setConnectionMode(null);
    setEndpoints((previous) => [...previous.filter((item) => item.id !== endpoint.id), endpoint]);
    setActiveEndpoint(endpoint);
  }, []);

  const handleInitialMessageSent = useCallback(() => {
    setInitialMessage(null);
  }, []);

  const handleCreateChat = useCallback(() => {
    void create();
  }, [create]);

  return (
    <>
      <aside
        className="sidebar sidebar--chat"
        style={{ width: sidebarWidth, minWidth: sidebarWidth }}
      >
        <SidebarHeader
          onOpenSettings={onOpenSettings}
          onCreateChat={handleCreateChat}
          chatLoading={loading}
        />
        <ChatSidebar
          conversations={conversations}
          loading={loading}
          activeId={activeId}
          onSelect={setActiveId}
          onRename={rename}
          onDelete={deleteConv}
        />
        <SidebarFooter showClear onClearAll={clearAll} />
        <div className="sidebar-resize-handle" onMouseDown={onResizeMouseDown} />
      </aside>
      <ChatArea
        activeConversation={activeId}
        conversations={conversations}
        onAutoCreate={create}
        onTitleUpdate={updateTitle}
        onUpdateConversation={updateConversation}
        activeEndpoint={activeEndpoint}
        endpoints={endpoints}
        endpointsLoading={endpointsLoading}
        onEndpointChange={fetchEndpoints}
        chatEnabled={chatEnabled}
        connectionMode={onboardingRequired ? 'onboarding' : connectionMode}
        repairEndpoint={activeEndpoint || endpoints[0] || null}
        onConnectModel={openConnection}
        onSkipOnboarding={skipOnboarding}
        onCloseConnection={() => setConnectionMode(null)}
        onConnectionSuccess={handleConnectionSuccess}
        initialMessage={initialMessage}
        onInitialMessageSent={handleInitialMessageSent}
        onLinkClick={handleWikiLinkClick}
      />
    </>
  );
}
