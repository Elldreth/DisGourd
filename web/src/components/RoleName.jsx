import { createContext, useContext } from 'react';

// Role colours for names (P2-21d): the current server's username -> { dark,
// light } map, provided by App while a server is open (empty in DMs).
export const RoleColorsContext = createContext(new Map());

// A member's name, in their role colour when they have one. Both theme
// versions ride along as CSS variables; index.css (.role-name) picks one.
export default function RoleName({ name, className = '', children }) {
  const colors = useContext(RoleColorsContext);
  const c = name ? colors.get(name) : null;
  if (!c) return <span className={className}>{children ?? name}</span>;
  return (
    <span className={`role-name ${className}`} style={{ '--name-dark': c.dark, '--name-light': c.light }}>
      {children ?? name}
    </span>
  );
}
