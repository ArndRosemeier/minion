import { useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router'
import {
  BookMarked,
  BookOpen,
  Dices,
  History,
  Home,
  Library,
  MessageSquare,
  PackageCheck,
  Search,
  Settings2,
  Swords,
  Users,
  Wand2,
} from 'lucide-react'
import { CampaignProvider, useCampaign } from '@/state/campaign'
import { useBattle } from '@/state/battle'
import { useUI } from '@/state/ui'
import { DetailDrawer } from '@/components/DetailDrawer'
import { EntityEditorHost } from '@/components/EntityEditor'
import { Showcase } from '@/components/Showcase'
import { DicePanel } from '@/components/DicePanel'
import { QuickSearch, useQuickSearch } from '@/components/QuickSearch'
import { Logo } from '@/components/Logo'
import { cx } from '@/components/ui'
import { Empty, Button } from '@/components/ui'

const NAV = [
  { group: 'Prepare', items: [
    { to: 'chat', label: 'Chat', icon: MessageSquare },
    { to: 'builder', label: 'Builder', icon: Wand2 },
    { to: 'fill', label: 'Fill gaps', icon: PackageCheck },
    { to: 'library', label: 'Library', icon: Library },
  ] },
  { group: 'Run', items: [
    { to: 'play', label: 'Story', icon: BookOpen },
    { to: 'battle', label: 'Battle', icon: Swords },
    { to: 'party', label: 'Party', icon: Users },
  ] },
  { group: 'More', items: [
    { to: 'rules', label: 'Rules', icon: BookMarked },
    { to: 'setup', label: 'Campaign', icon: Settings2 },
    { to: 'history', label: 'History', icon: History },
  ] },
]

export function CampaignLayout() {
  const { campaignId } = useParams()
  const nav = useNavigate()
  const setCampaign = useBattle((s) => s.setCampaign)
  useEffect(() => {
    setCampaign(campaignId ?? null)
    useUI.getState().closeDetail()
    return () => setCampaign(null)
  }, [campaignId, setCampaign])
  if (!campaignId) return null
  return (
    <CampaignProvider
      campaignId={campaignId}
      fallback={
        <Empty title="Campaign not found">
          <Button onClick={() => nav('/')}>Back to campaigns</Button>
        </Empty>
      }
    >
      <Shell />
    </CampaignProvider>
  )
}

function Shell() {
  const { campaign } = useCampaign()
  const openDice = useUI((s) => s.openDice)
  const openSearch = useQuickSearch((s) => s.setOpen)
  const location = useLocation()
  useEffect(() => {
    useUI.getState().closeDetail()
  }, [location.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openSearch(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSearch])

  return (
    <div className="flex h-dvh overflow-hidden">
      <nav className="safe-top safe-bottom flex w-[72px] shrink-0 flex-col border-r border-line bg-surface/80 lg:w-52">
        <NavLink to="/" className="flex h-14 items-center justify-center gap-2 border-b border-line px-3 lg:justify-start" title="All campaigns">
          <span className="lg:hidden">
            <Logo small />
          </span>
          <span className="hidden min-w-0 items-center gap-2 lg:flex">
            <Home className="size-4 shrink-0 text-faint" />
            <span className="truncate font-display text-sm text-ink">{campaign.name}</span>
          </span>
        </NavLink>
        <div className="flex-1 space-y-3 overflow-y-auto py-3">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="hidden px-4 pb-1 text-[10px] font-bold tracking-widest text-faint uppercase lg:block">{g.group}</div>
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  className={({ isActive }) =>
                    cx(
                      'mx-2 flex flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-[11px] transition-colors lg:flex-row lg:gap-3 lg:px-3 lg:text-sm',
                      isActive ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-surface-3 hover:text-ink',
                    )
                  }
                >
                  <it.icon className="size-5 lg:size-[18px]" />
                  {it.label}
                </NavLink>
              ))}
            </div>
          ))}
        </div>
        <div className="space-y-1 border-t border-line p-2">
          <RailButton icon={Search} label="Search" onClick={() => openSearch(true)} />
          <RailButton icon={Dices} label="Dice" onClick={() => openDice()} />
        </div>
      </nav>
      <main className="relative min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      <DetailDrawer />
      <EntityEditorHost />
      <QuickSearch />
      <DicePanel />
      <Showcase />
    </div>
  )
}

function RailButton({ icon: Icon, label, onClick }: { icon: typeof Search; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-[11px] text-muted hover:bg-surface-3 hover:text-ink lg:flex-row lg:gap-3 lg:px-3 lg:text-sm"
    >
      <Icon className="size-5 lg:size-[18px]" />
      {label}
    </button>
  )
}
