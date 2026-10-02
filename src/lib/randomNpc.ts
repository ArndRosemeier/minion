// Offline improvisation tables for NPCs on the fly.

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]

export const ANCESTRIES = ['Human', 'Elf', 'Dwarf', 'Halfling', 'Gnome', 'Half-Orc', 'Goblin', 'Tiefling', 'Dragonborn', 'Half-Elf'] as const

const NAMES: Record<string, { first: string[]; last: string[] }> = {
  Human: {
    first: ['Aldric', 'Mara', 'Tobin', 'Elsbeth', 'Corwin', 'Wenna', 'Garrick', 'Ilsa', 'Hollis', 'Ysolde', 'Bram', 'Lysa', 'Osric', 'Neve', 'Dunstan', 'Petra', 'Rowan', 'Agnes', 'Silas', 'Tamsin'],
    last: ['Ashford', 'Blackwood', 'Carrow', 'Dunmore', 'Fenwick', 'Greaves', 'Holloway', 'Marsh', 'Pike', 'Thorne', 'Vance', 'Whitlock', 'Brandt', 'Kessler', 'Moor'],
  },
  Elf: {
    first: ['Aelar', 'Lia', 'Theren', 'Sylvara', 'Erevan', 'Naivara', 'Galinndan', 'Shava', 'Ivellios', 'Quelenna', 'Mirethil', 'Faelyn'],
    last: ['Amakiir', 'Galanodel', 'Liadon', 'Siannodel', 'Xiloscient', 'Ilphelkiir', 'Moonwhisper', 'Dawnmantle'],
  },
  Dwarf: {
    first: ['Bruenor', 'Hilda', 'Thorin', 'Gunnloda', 'Baern', 'Eldeth', 'Rurik', 'Vistra', 'Dain', 'Torgga', 'Harbek', 'Kathra'],
    last: ['Battlehammer', 'Ironfist', 'Stonebeard', 'Gorunn', 'Holderhek', 'Fireforge', 'Deepdelver', 'Brawnanvil'],
  },
  Halfling: {
    first: ['Merric', 'Rosie', 'Perrin', 'Cora', 'Wellby', 'Lavinia', 'Milo', 'Seraphina', 'Roscoe', 'Kithri', 'Finnan', 'Bree'],
    last: ['Tealeaf', 'Underbough', 'Goodbarrel', 'Thorngage', 'Brushgather', 'Highhill', 'Tosscobble', 'Greenbottle'],
  },
  Gnome: {
    first: ['Fonkin', 'Nissa', 'Boddynock', 'Bimpnottin', 'Zook', 'Lilli', 'Alston', 'Ellywick', 'Wrenn', 'Orla'],
    last: ['Beren', 'Daergel', 'Folkor', 'Garrick', 'Nackle', 'Scheppen', 'Timbers', 'Turen', 'Fizzlebang'],
  },
  'Half-Orc': {
    first: ['Dench', 'Baggi', 'Krusk', 'Emen', 'Ront', 'Shautha', 'Thokk', 'Volen', 'Gell', 'Ovak'],
    last: ['Skullsplitter', 'of the Ash Clan', 'Tuskborn', 'Grimjaw', 'Redhand', 'the Quiet'],
  },
  Goblin: {
    first: ['Snek', 'Grizzik', 'Nub', 'Zibbly', 'Krak', 'Mogg', 'Tikka', 'Rusk', 'Pog', 'Wizzle'],
    last: ['Bonechewer', 'Fireeater', 'Mudfoot', 'Sharpteeth', 'Stinkweed', 'Rattlebag'],
  },
  Tiefling: {
    first: ['Akmenos', 'Bryseis', 'Damakos', 'Kallista', 'Mordai', 'Orianna', 'Skamos', 'Nemeia', 'Ira', 'Vesper', 'Hope', 'Torment'],
    last: ['', '', 'Ashveil', 'Cinder', 'Nightbloom'],
  },
  Dragonborn: {
    first: ['Arjhan', 'Akra', 'Balasar', 'Biri', 'Donaar', 'Kava', 'Ghesh', 'Sora', 'Medrash', 'Thava'],
    last: ['Clethtinthiallor', 'Daardendrian', 'Kerrhylon', 'Myastan', 'Yarjerit', 'Delmirev'],
  },
  'Half-Elf': {
    first: ['Arannis', 'Elora', 'Kieran', 'Saria', 'Dorian', 'Talia', 'Laucian', 'Mialee'],
    last: ['Brightwater', 'Evenwood', 'Ravensong', 'Oakenshield', 'Silverfrond', 'Marsh'],
  },
}

