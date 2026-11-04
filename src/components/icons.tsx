/**
 * 图标唯一出口（§B.8 / §F.9）。
 *
 * 全项目只用 Lucide，不许混第二套图标库，不许手写一次性 SVG。
 * 描边统一 1.75，尺寸只用 16 / 20 / 24。语义映射照 §B.8 的 48 条表。
 * 除本文件外任何文件 import 'lucide-react' 都应被 review 拒绝。
 */
import {
  ArrowLeft,
  ArrowUpDown,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Columns3,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Factory,
  FileText,
  Gauge,
  GraduationCap,
  GripVertical,
  History,
  Info,
  Inbox,
  Keyboard,
  Layers,
  ListFilter,
  LoaderCircle,
  Lock,
  LogOut,
  MoreHorizontal,
  Package,
  Paperclip,
  PanelLeft,
  Pencil,
  Percent,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Rows3,
  Ruler,
  Search,
  Settings,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Speaker,
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UserRound,
  Users,
  Wallet,
  Warehouse,
  X,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';

function icon(Base: LucideIcon) {
  const Glyph = ({ size = 16, ...rest }: LucideProps) => (
    <Base size={size} strokeWidth={1.75} aria-hidden={rest['aria-label'] ? undefined : true} {...rest} />
  );
  Glyph.displayName = `Icon(${Base.displayName ?? 'Lucide'})`;
  return Glyph;
}

// 导航
export const IconDashboard = icon(Gauge);
export const IconMaterial = icon(Package);
export const IconStaff = icon(Users);
export const IconVendor = icon(Factory);
export const IconQuote = icon(Receipt);
export const IconInbox = icon(Inbox);
export const IconGuest = icon(GraduationCap);
export const IconSettings = icon(Settings);
export const IconCollapse = icon(PanelLeft);
export const IconLogout = icon(LogOut);

// 供应商类型
export const IconSupplierOnline = icon(ShoppingCart);
export const IconSupplierFactory = icon(Factory);
export const IconSupplierRental = icon(Speaker);
export const IconSupplierFreelancer = icon(UserRound);
export const IconSupplierInternal = icon(Building2);
export const IconInternal = icon(Building2);
export const IconShoppingBag = icon(ShoppingBag);
export const IconWarehouse = icon(Warehouse);

// 动作
export const IconSearch = icon(Search);
export const IconPlus = icon(Plus);
export const IconPencil = icon(Pencil);
export const IconTrash = icon(Trash2);
export const IconCopy = icon(Copy);
export const IconMore = icon(MoreHorizontal);
export const IconDownload = icon(Download);
export const IconPrinter = icon(Printer);
export const IconFilter = icon(ListFilter);
export const IconSort = icon(ArrowUpDown);
export const IconColumns = icon(Columns3);
export const IconDensity = icon(Rows3);
export const IconCheck = icon(Check);
export const IconClose = icon(X);
export const IconRefresh = icon(RefreshCw);
export const IconExternal = icon(ExternalLink);
export const IconArrowLeft = icon(ArrowLeft);
export const IconArrowRight = icon(ArrowUpRight);
export const IconChevronDown = icon(ChevronDown);
export const IconChevronLeft = icon(ChevronLeft);
export const IconChevronRight = icon(ChevronRight);
export const IconGrip = icon(GripVertical);

// 语义
export const IconLowest = icon(TrendingDown);
export const IconRise = icon(TrendingUp);
export const IconExpired = icon(History);
export const IconRisk = icon(TriangleAlert);
export const IconRuler = icon(Ruler);
export const IconTiers = icon(Layers);
export const IconCalendar = icon(CalendarDays);
export const IconPercent = icon(Percent);
export const IconWallet = icon(Wallet);
export const IconLock = icon(Lock);
export const IconShield = icon(Shield);
export const IconFile = icon(FileText);
export const IconPaperclip = icon(Paperclip);
export const IconEyeOff = icon(EyeOff);
export const IconEyeOn = icon(Eye);
export const IconBell = icon(Bell);
export const IconHelp = icon(CircleHelp);
export const IconKeyboard = icon(Keyboard);

// 状态
export const IconSuccess = icon(CircleCheck);
export const IconInfo = icon(Info);
export const IconError = icon(CircleAlert);
export const IconLoading = icon(LoaderCircle);
