import {
  Activity,
  BookMarked,
  BookOpen,
  Clapperboard,
  Flag,
  Footprints,
  Gem,
  HelpCircle,
  MapPin,
  NotebookPen,
  ScrollText,
  Skull,
  Sparkles,
  Swords,
  Tag,
  User,
  type LucideIcon,
} from 'lucide-react'
import type { EntityType, RefCategory } from '@/types'

export interface TypeMeta {
  label: string
  plural: string
  icon: LucideIcon
  color: string
  hint: string
}

export const ENTITY_TYPES: Record<EntityType, TypeMeta> = {
  chapter: { label: 'Chapter', plural: 'Chapters', icon: BookOpen, color: 'var(--color-t-chapter)', hint: 'A part of the story, read in order during play.' },
  scene: { label: 'Scene', plural: 'Scenes', icon: Clapperboard, color: 'var(--color-t-scene)', hint: 'An event or scene inside a chapter.' },
  location: { label: 'Location', plural: 'Locations', icon: MapPin, color: 'var(--color-t-location)', hint: 'Places, rooms, regions.' },
  npc: { label: 'NPC', plural: 'NPCs', icon: User, color: 'var(--color-t-npc)', hint: 'Non-player characters, optionally with stats.' },
  creature: { label: 'Creature', plural: 'Creatures', icon: Skull, color: 'var(--color-t-creature)', hint: 'Monsters and stat blocks (homebrew or adapted).' },
  faction: { label: 'Faction', plural: 'Factions', icon: Flag, color: 'var(--color-t-faction)', hint: 'Groups, guilds, cults, nations.' },
  item: { label: 'Item', plural: 'Items', icon: Gem, color: 'var(--color-t-item)', hint: 'Treasure, artifacts, homebrew items.' },
  spell: { label: 'Spell', plural: 'Spells', icon: Sparkles, color: 'var(--color-t-spell)', hint: 'Homebrew spells and rituals.' },
  encounter: { label: 'Encounter', plural: 'Encounters', icon: Swords, color: 'var(--color-t-encounter)', hint: 'Combat or hazard encounters with creatures and a map.' },
  handout: { label: 'Handout', plural: 'Handouts', icon: ScrollText, color: 'var(--color-t-handout)', hint: 'Letters, images and clues to show players.' },
  rule: { label: 'Rule', plural: 'Rules', icon: BookMarked, color: 'var(--color-t-rule)', hint: 'House rules, homebrew conditions and mechanics.' },
  note: { label: 'Note', plural: 'Notes', icon: NotebookPen, color: 'var(--color-t-note)', hint: 'Session notes and free-form notes.' },
}

export const ENTITY_TYPE_ORDER: EntityType[] = [
  'chapter',
  'scene',
  'location',
  'npc',
  'creature',
  'encounter',
  'faction',
  'item',
  'spell',
  'handout',
  'rule',
  'note',
]

export const REF_TYPES: Record<RefCategory, TypeMeta> = {
  spell: { label: 'Spell', plural: 'Spells', icon: Sparkles, color: 'var(--color-t-spell)', hint: '' },
  condition: { label: 'Condition', plural: 'Conditions', icon: Activity, color: 'var(--color-t-condition)', hint: '' },
  creature: { label: 'Creature', plural: 'Creatures', icon: Skull, color: 'var(--color-t-creature)', hint: '' },
  action: { label: 'Action', plural: 'Actions', icon: Footprints, color: 'var(--color-t-action)', hint: '' },
  item: { label: 'Item', plural: 'Items', icon: Gem, color: 'var(--color-t-item)', hint: '' },
  rule: { label: 'Rule', plural: 'Rules', icon: BookMarked, color: 'var(--color-t-rule)', hint: '' },
  trait: { label: 'Trait', plural: 'Traits', icon: Tag, color: 'var(--color-t-trait)', hint: '' },
}

export const UNRESOLVED_META: TypeMeta = {
  label: 'Unknown',
  plural: 'Unknown',
  icon: HelpCircle,
  color: 'var(--color-faint)',
  hint: '',
}
