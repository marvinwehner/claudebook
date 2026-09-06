import {
  Book,
  BookOpen,
  Briefcase,
  Bug,
  Bulb,
  Calendar,
  Camera,
  ChartColumn,
  ChartLine,
  ChartPie,
  Clock,
  Code,
  Compass,
  CreditCard,
  Cube,
  Cup,
  Database,
  FileText,
  Flame,
  Flask,
  Folder,
  Gem,
  Globe,
  GraduationCap,
  Heart,
  House,
  Key,
  Layers,
  Magnifier,
  MapPin,
  Medal,
  Microscope,
  MusicNote,
  Palette,
  Pencil,
  Persons,
  Plane,
  PlanetEarth,
  Puzzle,
  QuoteOpen,
  Rocket,
  ScalesBalanced,
  Sparkles,
  SquareArticle,
  Star,
  TargetDart,
  Terminal,
  Wallet,
} from "@gravity-ui/icons";

import type { NotebookIconName } from "@/lib/notebook-icons";

/**
 * Typed as a total map over `NotebookIconName`, so adding a name to
 * `NOTEBOOK_ICON_NAMES` without an icon here fails `tsc` rather than rendering
 * nothing.
 */
export const NOTEBOOK_ICON_COMPONENTS: Record<
  NotebookIconName,
  (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element
> = {
  BookOpen,
  Book,
  GraduationCap,
  SquareArticle,
  FileText,
  Folder,
  Pencil,
  QuoteOpen,

  Magnifier,
  Compass,
  Bulb,
  Flask,
  Microscope,
  Puzzle,
  Rocket,
  Bug,

  ChartLine,
  ChartPie,
  ChartColumn,
  Database,
  Code,
  Terminal,
  Cube,
  Layers,

  Briefcase,
  Wallet,
  CreditCard,
  ScalesBalanced,
  Calendar,
  Clock,
  TargetDart,
  Medal,

  Globe,
  PlanetEarth,
  MapPin,
  Plane,
  House,
  Cup,
  Heart,
  Star,

  Palette,
  Camera,
  MusicNote,
  Persons,
  Flame,
  Sparkles,
  Gem,
  Key,
};

/**
 * Renders a notebook's stored `icon`.
 *
 * Notebooks created before the picker hold an emoji rather than an icon name,
 * so an unrecognised value falls through to being drawn as text. That is the
 * whole migration: old notebooks keep the emoji they were given, new ones get a
 * glyph that follows the theme's text colour.
 */
export function NotebookIcon({ name, className }: { name: string; className?: string }) {
  const Icon = NOTEBOOK_ICON_COMPONENTS[name as NotebookIconName];

  if (!Icon) {
    return (
      <span aria-hidden className={className}>
        {name}
      </span>
    );
  }

  return <Icon aria-hidden className={className} />;
}
