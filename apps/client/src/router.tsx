import { createHashRouter, createBrowserRouter, Navigate } from 'react-router-dom';
import AppProvider from './App';
import ChatPage from './features/chat/ChatPage';
import WikiPage from './features/wiki/WikiPage';
import AssistantPage from './features/assistants/AssistantPage';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

const routes = [
  {
    element: <AppProvider />,
    children: [
      { index: true, element: <Navigate to="/wiki" replace /> },
      { path: '/chat', element: <ChatPage /> },
      { path: '/wiki', element: <WikiPage /> },
      { path: '/agents', element: <AssistantPage /> },
    ],
  },
];

export const router = isElectron ? createHashRouter(routes) : createBrowserRouter(routes);
