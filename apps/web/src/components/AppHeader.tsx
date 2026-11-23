import { Disc3, Inbox, Library, LogOut, Trash2, UserRound } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Catalog", icon: Library, end: true },
  { to: "/review", label: "Review", icon: Inbox, end: false },
  { to: "/trash", label: "Trash", icon: Trash2, end: false },
];

export function AppHeader({
  onLogout,
  children,
}: {
  onLogout: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/75">
      {/* Retro stripe band from the palette. */}
      <div className="retro-stripe h-2" />
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-sm bg-foreground text-background">
              <Disc3 className="size-4" />
            </span>
            <span className="font-mono text-sm uppercase tracking-[0.2em]">Sonic</span>
          </Link>
          {children && (
            <div className="flex min-w-0 items-center gap-3 border-l pl-3">{children}</div>
          )}
        </div>
        <nav className="flex items-center gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "relative hidden h-8 items-center gap-1.5 rounded-sm px-3 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:inline-flex",
                  isActive &&
                    "text-foreground after:absolute after:inset-x-3 after:-bottom-[11px] after:h-0.5 after:bg-primary",
                )
              }
            >
              <Icon className="size-3.5" />
              {label}
            </NavLink>
          ))}
          <Button variant="ghost" size="icon" asChild className="sm:hidden" aria-label="Review">
            <Link to="/review">
              <Inbox className="size-4" />
            </Link>
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <ModeToggle />
          <Button variant="ghost" size="icon" asChild aria-label="Profile" title="Profile">
            <NavLink to="/profile" className={({ isActive }) => cn(isActive && "bg-accent text-foreground")}>
              <UserRound className="size-4" />
            </NavLink>
          </Button>
          <Button variant="ghost" size="icon" onClick={onLogout} aria-label="Log out" title="Log out">
            <LogOut className="size-4" />
          </Button>
        </nav>
      </div>
    </header>
  );
}
