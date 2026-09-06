/**
 * The icons a notebook may wear.
 *
 * Names only, no React: this module is imported by `notebook-service` and the
 * route handlers to default and validate the stored value, and neither has any
 * business pulling in 48 SVG components. `components/notebook-icon.tsx` holds
 * the map from these names to components, keyed by `NotebookIconName`, so a
 * name added here without a component is a type error rather than a blank card.
 *
 * A notebook's `icon` field stays a plain `string` rather than this union:
 * notebooks created before the picker hold an emoji, and `NotebookIcon` renders
 * an unrecognised value as text so those keep working untouched.
 */
export const NOTEBOOK_ICON_NAMES = [
  "BookOpen",
  "Book",
  "GraduationCap",
  "SquareArticle",
  "FileText",
  "Folder",
  "Pencil",
  "QuoteOpen",

  "Magnifier",
  "Compass",
  "Bulb",
  "Flask",
  "Microscope",
  "Puzzle",
  "Rocket",
  "Bug",

  "ChartLine",
  "ChartPie",
  "ChartColumn",
  "Database",
  "Code",
  "Terminal",
  "Cube",
  "Layers",

  "Briefcase",
  "Wallet",
  "CreditCard",
  "ScalesBalanced",
  "Calendar",
  "Clock",
  "TargetDart",
  "Medal",

  "Globe",
  "PlanetEarth",
  "MapPin",
  "Plane",
  "House",
  "Cup",
  "Heart",
  "Star",

  "Palette",
  "Camera",
  "MusicNote",
  "Persons",
  "Flame",
  "Sparkles",
  "Gem",
  "Key",
] as const;

export type NotebookIconName = (typeof NOTEBOOK_ICON_NAMES)[number];

export const DEFAULT_NOTEBOOK_ICON: NotebookIconName = "BookOpen";
