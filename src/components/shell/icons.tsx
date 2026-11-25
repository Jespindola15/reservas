import {
  AlertTriangle, ArrowLeft, Banknote, Bell, BookOpen, Building2, CalendarDays, CalendarPlus, Camera, Check, ChevronRight, CircleDollarSign,
  ClipboardList, Clock, Copy, CreditCard, ExternalLink, FileClock, Gauge, Heart, Home, Inbox, LayoutDashboard, LifeBuoy, ListChecks,
  LogOut, Mail, MapPin, Menu, MessageCircle, MoreHorizontal, Phone, Plus, QrCode, Search, Server, Settings, Shield, ShieldCheck,
  SlidersHorizontal, Star, Ticket, Trash2, TrendingUp, User, UserCog, Users, Wallet, X, type LucideIcon,
} from "lucide-react";

/**
 * Íconos de TURNUP: una sola biblioteca (Lucide), trazo 1.75, tamaños 16/18/20/22.
 * Se referencian por nombre para poder pasarlos de componentes de servidor a cliente.
 */
export const ICONS = {
  home: Home, dashboard: LayoutDashboard, calendar: CalendarDays, calendarPlus: CalendarPlus, list: ClipboardList, transfer: Banknote,
  inbox: Inbox, bell: Bell, users: Users, user: User, userCog: UserCog, courts: Building2, clock: Clock, settings: Settings,
  stats: TrendingUp, finance: CircleDollarSign, wallet: Wallet, reviews: Star, external: ExternalLink, camera: Camera, plan: CreditCard,
  shield: Shield, shieldCheck: ShieldCheck, audit: FileClock, server: Server, alert: AlertTriangle, gauge: Gauge, search: Search,
  menu: Menu, more: MoreHorizontal, close: X, plus: Plus, logout: LogOut, heart: Heart, mapPin: MapPin, phone: Phone, mail: Mail,
  chat: MessageCircle, copy: Copy, check: Check, chevron: ChevronRight, back: ArrowLeft, trash: Trash2, filters: SlidersHorizontal,
  qr: QrCode, ticket: Ticket, tasks: ListChecks, book: BookOpen, help: LifeBuoy,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className, label }: { name: IconName; size?: number; className?: string; label?: string }) {
  const C = ICONS[name];
  return <C size={size} strokeWidth={1.75} className={className} aria-hidden={label ? undefined : true} aria-label={label} focusable="false" />;
}
