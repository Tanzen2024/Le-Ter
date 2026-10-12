import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  CreditCard,
  FileText,
  Gamepad2,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  ScrollText,
  Settings,
  ShieldAlert,
  Trophy,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Rubriques de l'administration (toutes branchées sur des API réelles). */
export const NAV: NavGroup[] = [
  {
    label: 'Pilotage',
    items: [
      { href: '/tableau-de-bord', label: 'Tableau de bord', icon: LayoutDashboard },
      { href: '/rapports', label: 'Rapports', icon: BarChart3 },
    ],
  },
  {
    label: 'Jeu',
    items: [
      { href: '/joueurs', label: 'Joueurs', icon: Users },
      { href: '/parties', label: 'Parties', icon: Gamepad2 },
      { href: '/tournois', label: 'Tournois', icon: Trophy },
      { href: '/anti-collusion', label: 'Anti-collusion', icon: ShieldAlert },
    ],
  },
  {
    label: 'Finances',
    items: [
      { href: '/finances', label: 'Finances', icon: Wallet },
      { href: '/paiements', label: 'Paiements', icon: CreditCard },
      { href: '/retraits', label: 'Retraits', icon: Banknote },
      { href: '/rapprochement', label: 'Rapprochement', icon: ArrowLeftRight },
      { href: '/compte-plateforme', label: 'Compte de la plateforme', icon: Landmark },
      { href: '/retraits-plateforme', label: 'Retraits de la plateforme', icon: PiggyBank },
    ],
  },
  {
    label: 'Contrôle',
    items: [
      { href: '/audit', label: 'Journal d’audit', icon: ScrollText },
      { href: '/parametres', label: 'Paramètres', icon: Settings },
    ],
  },
];

export const PROFILE_ITEM: NavItem = {
  href: '/profil',
  label: 'Profil et session',
  icon: FileText,
};

const ALL = [...NAV.flatMap((g) => g.items), PROFILE_ITEM];

/** Rubrique d'un chemin (la plus spécifique) : titre et fil d'Ariane. */
export function sectionOf(pathname: string): NavItem | undefined {
  return ALL.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}
