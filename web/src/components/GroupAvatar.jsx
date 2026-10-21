import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';

// A group DM's picture (P9-06d; redrawn in P10-04). `members` excludes you
// (the caller decides).
//   - Two or more: two avatars at two thirds size, corner to corner, so the
//     back one's initials stay clear of the front one; "+n" for the rest.
//   - One (everyone else left): their own full-size avatar, with a small
//     group badge so it still reads as a group.
//   - None: a plain group tile.
export default function GroupAvatar({ members = [], size = 32 }) {
  const [a, b] = members;
  const badge = Math.max(12, Math.round(size * 0.44));
  if (!a) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full bg-brand text-white"
        style={{ width: size, height: size }}
        aria-hidden="true"
        data-group-avatar="empty"
      >
        <Icon name="users" size={Math.round(size * 0.55)} />
      </span>
    );
  }
  if (!b) {
    return (
      <span className="relative inline-block shrink-0" style={{ width: size, height: size }} aria-hidden="true" data-group-avatar="one">
        <Avatar name={a.username} src={a.avatar} size={size} />
        <span
          className="absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-ink-500 text-fg ring-2 ring-ink-800"
          style={{ width: badge, height: badge }}
        >
          <Icon name="users" size={Math.round(badge * 0.66)} />
        </span>
      </span>
    );
  }
  const small = Math.round(size * 0.66);
  const extra = members.length - 2;
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }} aria-hidden="true" data-group-avatar="two">
      <span className="absolute left-0 top-0">
        <Avatar name={a.username} src={a.avatar} size={small} />
      </span>
      <span className="absolute bottom-0 right-0 rounded-full ring-2 ring-ink-800">
        <Avatar name={b.username} src={b.avatar} size={small} />
      </span>
      {extra > 0 && (
        <span className="absolute -bottom-1 -left-1 rounded-full bg-ink-500 px-1 text-[10px] font-bold leading-4 text-fg ring-2 ring-ink-800">+{extra}</span>
      )}
    </span>
  );
}
