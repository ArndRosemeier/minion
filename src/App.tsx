import { createHashRouter, Navigate, RouterProvider } from 'react-router'
import { HomePage } from './pages/HomePage'
import { SettingsPage } from './pages/SettingsPage'
import { CampaignLayout } from './pages/CampaignLayout'
import { ChatPage } from './pages/ChatPage'
import { LibraryPage } from './pages/LibraryPage'
import { StoryPage } from './pages/StoryPage'
import { BattleListPage } from './pages/BattleListPage'
import { BattlePage } from './pages/BattlePage'
import { BuilderPage } from './pages/BuilderPage'
import { FillPage } from './pages/FillPage'
import { PartyPage } from './pages/PartyPage'
import { CampaignSettingsPage } from './pages/CampaignSettingsPage'
import { HistoryPage } from './pages/HistoryPage'
import { RulesPage } from './pages/RulesPage'
import { Toasts } from './components/Toasts'

const router = createHashRouter([
  { path: '/', element: <HomePage /> },
  { path: '/settings', element: <SettingsPage /> },
  {
    path: '/c/:campaignId',
    element: <CampaignLayout />,
    children: [
      { index: true, element: <Navigate to="chat" replace /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'builder', element: <BuilderPage /> },
      { path: 'fill', element: <FillPage /> },
      { path: 'library', element: <LibraryPage /> },
      { path: 'play', element: <StoryPage /> },
      { path: 'play/:entityId', element: <StoryPage /> },
      { path: 'battle', element: <BattleListPage /> },
      { path: 'battle/:mapId', element: <BattlePage /> },
      { path: 'party', element: <PartyPage /> },
      { path: 'setup', element: <CampaignSettingsPage /> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'rules', element: <RulesPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toasts />
    </>
  )
}