const OCCUPATIONS = ['innkeeper', 'blacksmith', 'merchant', 'guard', 'priest', 'farmer', 'scholar', 'thief', 'sailor', 'hunter', 'herbalist', 'bard', 'noble', 'beggar', 'soldier', 'smuggler', 'miner', 'cook', 'stablehand', 'fortune teller', 'tax collector', 'courier', 'gravedigger', 'alchemist', 'shepherd', 'retired adventurer']
const LOOKS = ['missing two fingers', 'braided beard with beads', 'piercing green eyes', 'burn scar across the cheek', 'immaculately dressed', 'smells of pipe smoke', 'tattooed knuckles', 'nervous twitch', 'enormous hat', 'very tall and stooped', 'freckled and sunburnt', 'one milky eye', 'gold tooth', 'ink-stained hands', 'covered in flour', 'wears too much jewelry', 'patched travelling cloak', 'shaved head with a sigil', 'limps on the left leg', 'bright red scarf']
const PERSONALITY = ['suspicious of strangers', 'overly friendly', 'gruff but fair', 'cowardly', 'boastful', 'deeply religious', 'greedy', 'curious about everything', 'melancholic', 'hot-tempered', 'kind-hearted', 'sarcastic', 'naive', 'secretive', 'cheerful gossip', 'pompous', 'world-weary', 'nervous and jumpy', 'stoic', 'flirtatious']
const VOICE = ['speaks very slowly', 'whispers conspiratorially', 'laughs at own jokes', 'uses archaic words', 'never finishes sentences', 'deep booming voice', 'squeaky voice', 'hums between sentences', 'calls everyone “friend”', 'counts on fingers while talking', 'thick regional accent', 'clicks tongue when thinking', 'asks a question back to every question', 'speaks in third person']
const WANTS = ['wants to pay off a debt', 'is looking for a lost sibling', 'wants revenge on a local noble', 'hopes to leave town for good', 'needs a rare herb for a sick child', 'wants to be left alone', 'seeks fame and glory', 'is hiding from the law', 'wants to protect the family business', 'is secretly in love', 'wants to find a buyer for stolen goods', 'is desperate for news from the capital']
const SECRETS = ['is a spy for a rival faction', 'witnessed a murder last week', 'owes money to dangerous people', 'is not who they claim to be', 'has a hidden stash of coins', 'is a wererat', 'knows a secret passage nearby', 'is the illegitimate child of a noble', 'once was an adventurer who fled a dungeon', 'stole their current identity', 'is being blackmailed', 'secretly worships a forbidden god']

export interface RandomNpc {
  name: string
  ancestry: string
  occupation: string
  look: string
  personality: string
  voice: string
  want: string
  secret: string
}

export function randomNpc(ancestry?: string): RandomNpc {
  const a = ancestry && NAMES[ancestry] ? ancestry : pick(ANCESTRIES)
  const n = NAMES[a]
  const last = pick(n.last)
  return {
    name: `${pick(n.first)}${last ? ' ' + last : ''}`,
    ancestry: a,
    occupation: pick(OCCUPATIONS),
    look: pick(LOOKS),
    personality: pick(PERSONALITY),
    voice: pick(VOICE),
    want: pick(WANTS),
    secret: pick(SECRETS),
  }
}

export function npcToMarkdown(n: RandomNpc) {
  return `**${n.ancestry} ${n.occupation}.** ${n.look[0].toUpperCase() + n.look.slice(1)}; ${n.personality}.\n\n- **Voice:** ${n.voice}\n- **Wants:** ${n.want}`
}
